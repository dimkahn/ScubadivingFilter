import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

import 'engine/device_services.dart';
import 'engine/local_server.dart';
import 'engine/webview_engine.dart';
import 'state/app_state.dart';
import 'theme.dart';
import 'ui/home_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);

  // Les sorties d'une session précédente ne sont plus référencées : on libère la place.
  final tmp = await getTemporaryDirectory();
  final outputDir = Directory('${tmp.path}/exports');
  if (outputDir.existsSync()) outputDir.deleteSync(recursive: true);
  outputDir.createSync(recursive: true);

  final server = LocalServer(
    outputDir: outputDir,
    loadAsset: (path) async {
      final data = await rootBundle.load('assets/engine/$path');
      return data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
    },
  );
  await server.start();

  final engine = WebViewEngine(server.engineUrl);
  final state = AppState(engine: engine, host: _Host(server), device: PlatformDeviceServices());

  runApp(RougeApp(state: state, surface: engine.buildSurface()));
}

class _Host implements MediaHost {
  _Host(this.server);
  final LocalServer server;
  @override
  String registerSource(String id, String path) => server.registerSource(id, path);
  @override
  void unregisterSource(String id) => server.unregisterSource(id);
  @override
  Future<File> finishOutput(String id, String fileName) => server.finishOutput(id, fileName);
  @override
  Future<void> discardOutput(String id) => server.discardOutput(id);
}

class RougeApp extends StatelessWidget {
  const RougeApp({super.key, required this.state, required this.surface});
  final AppState state;
  final Widget surface;

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Scuba See Red',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        home: HomeScreen(state: state, surface: surface),
      );
}
