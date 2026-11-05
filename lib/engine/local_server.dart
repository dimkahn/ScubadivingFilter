import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

/// Serveur HTTP limité à l'appareil, utilisé par la WebView du moteur vidéo.
///
/// - `http://127.0.0.1` est un « contexte sécurisé » : WebCodecs y est disponible.
/// - Les vidéos sont lues par plages (Range), jamais chargées entières en mémoire.
/// - La sortie est écrite directement sur le disque, aux positions demandées.
/// - Toutes les routes passent par un jeton aléatoire : les autres applications
///   de l'appareil peuvent atteindre localhost, mais pas deviner ce préfixe.
class LocalServer {
  LocalServer({required this.loadAsset, required this.outputDir});

  /// Renvoie le contenu d'un fichier du moteur (`engine.html`, `vendor/…`).
  final Future<Uint8List> Function(String relativePath) loadAsset;
  final Directory outputDir;

  HttpServer? _server;
  late final String _token = _randomToken();
  final Map<String, String> _sources = {};
  final Map<String, RandomAccessFile> _outputs = {};
  final Map<String, Future<void>> _writeQueues = {};

  String get baseUrl => 'http://127.0.0.1:${_server!.port}/$_token';
  String get engineUrl => '$baseUrl/engine/engine.html';

  static String _randomToken() {
    final r = Random.secure();
    return base64Url
        .encode(List<int>.generate(24, (_) => r.nextInt(256)))
        .replaceAll('=', '');
  }

  Future<void> start() async {
    if (_server != null) return;
    _server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    _server!.listen((req) => unawaited(_handle(req)));
  }

  Future<void> stop() async {
    await _server?.close(force: true);
    _server = null;
    for (final f in _outputs.values) {
      await f.close();
    }
    _outputs.clear();
  }

  /// Déclare une vidéo source et renvoie l'URL que le moteur doit lire.
  String registerSource(String id, String path) {
    _sources[id] = path;
    return '$baseUrl/src/${Uri.encodeComponent(id)}';
  }

  void unregisterSource(String id) => _sources.remove(id);

  File _partFile(String id) => File('${outputDir.path}/$id.part');

  /// Ferme la sortie d'un export et lui donne son nom définitif.
  Future<File> finishOutput(String id, String fileName) async {
    await _writeQueues.remove(id);
    await _outputs.remove(id)?.close();
    // Un dossier par vidéo : deux sources de même nom ne s'écrasent pas.
    final dir = Directory('${outputDir.path}/$id')..createSync(recursive: true);
    final dst = File('${dir.path}/$fileName');
    if (dst.existsSync()) dst.deleteSync();
    return _partFile(id).rename(dst.path);
  }

  Future<void> discardOutput(String id) async {
    await _writeQueues.remove(id);
    await _outputs.remove(id)?.close();
    final f = _partFile(id);
    if (f.existsSync()) f.deleteSync();
  }

  Future<void> _handle(HttpRequest req) async {
    final res = req.response;
    try {
      final seg = req.uri.pathSegments;
      if (seg.isEmpty || seg.first != _token) {
        res.statusCode = HttpStatus.notFound;
      } else if (seg.length >= 3 && seg[1] == 'engine') {
        await _serveAsset(res, seg.sublist(2).join('/'));
      } else if (seg.length == 3 && seg[1] == 'src') {
        await _serveFile(req, res, seg[2]);
      } else if (seg.length == 3 && seg[1] == 'out' && req.method == 'POST') {
        await _receiveOutput(req, res, seg[2]);
      } else {
        res.statusCode = HttpStatus.notFound;
      }
    } catch (e) {
      try {
        res.statusCode = HttpStatus.internalServerError;
        res.write('$e');
      } catch (_) {
        // En-têtes déjà envoyés : la connexion sera simplement coupée.
      }
    }
    try {
      await res.close();
    } catch (_) {
      // Le lecteur a abandonné la requête (seek) : rien à faire.
    }
  }

