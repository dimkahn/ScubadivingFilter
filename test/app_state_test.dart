import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:rouge_retrouve/model/settings.dart';
import 'package:rouge_retrouve/state/app_state.dart';

import 'support.dart';

void main() {
  late FakeEngine engine;
  late FakeHost host;
  late FakeDevice device;
  late AppState s;
  late Directory dir;

  setUp(() {
    dir = Directory.systemTemp.createTempSync('rouge_state');
    engine = FakeEngine();
    host = FakeHost(dir);
    device = FakeDevice();
    s = AppState(engine: engine, host: host, device: device);
  });
  tearDown(() => dir.deleteSync(recursive: true));

  void addTwo() => s.addPicked(const [PickedVideo('/a/a.mp4', 'a.mp4', 10), PickedVideo('/a/b.mov', 'b.mov', 20)]);
  Map<String, dynamic> done(String id) =>
      {'type': 'exportDone', 'id': id, 'ext': 'mp4', 'bytes': 5, 'time': 1.0, 'mode': 'fast', 'muted': false, 'why': ''};

  test('ajouter des vidéos : sonde chacune, affiche la première', () {
    addTwo();
    expect(engine.commands('probe').length, 2);
    expect(engine.commands('load').single['item'], containsPair('name', 'a.mp4'));
    expect(s.current!.name, 'a.mp4');
    expect(s.tool, Tool.videos);
  });

  test('un préréglage s\'applique, puis un curseur le désélectionne', () {
    s.applyPreset(WaterPreset.deep);
    expect(s.values['red'], 65);
    expect(s.preset, WaterPreset.deep);
    s.setValue('red', 70);
    expect(s.preset, isNull);
    s.applyPreset(WaterPreset.auto);
    expect(s.values['red'], 100);
  });

  test('régler la stabilisation ne désélectionne pas le préréglage', () {
    s.applyPreset(WaterPreset.blue);
    s.setValue('sforce', 60);
    expect(s.preset, WaterPreset.blue);
  });

  test('le nom de sortie remplace seulement l\'extension', () async {
    s.addPicked(const [PickedVideo('/a/plongée.2.mov', 'plongée.2.mov', 10)]);
    final f = s.exportCurrent();
    engine.handler!(done('1'));
    await f;
    expect(s.queue.single.output!.path, endsWith('plongée.2-corrigee.mp4'));
  });

  test('export de la liste : une vidéo à la fois, écran gardé allumé', () async {
    addTwo();
    final f = s.exportAll();
    await pumpEventQueue();
    expect(device.awake, [true]);
    expect(engine.commands('export').length, 1);
    expect(s.running!.id, '1');
    engine.handler!({'type': 'exportProgress', 'id': '1', 'p': .5, 'speed': 2.0, 'mode': 'fast'});
    expect(s.running!.progress, .5);
    engine.handler!(done('1'));
    await pumpEventQueue();
    expect(s.queue[0].status, ItemStatus.done);
    expect(engine.commands('export').length, 2);
    expect(s.running!.id, '2');
    engine.handler!(done('2'));
    await f;
    expect(s.exporting, isFalse);
    expect(s.batchRunning, isFalse);
    expect(device.awake, [true, false]);
    expect(s.unsavedCount, 2);
    expect(s.hasPendingWork, isTrue);
  });

  test('une erreur n\'arrête pas la liste', () async {
    addTwo();
    final f = s.exportAll();
    await pumpEventQueue();
    engine.handler!({'type': 'exportError', 'id': '1', 'msg': 'non pris en charge'});
    await pumpEventQueue();
    expect(s.queue[0].status, ItemStatus.err);
    expect(s.queue[0].error, 'non pris en charge');
    expect(host.discarded, ['1']);
    engine.handler!(done('2'));
    await f;
    expect(s.queue[1].status, ItemStatus.done);
  });

  test('arrêter stoppe la liste et remet la vidéo en attente', () async {
    addTwo();
    final f = s.exportAll();
    await pumpEventQueue();
    s.stopExport();
    expect(engine.commands('stop').length, 1);
    engine.handler!({'type': 'exportStopped', 'id': '1'});
    await f;
    expect(s.queue[0].status, ItemStatus.wait);
    expect(s.queue[1].status, ItemStatus.wait);
    expect(engine.commands('export').length, 1);
    expect(device.awake.last, isFalse);
  });

  test('perte du contexte graphique : échec clair, puis l\'état est renvoyé au moteur', () async {
    addTwo();
    s.setValue('red', 150);
    final f = s.exportCurrent();
    await pumpEventQueue();
    engine.handler!({'type': 'contextLost'});
    await f;
    expect(s.queue[0].status, ItemStatus.err);
    expect(s.queue[0].error, contains('arrière-plan'));
    expect(engine.reloads, 1);
    engine.sent.clear();
    engine.handler!({'type': 'ready'});
    final settings = engine.commands('settings').single['v'] as Map;
    expect(settings['red'], 150);
    expect(engine.commands('orient').length, 1);
    expect(engine.commands('load').length, 1);
  });

  test('retirer la vidéo affichée revient à la scène de démo', () async {
    addTwo();
    await s.remove(s.queue.first);
    expect(s.current, isNull);
    expect(engine.commands('demo').length, 1);
  });

  test('la vidéo en cours d\'export ne peut pas être retirée', () async {
    addTwo();
    unawaited(s.exportCurrent());
    await pumpEventQueue();
    await s.remove(s.queue.first);
    expect(s.queue.length, 2);
  });

  test('format illisible signalé par la sonde', () {
    addTwo();
    engine.handler!({'type': 'probe', 'id': '2', 'dur': 0, 'err': 'format'});
    expect(s.queue[1].status, ItemStatus.err);
    expect(s.queue[1].error, contains('Format'));
  });

  test('enregistrer : succès marqué, échec remonté sans marquer', () async {
    addTwo();
    final f = s.exportCurrent();
    await pumpEventQueue();
    engine.handler!(done('1'));
    await f;
    final msgs = <String>[];
    s.messages.listen((m) => msgs.add(m.text));
    device.saveError = 'plein';
    expect(await s.save(s.queue[0]), isFalse);
    expect(s.queue[0].saved, isFalse);
    device.saveError = null;
    expect(await s.save(s.queue[0]), isTrue);
    expect(s.queue[0].saved, isTrue);
    expect(s.hasPendingWork, isFalse);
    await pumpEventQueue();
    expect(msgs.first, contains('impossible'));
  });

  test('l\'histogramme n\'est demandé que sur l\'onglet Analyse', () {
    s.setTool(Tool.analysis);
    expect((engine.commands('settings').last['v'] as Map)['wantHist'], isTrue);
    s.setTool(Tool.color);
    expect((engine.commands('settings').last['v'] as Map)['wantHist'], isFalse);
  });

  test('format de durée et de taille', () {
    expect(fmtTime(75), '1:15');
    expect(fmtTime(double.nan), '0:00');
    expect(fmtLong(30), '30 s');
    expect(fmtLong(3700), '1 h 02');
    expect(fmtSize(5 * 1048576), '5,0 Mo');
    expect(fmtSize(2.5 * 1073741824), '2,5 Go');
  });
}

void unawaited(Future<void> f) {}
