import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rouge_retrouve/engine/local_server.dart';

void main() {
  late Directory dir;
  late LocalServer server;
  late HttpClient http;
  late File source;

  setUp(() async {
    dir = Directory.systemTemp.createTempSync('rouge');
    source = File('${dir.path}/src.mp4')..writeAsBytesSync(List.generate(1000, (i) => i % 256));
    server = LocalServer(
      outputDir: Directory('${dir.path}/out')..createSync(),
      loadAsset: (p) async => Uint8List.fromList('asset:$p'.codeUnits),
    );
    await server.start();
    http = HttpClient();
  });

  tearDown(() async {
    http.close(force: true);
    await server.stop();
    dir.deleteSync(recursive: true);
  });

  Future<(int, List<int>, HttpHeaders)> get(String url, {String? range}) async {
    final q = await http.getUrl(Uri.parse(url));
    if (range != null) q.headers.set(HttpHeaders.rangeHeader, range);
    final r = await q.close();
    final bytes = await r.fold<List<int>>([], (a, b) => a..addAll(b));
    return (r.statusCode, bytes, r.headers);
  }

  Future<int> post(String url, List<int> body) async {
    final q = await http.postUrl(Uri.parse(url));
    q.add(body);
    final r = await q.close();
    await r.drain<void>();
    return r.statusCode;
  }

  test('les routes exigent le jeton', () async {
    final port = Uri.parse(server.baseUrl).port;
    final (code, _, _) = await get('http://127.0.0.1:$port/engine/engine.html');
    expect(code, 404);
    final (code2, body, _) = await get(server.engineUrl);
    expect(code2, 200);
    expect(String.fromCharCodes(body), 'asset:engine.html');
  });

  test('le module et le WASM du suivi sont servis avec le bon type', () async {
    final (_, _, mjs) = await get('${server.baseUrl}/engine/vendor/ort-wasm-simd-threaded.mjs');
    expect(mjs.contentType?.mimeType, 'text/javascript');
    final (_, _, wasm) = await get('${server.baseUrl}/engine/vendor/ort-wasm-simd-threaded.wasm');
    expect(wasm.contentType?.mimeType, 'application/wasm');
    expect(wasm.value('cross-origin-opener-policy'), 'same-origin');
    expect(wasm.value('cross-origin-embedder-policy'), 'require-corp');
  });

  test('les ressources refusent la remontée de dossiers', () async {
    final q = await http.getUrl(Uri.parse('${server.baseUrl}/engine/x'));
    await (await q.close()).drain<void>();
    final (code, _, _) = await get('${server.baseUrl}/engine/%2E%2E%2Fsecret');
    expect(code, anyOf(403, 404));
  });

  test('une source non déclarée n\'est pas accessible', () async {
    final (code, _, _) = await get('${server.baseUrl}/src/inconnu');
    expect(code, 404);
  });

  test('lecture par plages', () async {
    final url = server.registerSource('1', source.path);
    final (code, body, h) = await get(url, range: 'bytes=10-19');
    expect(code, 206);
    expect(body, List.generate(10, (i) => 10 + i));
    expect(h.value(HttpHeaders.contentRangeHeader), 'bytes 10-19/1000');

    final (fullCode, full, fh) = await get(url);
    expect(fullCode, 200);
    expect(full.length, 1000);
    expect(fh.value(HttpHeaders.acceptRangesHeader), 'bytes');

    final (openCode, open, _) = await get(url, range: 'bytes=990-');
    expect(openCode, 206);
    expect(open.length, 10);

    final (outCode, _, _) = await get(url, range: 'bytes=5000-');
    expect(outCode, 416);
  });

  test('écritures positionnées, y compris un retour en arrière', () async {
    final base = '${server.baseUrl}/out/7';
    expect(await post('$base?truncate=1', []), 204);
    expect(await post('$base?pos=4', [5, 6, 7, 8]), 204);
    expect(await post('$base?pos=0', [1, 2, 3, 4]), 204);
    final f = await server.finishOutput('7', 'video-corrigee.mp4');
    expect(f.path, endsWith('/7/video-corrigee.mp4'));
    expect(f.readAsBytesSync(), [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('truncate repart de zéro après un essai échoué', () async {
    final base = '${server.baseUrl}/out/8';
    await post('$base?truncate=1', []);
    await post('$base?pos=0', List.filled(100, 9));
    await post('$base?truncate=1', []);
    await post('$base?pos=0', [1]);
    final f = await server.finishOutput('8', 'a.mp4');
    expect(f.lengthSync(), 1);
  });

  test('écrire sans ouverture préalable échoue proprement', () async {
    expect(await post('${server.baseUrl}/out/9?pos=0', [1]), 500);
  });

  test('abandonner une sortie supprime le fichier partiel', () async {
    final base = '${server.baseUrl}/out/5';
    await post('$base?truncate=1', []);
    await post('$base?pos=0', [1]);
    await server.discardOutput('5');
    expect(File('${dir.path}/out/5.part').existsSync(), isFalse);
  });
}
