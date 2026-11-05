import Flutter
import Photos
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    guard let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "RougeDevice") else { return }
    let channel = FlutterMethodChannel(name: "rouge_retrouve/device", binaryMessenger: registrar.messenger())
    channel.setMethodCallHandler { call, result in
      let args = call.arguments as? [String: Any]
      switch call.method {
      case "keepAwake":
        UIApplication.shared.isIdleTimerDisabled = (args?["on"] as? Bool) ?? false
        result(nil)
      case "saveToGallery":
        guard let path = args?["path"] as? String else {
          result(FlutterError(code: "bad_args", message: "Chemin manquant", details: nil))
          return
        }
        Self.saveToPhotos(URL(fileURLWithPath: path), result)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }

  private static func saveToPhotos(_ url: URL, _ result: @escaping FlutterResult) {
    PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
      guard status == .authorized || status == .limited else {
        DispatchQueue.main.async {
          result(FlutterError(code: "denied", message: "Accès aux Photos refusé (voir Réglages)", details: nil))
        }
        return
      }
      PHPhotoLibrary.shared().performChanges({
        PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url)
      }) { ok, error in
        DispatchQueue.main.async {
          if ok {
            result(nil)
          } else {
            result(FlutterError(code: "save_failed", message: error?.localizedDescription, details: nil))
          }
        }
      }
    }
  }
}
