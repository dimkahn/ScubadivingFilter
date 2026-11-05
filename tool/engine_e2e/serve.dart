// Sert le moteur et des vidéos de test avec le vrai LocalServer de l'application.
// Usage : dart tool/engine_e2e/serve.dart <dossier_sortie> <video>...
import 'dart:convert';
import 'dart:io';

import 'package:rouge_retrouve/engine/local_server.dart';

Future<void> main(List<String> args) async {
  final out = Directory(args.first)..createSync(recursive: true);
  final server = LocalServer(
    outputDir: out,
    loadAsset: (p) => File('assets/engine/$p').readAsBytes(),
  );
  await server.start();
  final sources = <Map<String, Object>>[];
  for (var i = 1; i < args.length; i++) {
    final path = args[i];
    final id = 'v$i';
    sources.add({
      'id': id,
      'name': path.split('/').last,
      'size': File(path).lengthSync(),
      'url': server.registerSource(id, path),
    });
  }
  stdout.writeln(jsonEncode({'engine': server.engineUrl, 'sources': sources}));
}
