import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../model/crop.dart';
import '../model/settings.dart';

/// Canal vers le moteur vidéo (WebView en production, simulé dans les tests).
abstract class EngineBridge {
  void send(Map<String, Object?> command);
  Future<void> reload();
  set onEvent(void Function(Map<String, dynamic> event)? handler);
}

/// Accès aux fichiers par le moteur : implémenté par LocalServer.
abstract class MediaHost {
  String registerSource(String id, String path);
  void unregisterSource(String id);
  Future<File> finishOutput(String id, String fileName);
  Future<void> discardOutput(String id);
}

class PickedVideo {
  const PickedVideo(this.path, this.name, this.size);
  final String path, name;
  final int size;
}

/// Fonctions de l'appareil : sélecteur, galerie, partage, veille.
abstract class DeviceServices {
  Future<List<PickedVideo>> pickVideos();
  Future<void> saveToGallery(String path, String name);
  Future<void> share(String path);
  Future<void> keepAwake(bool on);
}

enum Tool { videos, color, stabilize, frame, analysis }

enum ItemStatus {
  wait('En attente'),
  run('En cours'),
  done('Terminé'),
  err('Erreur');

  const ItemStatus(this.label);
  final String label;
}

class VideoItem {
  VideoItem(this.id, this.path, this.name, this.size);
  final String id, path, name;
  final int size;
  late String url;
  double duration = 0;
  Uint8List? thumb;
  ItemStatus status = ItemStatus.wait;
  double progress = 0;
  double speed = 0;
  String mode = 'fast';
  String why = '';
  String error = '';
  File? output;
  int outputBytes = 0;
  double exportTime = 0;
  bool muted = false;
  bool saved = false;

  /// Extrait à exporter ; [trimOut] nul signifie jusqu'à la fin.
  double trimIn = 0;
  double? trimOut;

  /// Photos extraites de cette vidéo, supprimées avec elle.
  final photos = <File>[];

  static const _imageExt = {'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'};
  bool get isImage => _imageExt.contains(name.split('.').last.toLowerCase());
  bool get isTrimmed => trimIn > 0 || trimOut != null;
  double get clipDuration => isImage ? 0 : (trimOut ?? duration) - trimIn;
  String get formatError => isImage
      ? 'Format non pris en charge par cet appareil (essayez JPEG)'
      : 'Format non pris en charge par cet appareil (essayez MP4 H.264)';

  Map<String, Object?> toCmd() => {
        'id': id,
        'url': url,
        'name': name,
        'size': size,
        'kind': isImage ? 'image' : 'video',
        if (trimIn > 0) 'in': trimIn,
        if (trimOut != null) 'out': trimOut,
      };
}

class Playback {
  const Playback(this.t, this.d, this.playing);
  final double t, d;
  final bool playing;
}

class HistData {
  const HistData(this.original, this.corrected, this.lo, this.hi);
  final List<List<double>> original, corrected;
  final double lo, hi;
}

class TrackInfo {
  const TrackInfo(this.state, {this.at = 0, this.x = .5, this.y = .5, this.w = 0, this.h = 0});
  final String state; // idle, other, pending, lost, ok
  final double at, x, y, w, h;
}

class Live {
  const Live({
    this.gains = const [1, 1, 1],
    this.shift,
    this.track = const TrackInfo('idle'),
    this.hist,
  });
  final List<double> gains;
  final List<int>? shift;
  final TrackInfo track;
  final HistData? hist;
}

class AppMessage {
  const AppMessage(this.text, {this.actionLabel, this.action});
  final String text;
  final String? actionLabel;
  final VoidCallback? action;
}

class AppState extends ChangeNotifier {
  AppState({required this.engine, required this.host, required this.device}) {
    engine.onEvent = handleEvent;
  }

  final EngineBridge engine;
  final MediaHost host;
  final DeviceServices device;

  // Mises à jour fréquentes : notifieurs séparés pour ne pas reconstruire tout l'écran.
  final playback = ValueNotifier(const Playback(0, 12, true));
  final live = ValueNotifier(const Live());
  final exportTick = ValueNotifier(0);
  final _messages = StreamController<AppMessage>.broadcast();
  Stream<AppMessage> get messages => _messages.stream;

  bool engineReady = false;
  String? fatalError;

