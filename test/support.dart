import 'dart:io';
import 'dart:math' as math;

import 'package:rouge_retrouve/state/app_state.dart';

class FakeEngine implements EngineBridge {
  final sent = <Map<String, Object?>>[];
  int reloads = 0;
  void Function(Map<String, dynamic>)? handler;

  @override
  set onEvent(void Function(Map<String, dynamic>)? h) => handler = h;
  @override
  void send(Map<String, Object?> c) => sent.add(c);
  @override
  Future<void> reload() async => reloads++;

  Iterable<Map<String, Object?>> commands(String c) => sent.where((m) => m['c'] == c);
}

class FakeHost implements MediaHost {
  FakeHost(this.dir);
  final Directory dir;
  final discarded = <String>[];

  @override
  String registerSource(String id, String path) => 'http://local/src/$id';
  @override
  void unregisterSource(String id) {}
  @override
  Future<File> finishOutput(String id, String fileName) async => File('${dir.path}/$fileName')..writeAsBytesSync([1]);
  @override
  Future<void> discardOutput(String id) async => discarded.add(id);
}

class FakeDevice implements DeviceServices {
  List<PickedVideo> toPick = const [];
  final awake = <bool>[];
  final saved = <String>[];
  Object? saveError;

  @override
  Future<List<PickedVideo>> pickVideos() async => toPick;
  @override
  Future<void> saveToGallery(String path, String name) async {
    if (saveError != null) throw saveError!;
    saved.add(name);
  }
  @override
  Future<void> share(String path) async {}
  @override
  Future<void> keepAwake(bool on) async => awake.add(on);
}

Map<String, dynamic> tick({double t = 3, double d = 42, bool playing = true, Map<String, dynamic>? tr, bool hist = false}) => {
      'type': 'tick',
      't': t,
      'd': d,
      'playing': playing,
      'gains': [3.42, 1.31, 1.08],
      'shift': [12, -7],
      'src': [1920, 1080],
      'tr': tr ?? {'s': 'idle'},
      if (hist) 'hist': {
        'o': [_curve(.12, .05), _curve(.42, .1), _curve(.55, .1)],
        'c': [_curve(.45, .2), _curve(.5, .2), _curve(.5, .18)],
        'lo': .004,
        'hi': .031,
      },
    };

List<double> _curve(double center, double width) => [
      for (var i = 0; i < 64; i++) 800 * math.exp(-math.pow(i / 63 - center, 2) / (2 * width * width)),
    ];
