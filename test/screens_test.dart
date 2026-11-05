// Vérifie chaque écran sur quatre formats d'appareil : pas de débordement, cibles tactiles
// suffisantes, gestes corrects.
// Pour regénérer les captures dans test/goldens :
//   flutter test --update-goldens --dart-define=SCREENSHOTS=true test/screens_test.dart
import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rouge_retrouve/main.dart';
import 'package:rouge_retrouve/state/app_state.dart';

import 'support.dart';

const screenshots = bool.fromEnvironment('SCREENSHOTS');

const devices = <String, Size>{
  'phone_portrait': Size(390, 844),
  'phone_landscape': Size(844, 390),
  'tablet_portrait': Size(820, 1180),
  'tablet_landscape': Size(1180, 820),
};

Future<void> loadFont(String family, List<String> paths) async {
  final l = FontLoader(family);
  for (final p in paths) {
    l.addFont(File(p).readAsBytes().then((b) => ByteData.sublistView(b)));
  }
  await l.load();
}

void main() {
  late Uint8List frame;
  late Directory dir;

  setUpAll(() async {
    await loadFont('Plex', ['assets/fonts/IBMPlexSans.ttf']);
    await loadFont('PlexMono', ['assets/fonts/IBMPlexMono-Regular.ttf', 'assets/fonts/IBMPlexMono-Medium.ttf']);
    await loadFont('Bricolage', ['assets/fonts/BricolageGrotesque.ttf']);
    final root = Platform.environment['FLUTTER_ROOT'];
    if (root != null) {
      await loadFont('MaterialIcons', ['$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf']);
    }
    frame = File('test/fixtures/engine_frame.jpg').readAsBytesSync();
    dir = Directory.systemTemp.createTempSync('rouge_screens');
  });
  tearDownAll(() => dir.deleteSync(recursive: true));

  Future<(AppState, FakeEngine)> pumpApp(WidgetTester tester, Size size) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    tester.view.padding = FakeViewPadding.zero;
    addTearDown(tester.view.reset);
    final engine = FakeEngine();
    final s = AppState(engine: engine, host: FakeHost(dir), device: FakeDevice());
    final image = MemoryImage(frame);
    await tester.runAsync(() async {
      final ctx = Completer();
      image.resolve(ImageConfiguration.empty).addListener(ImageStreamListener((_, _) => ctx.complete()));
      await ctx.future;
    });
    final surface = Image(image: image, fit: BoxFit.cover, gaplessPlayback: true);
    await tester.pumpWidget(RougeApp(state: s, surface: surface));
    engine.handler!({'type': 'dims', 'w': 1920, 'h': 1080});
    engine.handler!(tick(hist: true));
    await tester.pump();
    return (s, engine);
  }

  void withVideos(AppState s, FakeEngine e, Uint8List thumb) {
    s.addPicked(const [
      PickedVideo('/v/epave-sud.mp4', 'epave-sud.mp4', 812000000),
      PickedVideo('/v/tortue.mov', 'tortue.mov', 233000000),
      PickedVideo('/v/recif-matin.mp4', 'recif-matin.mp4', 1450000000),
    ]);
    for (final it in s.queue) {
      e.handler!({'type': 'probe', 'id': it.id, 'dur': 95.0});
      it.thumb = thumb;
    }
  }

  Future<void> shot(WidgetTester tester, String name) async {
    if (!screenshots) return;
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 150)));
    await tester.pump(const Duration(milliseconds: 400)); // fin des transitions
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/$name.png'));
  }

  for (final MapEntry(key: name, value: size) in devices.entries) {
    group(name, () {
      testWidgets('accueil sans vidéo', (t) async {
        await pumpApp(t, size);
        expect(find.text('Retrouvez les couleurs de vos plongées'), findsOneWidget);
        expect(t.takeException(), isNull);
        await shot(t, '${name}_empty');
      });

      for (final tool in Tool.values) {
        testWidgets('outil ${tool.name}', (t) async {
          final (s, e) = await pumpApp(t, size);
          withVideos(s, e, frame);
          s.setTool(tool);
          await t.pump();
          expect(t.takeException(), isNull);
          await expectLater(t, meetsGuideline(androidTapTargetGuideline));
          await shot(t, '${name}_${tool.name}');
        });
      }

      testWidgets('export en cours', (t) async {
        final (s, e) = await pumpApp(t, size);
        withVideos(s, e, frame);
        unawaitedF(s.exportAll());
        await t.pump();
        e.handler!({'type': 'exportProgress', 'id': '1', 'p': .62, 'speed': 2.4, 'mode': 'fast'});
        s.setTool(Tool.videos);
        await t.pump();
        expect(find.text('Arrêter'), findsOneWidget);
        expect(t.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.pause_rounded)).onPressed, isNull);
        expect(t.takeException(), isNull);
        await shot(t, '${name}_exporting');
      });

      testWidgets('mode cadre', (t) async {
        final (s, e) = await pumpApp(t, size);
        s.setTool(Tool.frame);
        e.handler!({'type': 'crop', 'on': true, 'aspect': '4:5', 'x': .3, 'y': .05, 'w': .4, 'h': .9});
        e.handler!({'type': 'mode', 'mode': 'edit'});
        await t.pump();
        expect(find.text('Valider'), findsOneWidget);
        expect(t.takeException(), isNull);
        await shot(t, '${name}_crop');
      });

      testWidgets('feuille d\'export', (t) async {
        final (s, e) = await pumpApp(t, size);
        withVideos(s, e, frame);
        await t.pump();
        await t.tap(find.byIcon(Icons.ios_share).first);
        await t.pumpAndSettle();
        expect(find.text('Conversion rapide'), findsOneWidget);
        expect(t.takeException(), isNull);
        await shot(t, '${name}_export_sheet');
      });
    });
  }

  group('gestes sur l\'image', () {
    Rect stageRect(WidgetTester t) => t.getRect(find.byType(Image).first);

    testWidgets('toucher : lecture/pause', (t) async {
      final (_, e) = await pumpApp(t, devices['phone_portrait']!);
      await t.tapAt(stageRect(t).center);
      await t.pump(const Duration(milliseconds: 400));
      expect(e.commands('toggle').length, 1);
    });

    testWidgets('glisser : déplace la ligne de comparaison', (t) async {
      final (s, _) = await pumpApp(t, devices['phone_portrait']!);
      final r = stageRect(t);
      await t.dragFrom(r.center, Offset(r.width * .25, 0));
      await t.pump();
      expect(s.split, greaterThan(.6));
      expect(s.split, lessThan(.9));
    });

    testWidgets('maintenir : affiche l\'original, relâcher restaure', (t) async {
      final (s, e) = await pumpApp(t, devices['phone_portrait']!);
      final g = await t.startGesture(stageRect(t).center);
      await t.pump(const Duration(milliseconds: 600));
      expect(s.holdingOriginal, isTrue);
      expect((e.commands('settings').last['v'] as Map)['split'], 1.0);
      await g.up();
      await t.pump();
      expect(s.holdingOriginal, isFalse);
      expect((e.commands('settings').last['v'] as Map)['split'], s.split);
    });

    testWidgets('cadre : tirer un coin redimensionne, avec une grande tolérance', (t) async {
      final (s, e) = await pumpApp(t, devices['phone_portrait']!);
      e.handler!({'type': 'crop', 'on': true, 'aspect': 'free', 'x': .2, 'y': .2, 'w': .6, 'h': .6});
      e.handler!({'type': 'mode', 'mode': 'edit'});
      await t.pump();
      final r = stageRect(t);
      // 20 px à côté du coin bas droit, comme un vrai doigt
      final corner = Offset(r.left + r.width * .8 + 20, r.top + r.height * .8 + 15);
      await t.dragFrom(corner, const Offset(-60, -30));
      await t.pump();
      expect(s.crop.w, lessThan(.6));
      expect(s.crop.x, closeTo(.2, 1e-6));
      expect(e.commands('crop').isNotEmpty, isTrue);
    });

    testWidgets('sujet : entourer envoie la zone au moteur', (t) async {
      final (_, e) = await pumpApp(t, devices['phone_portrait']!);
      e.handler!({'type': 'mode', 'mode': 'select'});
      await t.pump();
      final r = stageRect(t);
      await t.dragFrom(r.center, const Offset(50, 30));
      await t.pump();
      final sel = e.commands('select').single;
      final a = sel['a'] as Map, b = sel['b'] as Map;
      expect((b['x'] as double), greaterThan(a['x'] as double));
      expect((b['y'] as double), greaterThan(a['y'] as double));
    });

    testWidgets('sujet : un simple toucher fonctionne aussi', (t) async {
      final (_, e) = await pumpApp(t, devices['phone_portrait']!);
      e.handler!({'type': 'mode', 'mode': 'select'});
      await t.pump();
      await t.tapAt(stageRect(t).center);
      await t.pump();
      expect(e.commands('select').length, 1);
    });
  });
}

void unawaitedF(Future<void> f) {}