  // ---------- Réglages ----------
  final values = defaultValues();
  WaterPreset? preset = WaterPreset.auto;
  bool stabilize = true, compare = true, fast = true, listen = false;
  double split = .5;
  bool holdingOriginal = false;
  Tool tool = Tool.videos;

  // ---------- Cadre et orientation ----------
  String aspect = 'none';
  bool cropOn = false;
  CropRect crop = CropRect.full;
  String mode = 'normal'; // normal, edit, select
  int rot = 0;
  bool flipH = false, flipV = false;
  int outW = 1280, outH = 720, srcW = 1280, srcH = 720;
  bool _cropDrag = false;

  // ---------- Liste ----------
  final List<VideoItem> queue = [];
  VideoItem? current;
  VideoItem? running;
  bool batchRunning = false;
  bool importing = false;
  bool _stopBatch = false;
  int _nextId = 0;
  int _nextPhoto = 0;
  bool snapping = false;
  final _snapshots = <String, VideoItem>{};
  Completer<bool>? _exportDone;

  bool get exporting => running != null;
  bool get hasVideo => current != null;
  bool get canExport => queue.any((i) => i.status != ItemStatus.err) && !exporting;
  int get waitingCount => queue.where((i) => i.status == ItemStatus.wait).length;
  int get unsavedCount => queue.where((i) => i.status == ItemStatus.done && !i.saved).length;
  int get doneCount => queue.where((i) => i.status == ItemStatus.done).length;
  bool get hasPendingWork => exporting || unsavedCount > 0;

  double get totalDuration => queue
      .where((i) => i.status != ItemStatus.err)
      .fold(0.0, (s, i) => s + i.clipDuration);
  double get doneDuration => queue.where((i) => i.status != ItemStatus.err).fold(
      0.0, (s, i) => s + i.clipDuration * (i.status == ItemStatus.done ? 1 : i.progress));
  // Une image compte pour une seconde : elle n'a pas de durée, mais la liste doit quand même avancer.
  double _weight(VideoItem i) => i.isImage ? 1 : i.clipDuration;
  double get overallProgress {
    final items = queue.where((i) => i.status != ItemStatus.err);
    final total = items.fold(0.0, (s, i) => s + _weight(i));
    if (total <= 0) return 0;
    return items.fold(0.0, (s, i) => s + _weight(i) * (i.status == ItemStatus.done ? 1 : i.progress)) / total;
  }

  /// Secondes restantes estimées pendant l'export, d'après la vitesse courante.
  double get remainingSeconds {
    final sp = running?.speed ?? 0;
    final left = batchRunning ? totalDuration - doneDuration
        : (running == null ? 0.0 : running!.duration * (1 - running!.progress));
    return left / (sp > 0 ? sp : 1);
  }

  double? get normRatio {
    final a = aspectRatioOf(aspect);
    return (a == null || aspect == 'none' || srcW == 0) ? null : a * srcH / srcW;
  }

  double get stageRatio => outH == 0 ? 16 / 9 : outW / outH;

