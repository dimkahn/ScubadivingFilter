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

/// Suit le thème clair ou sombre du système, y compris pendant que l'application est ouverte.
class RougeApp extends StatefulWidget {
  const RougeApp({super.key, required this.state, required this.surface});
  final AppState state;
  final Widget surface;

  @override
  State<RougeApp> createState() => _RougeAppState();
}

class _RougeAppState extends State<RougeApp> with WidgetsBindingObserver {
  final _home = GlobalKey();

  @override
  void initState() {
    super.initState();
    C.use(WidgetsBinding.instance.platformDispatcher.platformBrightness);
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangePlatformBrightness() {
    final b = WidgetsBinding.instance.platformDispatcher.platformBrightness;
    if (b == C.brightness) return;
    C.use(b);
    setState(() {});
    // Les écrans lisent la palette directement : on les reconstruit tous, sans perdre leur état
    // (lecteur vidéo, feuilles et dialogues ouverts compris).
    void rebuild(Element e) {
      e.markNeedsBuild();
      e.visitChildren(rebuild);
    }
    (context as Element).visitChildren(rebuild);
  }

  @override
  Widget build(BuildContext context) {
    final dark = C.brightness == Brightness.dark;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: (dark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark).copyWith(
        statusBarColor: Colors.transparent,
        systemNavigationBarColor: Colors.transparent,
        systemNavigationBarContrastEnforced: false,
      ),
      child: MaterialApp(
        title: 'Scuba See Red',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        // Bascule d'un coup : les écrans qui lisent la palette directement changent aussi d'un coup.
        themeAnimationDuration: Duration.zero,
        home: HomeScreen(key: _home, state: widget.state, surface: widget.surface),
      ),
    );
  }
}
