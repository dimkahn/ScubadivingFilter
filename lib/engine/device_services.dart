import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import '../state/app_state.dart';

/// Sélecteur de fichiers et partage via plugins ; galerie et veille via un canal natif
/// (voir MainActivity.kt et AppDelegate.swift).
class PlatformDeviceServices implements DeviceServices {
  static const _channel = MethodChannel('rouge_retrouve/device');

  @override
  Future<List<PickedVideo>> pickVideos() async {
    final files = await FilePicker.pickFiles(type: FileType.video);
    return [
      for (final f in files)
        if (f.path != null) PickedVideo(f.path!, f.name, File(f.path!).lengthSync()),
    ];
  }

  @override
  Future<void> saveToGallery(String path, String name) =>
      _channel.invokeMethod<void>('saveToGallery', {'path': path, 'name': name});

  @override
  Future<void> share(String path) async {
    await SharePlus.instance.share(ShareParams(files: [XFile(path)]));
  }

  @override
  Future<void> keepAwake(bool on) => _channel.invokeMethod<void>('keepAwake', {'on': on});
}