  // ---------- Événements du moteur ----------
  void handleEvent(Map<String, dynamic> e) {
    switch (e['type']) {
      case 'ready':
        engineReady = true;
        _syncAll();
        notifyListeners();
      case 'fatal':
        fatalError = e['msg'] as String?;
        notifyListeners();
      case 'contextLost':
        _onContextLost();
      case 'tick':
        _onTick(e);
      case 'dims':
        outW = (e['w'] as num).toInt();
        outH = (e['h'] as num).toInt();
        notifyListeners();
      case 'crop':
        cropOn = e['on'] as bool;
        aspect = e['aspect'] as String;
        if (!_cropDrag) {
          crop = CropRect((e['x'] as num).toDouble(), (e['y'] as num).toDouble(),
              (e['w'] as num).toDouble(), (e['h'] as num).toDouble());
        }
        notifyListeners();
      case 'mode':
        mode = e['mode'] as String;
        notifyListeners();
      case 'note':
        _say(switch (e['code']) {
          'trackUniform' => 'Cette zone est trop uniforme pour être suivie. Entourez un sujet plus contrasté.',
          'trackOrient' => 'Le suivi a été arrêté car l\'orientation a changé. Choisissez à nouveau le sujet.',
          _ => '${e['code']}',
        });
      case 'probe':
        _onProbe(e);
      case 'loaded':
        break;
      case 'loadError':
        _item(e['id'])?.let((it) {
          if (it.status != ItemStatus.run) {
            it.status = ItemStatus.err;
            it.error = it.formatError;
          }
          if (current == it) _showDemo();
          notifyListeners();
        });
      case 'exportProgress':
        _item(e['id'])?.let((it) {
          it.progress = (e['p'] as num).toDouble();
          final sp = (e['speed'] as num?)?.toDouble() ?? 0;
          if (sp > 0) it.speed = sp;
          it.mode = e['mode'] as String? ?? it.mode;
          exportTick.value++;
        });
      case 'exportDone':
        unawaited(_onExportDone(e));
      case 'exportError':
        _item(e['id'])?.let((it) => _endExport(it, ItemStatus.err, error: e['msg'] as String? ?? 'Erreur'));
      case 'exportStopped':
        _item(e['id'])?.let((it) => _endExport(it, ItemStatus.wait));
      case 'snapshotDone':
        unawaited(_onSnapshot(e));
      case 'snapshotError':
        _snapshots.remove(e['id']);
        unawaited(host.discardOutput(e['id'] as String));
        snapping = false;
        _say('Photo impossible : ${e['msg']}');
        notifyListeners();
      case 'log':
        debugPrint('moteur : ${e['msg']}');
    }
  }

  VideoItem? _item(Object? id) {
    for (final i in queue) {
      if (i.id == id) return i;
    }
    return null;
  }

  void _say(String text, {String? actionLabel, VoidCallback? action}) {
    _messages.add(AppMessage(text, actionLabel: actionLabel, action: action));
  }

  void _onTick(Map<String, dynamic> e) {
    playback.value = Playback((e['t'] as num).toDouble(), (e['d'] as num).toDouble(), e['playing'] as bool);
    final src = e['src'] as List?;
    if (src != null && src[0] is num && (src[0] != srcW || src[1] != srcH)) {
      srcW = (src[0] as num).toInt();
      srcH = (src[1] as num).toInt();
      notifyListeners();
    }
    final tr = e['tr'] as Map<String, dynamic>?;
    final h = e['hist'] as Map<String, dynamic>?;
    final previous = live.value;
    live.value = Live(
      gains: [for (final g in e['gains'] as List) (g as num).toDouble()],
      shift: (e['shift'] as List?)?.map((v) => (v as num).toInt()).toList(),
      track: tr == null
          ? const TrackInfo('idle')
          : TrackInfo(tr['s'] as String,
              at: (tr['at'] as num?)?.toDouble() ?? 0,
              x: (tr['x'] as num?)?.toDouble() ?? .5,
              y: (tr['y'] as num?)?.toDouble() ?? .5,
              w: (tr['w'] as num?)?.toDouble() ?? 0,
              h: (tr['h'] as num?)?.toDouble() ?? 0),
      hist: h == null
          ? previous.hist
          : HistData(_hist(h['o']), _hist(h['c']), (h['lo'] as num).toDouble(), (h['hi'] as num).toDouble()),
    );
  }

  static List<List<double>> _hist(Object? v) => [
        for (final ch in v as List) [for (final x in ch as List) (x as num).toDouble()],
      ];

  void _onProbe(Map<String, dynamic> e) {
    final it = _item(e['id']);
    if (it == null) return;
    it.duration = (e['dur'] as num?)?.toDouble() ?? 0;
    final th = e['thumb'] as String?;
    if (th != null) it.thumb = base64Decode(th);
    if (e['err'] != null && it.status == ItemStatus.wait) {
      it.status = ItemStatus.err;
      it.error = it.formatError;
    }
    notifyListeners();
  }

  /// Le moteur vient de (re)démarrer : on lui renvoie tout l'état.
  void _syncAll() {
    _sendSettings();
    engine.send({'c': 'orient', 'v': {'rot': rot, 'fh': flipH, 'fv': flipV}});
    engine.send({'c': 'crop', 'v': _cropCmd()});
    for (final it in queue) {
      if (it.duration == 0) engine.send({'c': 'probe', 'item': it.toCmd()});
    }
    if (current != null) engine.send({'c': 'load', 'item': current!.toCmd()});
  }