  static const _mime = {
    'html': 'text/html; charset=utf-8',
    'js': 'text/javascript; charset=utf-8',
  };

  Future<void> _serveAsset(HttpResponse res, String path) async {
    if (path.contains('..')) {
      res.statusCode = HttpStatus.forbidden;
      return;
    }
    final bytes = await loadAsset(path);
    final type = _mime[path.split('.').last] ?? 'application/octet-stream';
    res.headers.set(HttpHeaders.contentTypeHeader, type);
    res.headers.set(HttpHeaders.cacheControlHeader, 'no-store');
    res.add(bytes);
  }

  Future<void> _serveFile(HttpRequest req, HttpResponse res, String id) async {
    final path = _sources[id];
    if (path == null) {
      res.statusCode = HttpStatus.notFound;
      return;
    }
    final file = File(path);
    final length = await file.length();
    final lower = path.toLowerCase();
    // Les MOV sont déclarés en MP4 : Chromium refuse parfois video/quicktime alors
    // que le contenu est le même conteneur ISO.
    final type = lower.endsWith('.webm')
        ? 'video/webm'
        : lower.endsWith('.mkv')
            ? 'video/x-matroska'
            : 'video/mp4';
    res.headers.set(HttpHeaders.contentTypeHeader, type);
    res.headers.set(HttpHeaders.acceptRangesHeader, 'bytes');

    final range = _parseRange(req.headers.value(HttpHeaders.rangeHeader), length);
    if (range == _invalidRange) {
      res.statusCode = HttpStatus.requestedRangeNotSatisfiable;
      res.headers.set(HttpHeaders.contentRangeHeader, 'bytes */$length');
      return;
    }
    var start = 0, end = length;
    if (range != null) {
      start = range.$1;
      end = range.$2;
      res.statusCode = HttpStatus.partialContent;
      res.headers.set(
          HttpHeaders.contentRangeHeader, 'bytes $start-${end - 1}/$length');
    }
    res.contentLength = end - start;
    if (req.method == 'HEAD') return;
    await res.addStream(file.openRead(start, end));
  }

  static const _invalidRange = (-1, -1);

  /// Renvoie (début, fin exclue), null sans en-tête exploitable, ou [_invalidRange].
  static (int, int)? _parseRange(String? header, int length) {
    if (header == null) return null;
    final m = RegExp(r'^bytes=(\d*)-(\d*)$').firstMatch(header.trim());
    if (m == null) return null;
    final a = m.group(1)!, b = m.group(2)!;
    if (a.isEmpty && b.isEmpty) return null;
    if (a.isEmpty) {
      final suffix = int.parse(b);
      return (max(0, length - suffix), length);
    }
    final start = int.parse(a);
    if (start >= length) return _invalidRange;
    final end = b.isEmpty ? length : min(length, int.parse(b) + 1);
    if (end <= start) return _invalidRange;
    return (start, end);
  }

  Future<void> _receiveOutput(
      HttpRequest req, HttpResponse res, String id) async {
    final q = req.uri.queryParameters;
    final body = BytesBuilder(copy: false);
    await req.forEach(body.add);
    final bytes = body.takeBytes();

    // Les écritures d'une même sortie sont sérialisées dans l'ordre d'arrivée.
    final previous = _writeQueues[id] ?? Future<void>.value();
    final current = previous.then((_) async {
      if (q['truncate'] == '1') {
        await _outputs.remove(id)?.close();
        _outputs[id] = await _partFile(id).open(mode: FileMode.write);
        return;
      }
      final f = _outputs[id];
      if (f == null) throw StateError('Sortie $id non ouverte');
      await f.setPosition(int.parse(q['pos'] ?? '0'));
      await f.writeFrom(bytes);
    });
    _writeQueues[id] = current.catchError((Object _) {});
    await current;
    res.statusCode = HttpStatus.noContent;
  }
}
