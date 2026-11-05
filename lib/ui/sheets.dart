import 'package:flutter/material.dart';

import '../model/settings.dart';
import '../state/app_state.dart';
import '../theme.dart';
import 'panels.dart';

const _sheetWidth = BoxConstraints(maxWidth: 560);

/// Récapitule ce qui sera appliqué et lance l'export : une étape claire au lieu de boutons dispersés.
Future<void> showExportSheet(BuildContext context, AppState state) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      constraints: _sheetWidth,
      builder: (context) => ListenableBuilder(
        listenable: state,
        builder: (context, _) => _ExportSheet(state: state),
      ),
    );

class _ExportSheet extends StatelessWidget {
  const _ExportSheet({required this.state});
  final AppState state;

  String get _summary {
    final s = state;
    final parts = <String>[
      s.preset?.label ?? 'Réglages personnalisés',
      if (!(s.current?.isImage ?? false))
        s.stabilize ? 'stabilisation ${s.values['sforce']!.round()} %' : 'sans stabilisation',
      if (s.current?.isTrimmed ?? false)
        'extrait ${fmtTime(s.current!.trimIn)} → ${fmtTime(s.current!.trimOut ?? s.current!.duration)}',
      if (s.cropOn) 'format ${s.aspect == 'free' ? 'libre' : s.aspect}',
      if (s.rot != 0) 'rotation ${s.rot}°',
      if (s.flipH) 'miroir',
      if (s.flipV) 'haut/bas inversés',
      if (s.live.value.track.state != 'idle') 'suivi du sujet',
    ];
    return parts.join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final s = state;
    final waiting = s.waitingCount;
    final cur = s.current;
    void go(Future<void> Function() run) {
      Navigator.of(context).pop();
      run();
    }

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
          Text('Exporter', style: T.display(24)),
          const SizedBox(height: 10),
          const SectionLabel('Réglages appliqués'),
          Text(_summary, style: T.body(14)),
          const SizedBox(height: 10),
          ToggleRow('Conversion rapide', s.fast, s.setFast,
              hint: 'MP4 et MOV : plus vite que la lecture, son d\'origine conservé.'),
          if (!s.fast)
            ToggleRow('Écouter le son pendant l\'export', s.listen, s.setListen,
                hint: 'L\'export en temps réel lit la vidéo du début à la fin.'),
          const SizedBox(height: 4),
          Text('Gardez l\'application ouverte pendant l\'export : l\'écran restera allumé.',
              style: T.body(13, color: C.muted)),
          const SizedBox(height: 16),
          if (waiting > 1 || (waiting == 1 && cur?.status != ItemStatus.wait))
            FilledButton.icon(
              onPressed: () => go(s.exportAll),
              icon: const Icon(Icons.playlist_play),
              label: Text('Exporter la liste ($waiting ${waiting > 1 ? 'fichiers' : 'fichier'})'),
            ),
          if (cur != null) ...[
            const SizedBox(height: 8),
            waiting > 1 || (waiting == 1 && cur.status != ItemStatus.wait)
                ? OutlinedButton(
                    onPressed: () => go(s.exportCurrent),
                    child: Text('Seulement « ${cur.name} »', overflow: TextOverflow.ellipsis),
                  )
                : FilledButton.icon(
                    onPressed: () => go(s.exportCurrent),
                    icon: const Icon(Icons.movie_creation_outlined),
                    label: Text(cur.status == ItemStatus.done
                        ? 'Exporter à nouveau'
                        : cur.isImage
                            ? 'Exporter cette photo'
                            : cur.isTrimmed
                                ? 'Exporter cet extrait'
                                : 'Exporter cette vidéo'),
                  ),
          ],
        ]),
      ),
    );
  }
}

/// Explications de la version d'origine, accessibles sans encombrer l'écran de travail.
Future<void> showHelpSheet(BuildContext context) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      constraints: _sheetWidth,
      builder: (context) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: .7,
        maxChildSize: .92,
        builder: (context, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
          children: [
            Text('Comment ça marche', style: T.display(24)),
            const SizedBox(height: 16),
            const SectionLabel('Ce que l\'eau retire'),
            for (final (depth, color, text) in const [
              ('~5 m', Color(0xFFE8322A), 'Le rouge disparaît'),
              ('~10 m', Color(0xFFF58A1F), 'L\'orange disparaît'),
              ('~20 m', Color(0xFFF3CF2A), 'Le jaune s\'efface'),
              ('>30 m', Color(0xFF2F7FD6), 'Il reste surtout bleu et vert'),
            ])
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(children: [
                  SizedBox(width: 52, child: Text(depth, style: T.mono(13))),
                  Container(
                    width: 16,
                    height: 16,
                    decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(4)),
                  ),
                  const SizedBox(width: 10),
                  Expanded(child: Text(text, style: T.body(14))),
                ]),
              ),
            const SizedBox(height: 16),
            const SectionLabel('Comment le filtre corrige'),
            Text(
              '1. Il reconstruit le canal rouge à partir du vert, d\'après la moyenne de l\'image (compensation d\'Ancuti).\n'
              '2. Il étire chaque canal entre ses valeurs extrêmes, ce qui neutralise la dominante bleue ou verte.\n'
              '3. Il lisse la correction dans le temps pour éviter le scintillement.',
              style: T.body(14, color: C.muted),
            ),
            const SizedBox(height: 16),
            const SectionLabel('Gestes sur l\'image'),
            Text(
              'Glisser : déplacer la ligne avant/après.\nToucher : lecture ou pause.\nMaintenir : voir l\'original.',
              style: T.body(14, color: C.muted),
            ),
            const SizedBox(height: 16),
            const SectionLabel('Conseils'),
            Text(
              'Au-delà de 20 m sans éclairage, le rouge est presque absent du capteur : baissez « Récupération du rouge » si l\'image devient bruitée ou rose. Pour une eau de lac ou de port, essayez « Eau verte ».',
              style: T.body(14, color: C.muted),
            ),
          ],
        ),
      ),
    );

/// Bandeau d'export : progression et arrêt toujours visibles, quel que soit l'outil affiché.
class ExportBanner extends StatelessWidget {
  const ExportBanner({super.key, required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    final s = state;
    return AnimatedBuilder(
      animation: s.exportTick,
      builder: (context, _) {
        final it = s.running;
        if (it == null) return const SizedBox.shrink();
        final p = s.batchRunning ? s.overallProgress : it.progress;
        final position = s.batchRunning
            ? ' ${s.queue.where((i) => i.status == ItemStatus.done).length + 1}/${s.queue.where((i) => i.status != ItemStatus.err).length}'
            : '';
        return Container(
          color: C.panel2,
          padding: const EdgeInsets.fromLTRB(16, 6, 6, 6),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
                Row(children: [
                  Expanded(
                    child: Text('Export$position · ${it.name}', style: T.body(13, wght: 500), maxLines: 1, overflow: TextOverflow.ellipsis),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '${(p * 100).round()} %${it.progress > .02 ? ' · ${fmtLong(s.remainingSeconds)}' : ''}',
                    style: T.mono(12),
                  ),
                ]),
                const SizedBox(height: 5),
                ClipRRect(
                  borderRadius: BorderRadius.circular(3),
                  child: LinearProgressIndicator(value: p, minHeight: 5, backgroundColor: C.line),
                ),
              ]),
            ),
            const SizedBox(width: 4),
            TextButton(onPressed: s.stopExport, child: const Text('Arrêter')),
          ]),
        );
      },
    );
  }
}