  Map<String, Object?> _cropCmd() =>
      {'on': cropOn, 'aspect': aspect, 'x': crop.x, 'y': crop.y, 'w': crop.w, 'h': crop.h};

  void _onContextLost() {
    // Application mise en arrière-plan : le système a repris le contexte graphique.
    final it = running;
    if (it != null) {
      _endExport(it, ItemStatus.err,
          error: 'Export interrompu car l\'application est passée en arrière-plan. Réessayez en la gardant ouverte.');
    }
    engineReady = false;
    unawaited(engine.reload());
  }

  // ---------- Réglages ----------
  void _sendSettings() {
    engine.send({
      'c': 'settings',
      'v': {
        ...values,
        'stab': stabilize,
        'compare': compare,
        'split': holdingOriginal ? 1.0 : split,
        'fast': fast,
        'listen': listen,
        'wantHist': tool == Tool.analysis,
      },
    });
  }

  void setValue(String key, double v) {
    values[key] = v;
    if (colorSliders.any((s) => s.key == key)) preset = null;
    engine.send({'c': 'settings', 'v': {key: v}});
    notifyListeners();
  }

  void applyPreset(WaterPreset p) {
    values.addAll(p.settings);
    preset = p;
    _sendSettings();
    notifyListeners();
  }

  void setStabilize(bool v) {
    stabilize = v;
    _sendSettings();
    notifyListeners();
  }

  void setCompare(bool v) {
    compare = v;
    _sendSettings();
    notifyListeners();
  }

  void setSplit(double v) {
    split = v.clamp(0.0, 1.0);
    engine.send({'c': 'settings', 'v': {'split': split}});
    notifyListeners();
  }

  /// Doigt maintenu sur l'image : affiche l'original en entier, avec ou sans ligne de comparaison.
  void holdOriginal(bool on) {
    holdingOriginal = on;
    engine.send({'c': 'settings', 'v': {'split': on ? 1.0 : (compare ? split : 0.0), 'compare': on || compare}});
    notifyListeners();
  }

  void setFast(bool v) {
    fast = v;
    _sendSettings();
    notifyListeners();
  }

  void setListen(bool v) {
    listen = v;
    _sendSettings();
    notifyListeners();
  }

  void setTool(Tool t) {
    if (tool == t) return;
    tool = t;
    engine.send({'c': 'settings', 'v': {'wantHist': t == Tool.analysis}});
    notifyListeners();
  }

  // ---------- Lecture ----------
  void togglePlay() => engine.send({'c': 'toggle'});
  void pause() => engine.send({'c': 'pause'});
  void seek(double t) => engine.send({'c': 'seek', 't': t});

  // ---------- Cadre ----------
  void setAspect(String a) {
    if (!exporting) engine.send({'c': 'aspect', 'a': a});
  }

  void setMode(String m) {
    if (!exporting) engine.send({'c': 'mode', 'mode': m});
  }

  void beginCropDrag() => _cropDrag = true;

  void updateCrop(CropRect r) {
    crop = r;
    engine.send({'c': 'crop', 'v': {'x': r.x, 'y': r.y, 'w': r.w, 'h': r.h}});
    notifyListeners();
  }

  void endCropDrag() => _cropDrag = false;

  void rotate(int delta) {
    if (exporting) return;
    rot = (rot + delta + 360) % 360;
    engine.send({'c': 'orient', 'v': {'rot': rot}});
    notifyListeners();
  }

  void toggleFlipH() {
    if (exporting) return;
    flipH = !flipH;
    engine.send({'c': 'orient', 'v': {'fh': flipH}});
    notifyListeners();
  }

  void toggleFlipV() {
    if (exporting) return;
    flipV = !flipV;
    engine.send({'c': 'orient', 'v': {'fv': flipV}});
    notifyListeners();
  }

  void pickSubject() {
    if (!exporting) engine.send({'c': 'pickSubject'});
  }

  void selectSubject(double x0, double y0, double x1, double y1) => engine.send({
        'c': 'select',
        'a': {'x': x0, 'y': y0},
        'b': {'x': x1, 'y': y1},
      });

  void stopTracking() => engine.send({'c': 'stopTrack'});

