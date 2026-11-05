import 'package:flutter/material.dart';

import '../model/settings.dart';
import '../state/app_state.dart';
import '../theme.dart';

/// Barre de lecture : grand bouton, position, temps, bascule avant/après.
class Transport extends StatefulWidget {
  const Transport({super.key, required this.state});
  final AppState state;
  @override
  State<Transport> createState() => _TransportState();
}

class _TransportState extends State<Transport> {
  double? _dragging;

  @override
  Widget build(BuildContext context) {
    final s = widget.state;
    if (s.mode != 'normal') return _ModeBar(state: s);
    final compareButton = IconButton(
      tooltip: s.compare ? 'Masquer l\'avant/après' : 'Afficher l\'avant/après',
      isSelected: s.compare,
      constraints: const BoxConstraints(minWidth: 48, minHeight: 52),
      selectedIcon: Icon(Icons.compare, color: s.exporting ? C.line : C.accent),
      icon: Icon(Icons.compare, color: s.exporting ? C.line : C.muted),
      onPressed: s.exporting ? null : () => s.setCompare(!s.compare),
    );
    if (s.current?.isImage ?? false) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(children: [
          Expanded(child: Text('Photo', style: T.body(14))),
          compareButton,
        ]),
      );
    }
    return ValueListenableBuilder(
      valueListenable: s.playback,
      builder: (context, p, _) {
        final d = p.d > 0 ? p.d : 1.0;
        final t = _dragging ?? p.t.clamp(0.0, d);
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Row(children: [
            IconButton(
              iconSize: 30,
              tooltip: p.playing ? 'Pause' : 'Lecture',
              constraints: const BoxConstraints(minWidth: 52, minHeight: 52),
              onPressed: s.exporting ? null : s.togglePlay,
              color: C.fg,
              disabledColor: C.line,
              icon: Icon(p.playing ? Icons.pause_rounded : Icons.play_arrow_rounded),
            ),
            Expanded(
              child: Semantics(
                label: 'Position dans la vidéo',
                child: Slider(
                  value: t,
                  max: d,
                  onChanged: s.exporting
                      ? null
                      : (v) {
                          setState(() => _dragging = v);
                          s.seek(v);
                        },
                  onChangeEnd: (_) => setState(() => _dragging = null),
                ),
              ),
            ),
            Text('${fmtTime(t)} / ${fmtTime(p.d)}', style: T.mono(12)),
            IconButton(
              tooltip: 'Extraire une photo',
              constraints: const BoxConstraints(minWidth: 48, minHeight: 52),
              icon: Icon(Icons.photo_camera_outlined,
                  color: s.current == null || s.exporting || s.snapping ? C.line : C.fg),
              onPressed: s.current == null || s.exporting || s.snapping ? null : s.takeSnapshot,
            ),
            compareButton,
          ]),
        );
      },
    );
  }
}

/// Remplace la barre de lecture pendant le réglage du cadre ou le choix du sujet : la consigne et
/// l'action restent à portée de pouce, sans jamais recouvrir une poignée sur l'image.
class _ModeBar extends StatelessWidget {
  const _ModeBar({required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    final s = state;
    final edit = s.mode == 'edit';
    final tracked = s.live.value.track.state != 'idle';
    final size = '${(s.crop.w * s.srcW / 2).round() * 2} × ${(s.crop.h * s.srcH / 2).round() * 2}';
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 6, 12, 6),
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(
              edit
                  ? (tracked ? 'Le cadre suit le sujet : tirez ses coins' : 'Déplacez le cadre ou tirez ses coins')
                  : 'Entourez le sujet à suivre, ou touchez-le',
              style: T.body(13.5),
            ),
            if (edit) Text('$size px', style: T.mono(12)),
          ]),
        ),
        const SizedBox(width: 10),
        edit
            ? FilledButton.icon(
                onPressed: () => s.setMode('normal'),
                icon: const Icon(Icons.check),
                label: const Text('Valider'),
              )
            : OutlinedButton(onPressed: () => s.setMode('normal'), child: const Text('Annuler')),
      ]),
    );
  }
}
