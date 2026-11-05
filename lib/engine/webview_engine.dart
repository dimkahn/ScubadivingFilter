import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import '../state/app_state.dart';

/// Moteur vidéo hébergé dans une WebView sans interface : Flutter dessine toute l'UI,
/// la WebView ne fournit que l'image corrigée et les calculs.
class WebViewEngine implements EngineBridge {
  WebViewEngine(this.engineUrl) {
    final PlatformWebViewControllerCreationParams params =
        WebViewPlatform.instance is WebKitWebViewPlatform
            ? WebKitWebViewControllerCreationParams(
                allowsInlineMediaPlayback: true,
                mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
              )
            : const PlatformWebViewControllerCreationParams();
    controller = WebViewController.fromPlatformCreationParams(params)
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.black)
      ..addJavaScriptChannel('RougeBridge', onMessageReceived: _onMessage);
    final platform = controller.platform;
    if (platform is AndroidWebViewController) {
      platform.setMediaPlaybackRequiresUserGesture(false);
    }
    controller.loadRequest(Uri.parse(engineUrl));
  }

  final String engineUrl;
  late final WebViewController controller;
  void Function(Map<String, dynamic>)? _handler;

  @override
  set onEvent(void Function(Map<String, dynamic>)? handler) => _handler = handler;

  void _onMessage(JavaScriptMessage m) {
    _handler?.call(jsonDecode(m.message) as Map<String, dynamic>);
  }

  @override
  void send(Map<String, Object?> command) {
    controller.runJavaScript('window.Engine&&Engine.cmd(${jsonEncode(command)})').catchError((Object e) {
      debugPrint('Commande moteur perdue : $e');
    });
  }

  @override
  Future<void> reload() => controller.loadRequest(Uri.parse(engineUrl));

  Widget buildSurface() => WebViewWidget(controller: controller);
}