  // ---------- Liste ----------
  Future<void> addVideos() async {
    if (importing) return;
    importing = true;
    notifyListeners();
    try {
      addPicked(await device.pickVideos());
    } catch (e) {
      _say('Impossible d\'ouvrir ces fichiers : $e');
    } finally {
      importing = false;
      notifyListeners();
    }
  }

  void addPicked(List<PickedVideo> files) {
    if (files.isEmpty) return;
    final added = <VideoItem>[];
    for (final f in files) {
      final it = VideoItem('${++_nextId}', f.path, f.name, f.size);
      it.url = host.registerSource(it.id, it.path);
      queue.add(it);
      added.add(it);
      engine.send({'c': 'probe', 'item': it.toCmd()});
    }
    tool = Tool.videos;
    if (current == null && !exporting) preview(added.first);
    notifyListeners();
  }

  void preview(VideoItem it) {
    if (exporting || it.status == ItemStatus.err) return;
    current = it;
    engine.send({'c': 'load', 'item': it.toCmd()});
    notifyListeners();
  }

  // ---------- Extrait ----------
  static const minClip = .1;

  void setTrim(double start, double? end) {
    final it = current;
    if (it == null || it.isImage || exporting) return;
    final d = it.duration;
    if (d <= minClip) return;
    final a = start.clamp(0.0, d - minClip);
    final b = (end ?? d).clamp(a + minClip, d);
    it.trimIn = a <= .01 ? 0 : a;
    it.trimOut = b >= d - .01 ? null : b;
    notifyListeners();
  }

  void markIn() {
    final it = current;
    if (it == null) return;
    final t = playback.value.t;
    final end = it.trimOut;
    // Un début placé après la fin repousse celle-ci plutôt que d'être refusé.
    setTrim(t, end != null && end > t + minClip ? end : null);
  }

  void markOut() {
    final it = current;
    if (it == null) return;
    final t = playback.value.t;
    setTrim(it.trimIn < t - minClip ? it.trimIn : 0, t);
  }

  void clearTrim() => setTrim(0, null);

  // ---------- Photo ----------
  void takeSnapshot() {
    final it = current;
    if (it == null || exporting || snapping) return;
    final id = '${it.id}-photo-${++_nextPhoto}';
    _snapshots[id] = it;
    snapping = true;
    engine.send({'c': 'snapshot', 'id': id});
    notifyListeners();
  }

  Future<void> _onSnapshot(Map<String, dynamic> e) async {
    final id = e['id'] as String;
    final it = _snapshots.remove(id);
    try {
      if (it == null) throw StateError('vidéo retirée');
      final base = it.name.contains('.') ? it.name.substring(0, it.name.lastIndexOf('.')) : it.name;
      final at = (e['t'] as num).toStringAsFixed(1).replaceAll('.', '_');
      final file = await host.finishOutput(id, '$base-photo-${at}s.jpg');
      it.photos.add(file);
      await device.saveToGallery(file.path, file.uri.pathSegments.last);
      _say('Photo enregistrée dans la galerie.', actionLabel: 'Partager', action: () => unawaited(device.share(file.path)));
    } catch (err) {
      _say('Photo impossible : $err');
    } finally {
      snapping = false;
      notifyListeners();
    }
  }

  void _showDemo() {
    current = null;
    engine.send({'c': 'demo'});
  }

  Future<void> remove(VideoItem it) async {
    if (it == running) return;
    queue.remove(it);
    host.unregisterSource(it.id);
    _deleteOutput(it);
    for (final f in it.photos) {
      if (f.existsSync()) f.deleteSync();
    }
    if (current == it) _showDemo();
    notifyListeners();
  }

  void _deleteOutput(VideoItem it) {
    final f = it.output;
    if (f != null && f.existsSync()) f.deleteSync();
    it.output = null;
  }

  void clearDone() {
    for (final it in queue.where((i) => i.status == ItemStatus.done).toList()) {
      remove(it);
    }
  }

  void retry(VideoItem it) {
    if (exporting) return;
    it.status = ItemStatus.wait;
    it.error = '';
    it.progress = 0;
    notifyListeners();
  }

  // ---------- Export ----------
  Future<void> exportCurrent() async {
    final it = current;
    if (it == null || exporting) return;
    await device.keepAwake(true);
    final ok = await _process(it);
    await device.keepAwake(false);
    if (ok) {
      tool = Tool.videos;
      _say('« ${it.name} » est prête.', actionLabel: 'Enregistrer', action: () => save(it));
    } else if (it.status == ItemStatus.err) {
      _say(it.error);
    }
    notifyListeners();
  }

  Future<void> exportAll() async {
    if (exporting || waitingCount == 0) return;
    batchRunning = true;
    _stopBatch = false;
    notifyListeners();
    await device.keepAwake(true);
    var n = 0;
    while (!_stopBatch) {
      final next = queue.where((i) => i.status == ItemStatus.wait).firstOrNull;
      if (next == null) break;
      if (await _process(next)) n++;
    }
    batchRunning = false;
    await device.keepAwake(false);
    final errors = queue.where((i) => i.status == ItemStatus.err).length;
    tool = Tool.videos;
    _say(
      '${_stopBatch ? 'Export arrêté. ' : ''}$n ${n > 1 ? 'fichiers exportés' : 'fichier exporté'}'
      '${errors > 0 ? ', $errors en erreur' : ''}.',
      actionLabel: unsavedCount > 0 ? 'Tout enregistrer' : null,
      action: unsavedCount > 0 ? saveAll : null,
    );
    notifyListeners();
  }

  Future<bool> _process(VideoItem it) {
    final done = Completer<bool>();
    _exportDone = done;
    running = it;
    current = it;
    it
      ..status = ItemStatus.run
      ..progress = 0
      ..speed = 0
      ..why = ''
      ..error = '';
    _deleteOutput(it);
    if (mode != 'normal') mode = 'normal';
    notifyListeners();
    engine.send({'c': 'export', 'item': it.toCmd()});
    return done.future;
  }

  void stopExport() {
    _stopBatch = true;
    engine.send({'c': 'stop'});
  }

  Future<void> _onExportDone(Map<String, dynamic> e) async {
    final it = _item(e['id']);
    if (it == null) return;
    try {
      final base = it.name.contains('.') ? it.name.substring(0, it.name.lastIndexOf('.')) : it.name;
      final suffix = it.isTrimmed && !it.isImage ? '-extrait' : '-corrigee';
      it.output = await host.finishOutput(it.id, '$base$suffix.${e['ext']}');
      it.outputBytes = (e['bytes'] as num).toInt();
      it.exportTime = (e['time'] as num).toDouble();
      it.muted = e['muted'] as bool? ?? false;
      it.mode = e['mode'] as String? ?? it.mode;
      it.why = e['why'] as String? ?? '';
      it.saved = false;
      it.progress = 1;
      _endExport(it, ItemStatus.done);
    } catch (err) {
      _endExport(it, ItemStatus.err, error: 'Écriture du fichier impossible : $err');
    }
  }

  void _endExport(VideoItem it, ItemStatus status, {String? error}) {
    it.status = status;
    if (error != null) it.error = error;
    if (status != ItemStatus.done) {
      it.progress = 0;
      unawaited(host.discardOutput(it.id));
    }
    running = null;
    notifyListeners();
    final c = _exportDone;
    _exportDone = null;
    c?.complete(status == ItemStatus.done);
  }

  Future<bool> save(VideoItem it) async {
    final f = it.output;
    if (f == null) return false;
    try {
      await device.saveToGallery(f.path, f.uri.pathSegments.last);
      it.saved = true;
      notifyListeners();
      _say('Enregistrée dans la galerie.');
      return true;
    } catch (e) {
      _say('Enregistrement impossible : $e');
      return false;
    }
  }

  Future<void> saveAll() async {
    for (final it in queue.where((i) => i.status == ItemStatus.done && !i.saved).toList()) {
      if (!await save(it)) break;
    }
  }

  Future<void> share(VideoItem it) async {
    final f = it.output;
    if (f == null) return;
    try {
      await device.share(f.path);
    } catch (e) {
      _say('Partage impossible : $e');
    }
  }

  @override
  void dispose() {
    engine.onEvent = null;
    unawaited(_messages.close());
    playback.dispose();
    live.dispose();
    exportTick.dispose();
    super.dispose();
  }
}

extension _Let<T> on T {
  void let(void Function(T) f) => f(this);
}
