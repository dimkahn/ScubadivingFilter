import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../model/settings.dart';
import '../state/app_state.dart';
import '../theme.dart';
import 'result_player.dart';

/// Contenu de l'outil actif. Défile seul : le moniteur reste toujours visible.
class ToolPanel extends StatelessWidget {
  const ToolPanel({super.key, required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    final s = state;
    final panel = switch (s.tool) {
      Tool.videos => VideosPanel(state: s),
      Tool.color => _ColorPanel(state: s),
      Tool.stabilize => _StabilizePanel(state: s),
      Tool.frame => _FramePanel(state: s),
      Tool.analysis => _AnalysisPanel(state: s),
    };
    // Pendant l'export, les réglages sont figés ; la liste reste accessible.
    final locked = s.exporting && s.tool != Tool.videos;
    return AbsorbPointer(
      absorbing: locked,
      child: AnimatedOpacity(
        opacity: locked ? .45 : 1,
        duration: const Duration(milliseconds: 150),
        child: panel,
      ),
    );
  }
}

class _Scroll extends StatelessWidget {
  const _Scroll({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
        children: children,
      );
}

class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 6, bottom: 8),
        child: Row(children: [
          Expanded(child: Text(text.toUpperCase(), style: T.label())),
          ?trailing,
        ]),
      );
}

/// Grille responsive : une colonne sur téléphone, deux dès que la largeur le permet.
class _Columns extends StatelessWidget {
  const _Columns({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, c) {
        final two = c.maxWidth >= 560;
        final w = two ? (c.maxWidth - 24) / 2 : c.maxWidth;
        return Wrap(spacing: 24, children: [for (final k in children) SizedBox(width: w, child: k)]);
      });
}

/// Curseur : libellé et valeur au-dessus d'une piste large, retour à la valeur par défaut d'un geste.
class ValueSlider extends StatelessWidget {
  const ValueSlider({super.key, required this.spec, required this.state, this.enabled = true});
  final SliderSpec spec;
  final AppState state;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final v = state.values[spec.key] ?? spec.def;
    final changed = (v - spec.def).abs() > .5;
    return Opacity(
      opacity: enabled ? 1 : .45,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SizedBox(
          height: 32,
          child: Row(children: [
            Expanded(child: Text(spec.label, style: T.body(14), overflow: TextOverflow.ellipsis)),
            if (changed && enabled)
              IconButton(
                tooltip: 'Revenir à ${spec.format(spec.def)}',
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 40, minHeight: 32),
                iconSize: 17,
                icon: Icon(Icons.undo, color: C.muted),
                onPressed: () => state.setValue(spec.key, spec.def),
              ),
            Text(spec.format(v), style: T.mono(13)),
          ]),
        ),
        SizedBox(
          height: 40,
          child: SliderTheme(
            data: SliderTheme.of(context).copyWith(padding: const EdgeInsets.symmetric(horizontal: 10)),
            child: Slider(
              value: v.clamp(spec.min, spec.max),
              min: spec.min,
              max: spec.max,
              semanticFormatterCallback: (x) => spec.format(x),
              onChanged: enabled ? (x) => state.setValue(spec.key, x.roundToDouble()) : null,
            ),
          ),
        ),
        const SizedBox(height: 4),
      ]),
    );
  }
}

class ToggleRow extends StatelessWidget {
  const ToggleRow(this.label, this.value, this.onChanged, {super.key, this.hint});
  final String label;
  final String? hint;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) => InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: () => onChanged(!value),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 52),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                Text(label, style: T.body(14)),
                if (hint != null) Text(hint!, style: T.body(12.5, color: C.muted)),
              ]),
            ),
            const SizedBox(width: 12),
            ExcludeSemantics(child: Switch(value: value, onChanged: onChanged)),
          ]),
        ),
      );
}

class ChoiceTile extends StatelessWidget {
  const ChoiceTile({super.key, required this.selected, required this.onTap, required this.child});
  final bool selected;
  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        selected: selected,
        child: Material(
          color: selected ? C.accent.withAlpha(0x22) : C.panel2,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
            side: BorderSide(color: selected ? C.accent : C.line, width: selected ? 1.5 : 1),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: () {
              HapticFeedback.selectionClick();
              onTap();
            },
            child: child,
          ),
        ),
      );
}

// ---------- Couleur ----------
class _ColorPanel extends StatelessWidget {
  const _ColorPanel({required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    final s = state;
    return _Scroll(children: [
      const SectionLabel('Type d\'eau'),
      SizedBox(
        height: 64,
        child: ListView(
          scrollDirection: Axis.horizontal,
          children: [
            for (final p in WaterPreset.values)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: SizedBox(
                  width: 112,
                  child: ChoiceTile(
                    selected: s.preset == p,
                    onTap: () => s.applyPreset(p),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(p.label, style: T.body(14, wght: 600, color: s.preset == p ? C.accent : C.fg)),
                        Text(p.hint, style: T.body(12, color: C.muted), overflow: TextOverflow.ellipsis),
                      ]),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
      const SizedBox(height: 14),
      SectionLabel(
        'Réglages',
        trailing: TextButton.icon(
          onPressed: () => s.applyPreset(WaterPreset.auto),
          icon: const Icon(Icons.restart_alt, size: 18),
          label: const Text('Réinitialiser'),
        ),
      ),
      _Columns(children: [for (final spec in colorSliders) ValueSlider(spec: spec, state: s)]),
    ]);
  }
}

// ---------- Stabilisation ----------
class _StabilizePanel extends StatelessWidget {
  const _StabilizePanel({required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    final s = state;
    return _Scroll(children: [
      ToggleRow('Stabiliser l\'image', s.stabilize, s.setStabilize,
          hint: 'Compense le palmage et la houle en recadrant légèrement.'),
      const Divider(height: 16),
      _Columns(children: [
        ValueSlider(spec: forceSlider, state: s, enabled: s.stabilize),
        ValueSlider(spec: marginSlider, state: s, enabled: s.stabilize),
      ]),
      const SizedBox(height: 4),
      ValueListenableBuilder(
        valueListenable: s.live,
        builder: (context, live, _) => Row(children: [
          Expanded(child: Text('Décalage compensé', style: T.body(14))),
          Text(live.shift == null ? 'désactivé' : '${live.shift![0]} / ${live.shift![1]} px', style: T.mono(13)),
        ]),
      ),
      const SizedBox(height: 12),
      Text('Plus le recadrage est grand, plus les secousses fortes sont absorbées, au prix d\'un léger zoom.',
          style: T.body(13, color: C.muted)),
    ]);
  }
}

// ---------- Cadre et suivi ----------
class _FramePanel extends StatelessWidget {
  const _FramePanel({required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    final s = state;
    return _Scroll(children: [
      const SectionLabel('Format'),
      SizedBox(
        height: 72,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: aspectChoices.length,
          separatorBuilder: (_, _) => const SizedBox(width: 8),
          itemBuilder: (context, i) {
            final (id, label, ratio) = aspectChoices[i];
            final sel = s.aspect == id;
            return SizedBox(
              width: 72,
              child: ChoiceTile(
                selected: sel,
                onTap: () => s.setAspect(id),
                child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  SizedBox(
                    height: 28,
                    child: Center(child: _RatioGlyph(id: id, ratio: ratio, color: sel ? C.accent : C.muted)),
                  ),
                  const SizedBox(height: 4),
                  Text(label, style: T.body(12.5, wght: 500, color: sel ? C.accent : C.fg)),
                ]),
              ),
            );
          },
        ),
      ),
      const SizedBox(height: 10),
      Wrap(spacing: 12, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
        Text('Sortie : ${_outLabel(s)}', style: T.mono(12.5)),
        OutlinedButton.icon(
          onPressed: s.cropOn && s.mode != 'edit' ? () => s.setMode('edit') : null,
          icon: const Icon(Icons.crop, size: 18),
          label: const Text('Ajuster le cadre'),
        ),
      ]),
      const SizedBox(height: 16),
      const SectionLabel('Orientation'),
      Row(children: [
        _OrientButton(Icons.rotate_left, 'Gauche', false, () => s.rotate(-90)),
        const SizedBox(width: 8),
        _OrientButton(Icons.rotate_right, 'Droite', false, () => s.rotate(90)),
        const SizedBox(width: 8),
        _OrientButton(Icons.flip, 'Miroir', s.flipH, s.toggleFlipH),
        const SizedBox(width: 8),
        _OrientButton(Icons.flip, 'Haut/bas', s.flipV, s.toggleFlipV, turned: true),
      ]),
      if (s.rot != 0) ...[
        const SizedBox(height: 6),
        Text('Rotation ${s.rot}°', style: T.mono(12.5)),
      ],
      const SizedBox(height: 16),
      if (!(s.current?.isImage ?? false)) _TrackingSection(state: s),
    ]);
  }

  String _outLabel(AppState s) {
    if (!s.cropOn) return '${s.srcW} × ${s.srcH} px';
    return '${(s.crop.w * s.srcW / 2).round() * 2} × ${(s.crop.h * s.srcH / 2).round() * 2} px';
  }
}

class _RatioGlyph extends StatelessWidget {
  const _RatioGlyph({required this.id, required this.ratio, required this.color});
  final String id;
  final double? ratio;
  final Color color;

  @override
  Widget build(BuildContext context) {
    if (id == 'none') return Icon(Icons.crop_original, size: 22, color: color);
    if (id == 'free') return Icon(Icons.crop_free, size: 22, color: color);
    final r = ratio!;
    final w = r >= 1 ? 30.0 : 24.0 * r, h = r >= 1 ? 30.0 / r : 24.0;
    return Container(
      width: w,
      height: h,
      decoration: BoxDecoration(border: Border.all(color: color, width: 1.8), borderRadius: BorderRadius.circular(2)),
    );
  }
}

class _OrientButton extends StatelessWidget {
  const _OrientButton(this.icon, this.label, this.selected, this.onTap, {this.turned = false});
  final IconData icon;
  final String label;
  final bool selected, turned;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? C.accent : C.fg;
    return Expanded(
      child: SizedBox(
        height: 64,
        child: ChoiceTile(
          selected: selected,
          onTap: onTap,
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            RotatedBox(quarterTurns: turned ? 1 : 0, child: Icon(icon, size: 22, color: color)),
            const SizedBox(height: 3),
            Text(label, style: T.body(12, color: color), maxLines: 1, overflow: TextOverflow.ellipsis),
          ]),
        ),
      ),
    );
  }
}

class _TrackingSection extends StatelessWidget {
  const _TrackingSection({required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    final s = state;
    return ValueListenableBuilder(
      valueListenable: s.live,
      builder: (context, live, _) {
        final t = live.track;
        final (color, label) = switch (t.state) {
          'other' => (C.muted, 'Lié à une autre vidéo'),
          'pending' => (C.muted, 'Démarre à ${fmtTime(t.at)}'),
          'lost' => (C.err, 'Sujet perdu'),
          'ok' => (C.ok, 'Sujet suivi'),
          _ => (C.muted, 'Inactif'),
        };
        final active = t.state != 'idle';
        final selecting = s.mode == 'select';
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          SectionLabel('Suivi du sujet', trailing: StatusPill(label, color)),
          Row(children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: s.pickSubject,
                icon: Icon(selecting ? Icons.close : Icons.center_focus_strong, size: 18),
                label: Text(selecting ? 'Annuler' : (active ? 'Autre sujet' : 'Choisir le sujet')),
              ),
            ),
            if (active) ...[
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton(onPressed: s.stopTracking, child: const Text('Arrêter le suivi')),
              ),
            ],
          ]),
          const SizedBox(height: 10),
          ValueSlider(spec: followSlider, state: s),
          Text(
            selecting
                ? 'Plus le sujet est contrasté (poisson, plongeur, tortue…), mieux il est suivi.'
                : active
                    ? 'Le cadre suit le sujet à partir de ${fmtTime(t.at)}. Lancez la lecture pour vérifier.'
                    : 'Placez la vidéo sur une image où le sujet est bien visible, puis choisissez-le.',
            style: T.body(13, color: C.muted),
          ),
        ]);
      },
    );
  }
}

class StatusPill extends StatelessWidget {
  const StatusPill(this.text, this.color, {super.key});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(border: Border.all(color: color), borderRadius: BorderRadius.circular(99)),
        child: Text(text.toUpperCase(), style: T.body(10, wght: 600, color: color).copyWith(letterSpacing: .7)),
      );
}

// ---------- Analyse ----------
class _AnalysisPanel extends StatelessWidget {
  const _AnalysisPanel({required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder(
      valueListenable: state.live,
      builder: (context, live, _) {
        final h = live.hist;
        final warn = h != null && (h.lo > .02 || h.hi > .02);
        String p(double v) => '${(v * 100).toStringAsFixed(1).replaceAll('.', ',')} %';
        return _Scroll(children: [
          const SectionLabel('Histogramme'),
          _Columns(children: [
            Padding(padding: const EdgeInsets.only(bottom: 8), child: HistChart('Original', h?.original)),
            Padding(padding: const EdgeInsets.only(bottom: 8), child: HistChart('Corrigé', h?.corrected)),
          ]),
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Text('Noirs', style: T.mono(11)),
            Text('Tons moyens', style: T.mono(11)),
            Text('Blancs', style: T.mono(11)),
          ]),
          const SizedBox(height: 6),
          if (h != null)
            Text('Après correction : ${p(h.lo)} de noirs bouchés · ${p(h.hi)} de blancs brûlés',
                style: T.body(13, color: warn ? C.accent : C.muted)),
          const SizedBox(height: 16),
          const SectionLabel('Correction appliquée en direct'),
          _GainBar('Rouge', live.gains[0], C.r),
          _GainBar('Vert', live.gains[1], C.g),
          _GainBar('Bleu', live.gains[2], C.b),
        ]);
      },
    );
  }
}

class _GainBar extends StatelessWidget {
  const _GainBar(this.label, this.value, this.color);
  final String label;
  final double value;
  final Color color;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(children: [
          SizedBox(width: 52, child: Text(label, style: T.mono(12.5, color: C.fg))),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: (value / 6).clamp(0.0, 1.0),
                minHeight: 7,
                backgroundColor: C.panel2,
                valueColor: AlwaysStoppedAnimation(color),
              ),
            ),
          ),
          SizedBox(
            width: 56,
            child: Text('×${value.toStringAsFixed(2)}', textAlign: TextAlign.right, style: T.mono(12.5, color: C.fg)),
          ),
        ]),
      );
}

class HistChart extends StatelessWidget {
  const HistChart(this.title, this.data, {super.key});
  final String title;
  final List<List<double>>? data;

  @override
  Widget build(BuildContext context) => Semantics(
        label: 'Histogramme RVB : $title',
        child: SizedBox(
          height: 76,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Stack(fit: StackFit.expand, children: [
              CustomPaint(painter: _HistPainter(data)),
              Positioned(left: 8, top: 5, child: Text(title.toUpperCase(), style: T.mono(10, color: C.fg, medium: true))),
            ]),
          ),
        ),
      );
}

class _HistPainter extends CustomPainter {
  _HistPainter(this.data);
  final List<List<double>>? data;
  // Palette au moment de la construction : un changement de thème doit redessiner, même si les données sont les mêmes.
  final Palette palette = C.palette;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = C.panel2);
    final grid = Paint()..color = C.fg.withAlpha(0x12);
    for (var q = 1; q < 4; q++) {
      canvas.drawLine(Offset(size.width * q / 4, 0), Offset(size.width * q / 4, size.height), grid);
    }
    final h = data;
    if (h == null) return;
    final bins = h[0].length;
    // Échelle en racine carrée, normalisée sans les cases extrêmes (souvent saturées).
    var m = 1.0;
    for (final ch in h) {
      for (var i = 1; i < bins - 1; i++) {
        m = math.max(m, ch[i]);
      }
    }
    canvas.saveLayer(Offset.zero & size, Paint());
    final colors = [C.r, C.g, C.b];
    for (var c = 0; c < 3; c++) {
      final ch = h[c];
      final path = Path()..moveTo(0, size.height);
      for (var i = 0; i < bins; i++) {
        final v = (ch[math.max(0, i - 1)] + 2 * ch[i] + ch[math.min(bins - 1, i + 1)]) / 4;
        path.lineTo(i / (bins - 1) * size.width, size.height - math.min(1.0, math.sqrt(v / m)) * size.height * .92);
      }
      path
        ..lineTo(size.width, size.height)
        ..close();
      canvas.drawPath(path, Paint()
        ..blendMode = BlendMode.plus
        ..color = colors[c].withValues(alpha: .5));
      canvas.drawPath(path, Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2
        ..blendMode = BlendMode.plus
        ..color = colors[c]);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_HistPainter old) => old.data != data || old.palette != palette;
}

// ---------- Vidéos ----------
/// Partie de la vidéo affichée à exporter, à régler au doigt ou depuis la position de lecture.
class _TrimSection extends StatelessWidget {
  const _TrimSection({required this.state, required this.item});
  final AppState state;
  final VideoItem item;

  @override
  Widget build(BuildContext context) {
    final s = state, it = item;
    final d = it.duration, end = it.trimOut ?? d;
    final enabled = !s.exporting;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        const Expanded(child: SectionLabel('Partie à exporter')),
        Text('${fmtTime(it.trimIn)} → ${fmtTime(end)} · ${fmtTime(end - it.trimIn)}', style: T.mono(12)),
      ]),
      RangeSlider(
        values: RangeValues(it.trimIn, end),
        max: d,
        labels: RangeLabels(fmtTime(it.trimIn), fmtTime(end)),
        onChanged: enabled
            ? (v) {
                // On montre l'image à l'endroit de la poignée déplacée.
                s.seek(v.start != it.trimIn ? v.start : v.end);
                s.setTrim(v.start, v.end);
              }
            : null,
      ),
      Wrap(spacing: 8, runSpacing: 8, children: [
        OutlinedButton.icon(
          onPressed: enabled ? s.markIn : null,
          icon: const Icon(Icons.first_page, size: 18),
          label: const Text('Début ici'),
        ),
        OutlinedButton.icon(
          onPressed: enabled ? s.markOut : null,
          icon: const Icon(Icons.last_page, size: 18),
          label: const Text('Fin ici'),
        ),
        if (it.isTrimmed)
          TextButton(onPressed: enabled ? s.clearTrim : null, child: const Text('Toute la vidéo')),
      ]),
      const SizedBox(height: 4),
    ]);
  }
}

class VideosPanel extends StatelessWidget {
  const VideosPanel({super.key, required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    final s = state;
    if (s.queue.isEmpty) {
      return Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.video_library_outlined, size: 40, color: C.muted),
            const SizedBox(height: 12),
            Text('Retrouvez les couleurs de vos plongées', textAlign: TextAlign.center, style: T.display(20)),
            const SizedBox(height: 8),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Text(
                'Ajoutez des vidéos ou des photos : les réglages s\'appliquent à toute la liste. En attendant, essayez les outils sur la scène de démonstration.',
                textAlign: TextAlign.center,
                style: T.body(14, color: C.muted),
              ),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: s.importing ? null : s.addVideos,
              icon: s.importing
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.add),
              label: Text(s.importing ? 'Import en cours…' : 'Ajouter vidéos ou photos'),
            ),
          ]),
        ),
      );
    }
    return AnimatedBuilder(
      animation: s.exportTick,
      builder: (context, _) => ListView(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 20),
        children: [
          Row(children: [
            Expanded(
              child: Text(
                '${s.queue.length} ${s.queue.length > 1 ? 'fichiers' : 'fichier'}'
                '${s.totalDuration > 0 ? ' · ${fmtTime(s.totalDuration)}' : ''}'
                '${s.doneCount > 0 ? ' · ${s.doneCount} terminée${s.doneCount > 1 ? 's' : ''}' : ''}',
                style: T.mono(12.5),
              ),
            ),
            OutlinedButton.icon(
              onPressed: s.importing ? null : s.addVideos,
              icon: s.importing
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.add, size: 18),
              label: const Text('Ajouter'),
            ),
          ]),
          if (s.unsavedCount > 1 || (s.doneCount > 0 && !s.batchRunning)) ...[
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              if (s.unsavedCount > 1)
                OutlinedButton.icon(
                  onPressed: s.saveAll,
                  icon: const Icon(Icons.save_alt, size: 18),
                  label: Text('Tout enregistrer (${s.unsavedCount})'),
                ),
              if (s.doneCount > 0 && !s.batchRunning)
                OutlinedButton(onPressed: s.clearDone, child: const Text('Retirer les terminées')),
            ]),
          ],
          if (s.current case final cur? when !cur.isImage && cur.duration > AppState.minClip) ...[
            const SizedBox(height: 10),
            _TrimSection(state: s, item: cur),
          ],
          const SizedBox(height: 8),
          _Columns(children: [for (final it in s.queue) QueueTile(state: s, item: it)]),
        ],
      ),
    );
  }
}

class Thumb extends StatelessWidget {
  const Thumb(this.item, {super.key, this.width = 88, this.height = 56});
  final VideoItem item;
  final double width, height;

  @override
  Widget build(BuildContext context) => ClipRRect(
        borderRadius: BorderRadius.circular(6),
        child: Container(
          width: width,
          height: height,
          color: item.thumb == null ? C.panel2 : Colors.black,
          child: item.thumb == null
              ? Icon(Icons.movie_outlined, color: C.muted)
              : Image.memory(item.thumb!, fit: BoxFit.cover, gaplessPlayback: true),
        ),
      );
}

class QueueTile extends StatelessWidget {
  const QueueTile({super.key, required this.state, required this.item});
  final AppState state;
  final VideoItem item;

  (Color, String) get _pill => switch (item.status) {
        ItemStatus.wait => (C.muted, item.status.label),
        ItemStatus.run => (C.accent, item.status.label),
        ItemStatus.done => (C.ok, item.saved ? 'Enregistrée' : item.status.label),
        ItemStatus.err => (C.err, item.status.label),
      };

  String get _meta {
    final d = item.isImage
        ? 'Photo'
        : item.duration <= 0
            ? '…'
            : item.isTrimmed
                ? 'Extrait ${fmtTime(item.clipDuration)}'
                : fmtTime(item.duration);
    switch (item.status) {
      case ItemStatus.run:
        final sp = item.speed > 0 ? ' · ×${item.speed.toStringAsFixed(1).replaceAll('.', ',')}' : '';
        if (item.mode == 'analyse') return 'Analyse du sujet · ${(item.analysis * 100).round()} %';
        return '${(item.progress * 100).round()} %$sp${item.mode == 'rt' ? ' · temps réel' : ''}';
      case ItemStatus.done:
        return '$d · ${fmtSize(item.outputBytes)} en ${fmtLong(item.exportTime)}'
            '${item.mode == 'rt' ? ' · temps réel' : ''}${item.muted ? ' · sans son' : ''}';
      case ItemStatus.err:
        return item.error;
      case ItemStatus.wait:
        return '$d · ${fmtSize(item.size)}';
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = state, it = item;
    final isCurrent = s.current == it;
    final (color, label) = _pill;
    final canPreview = !s.exporting && it.status != ItemStatus.err && !isCurrent;
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Material(
        color: isCurrent ? C.panel2 : C.panel,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
          side: BorderSide(color: isCurrent ? C.accent : C.line),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: canPreview ? () => s.preview(it) : null,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 10, 4, 6),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Thumb(it),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(it.name, style: T.body(14, wght: 500), maxLines: 1, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 4),
                    StatusPill(label, color),
                    const SizedBox(height: 4),
                    Text(_meta, style: T.mono(12), maxLines: 3, overflow: TextOverflow.ellipsis),
                  ]),
                ),
                if (it != s.running)
                  IconButton(
                    tooltip: 'Retirer de la liste',
                    icon: Icon(Icons.close, color: C.muted),
                    onPressed: () => s.remove(it),
                  ),
              ]),
            ),
            if (it.status == ItemStatus.run)
              Padding(
                padding: const EdgeInsets.fromLTRB(10, 0, 10, 10),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(3),
                  child: LinearProgressIndicator(value: it.shownProgress, minHeight: 5, backgroundColor: C.line),
                ),
              ),
            if (it.status == ItemStatus.done)
              Padding(
                padding: const EdgeInsets.fromLTRB(10, 0, 10, 10),
                child: Row(children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => it.isImage
                              ? PhotoViewer(file: it.output!, title: it.name)
                              : ResultPlayer(file: it.output!, title: it.name),
                        ),
                      ),
                      icon: const Icon(Icons.play_circle_outline, size: 18),
                      label: const Text('Voir'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: it.saved
                        ? OutlinedButton.icon(
                            onPressed: () => s.save(it),
                            icon: Icon(Icons.check, size: 18, color: C.ok),
                            label: const Text('Enregistrée'),
                          )
                        : FilledButton.icon(
                            onPressed: () => s.save(it),
                            icon: const Icon(Icons.save_alt, size: 18),
                            label: const Text('Enregistrer'),
                          ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.outlined(
                    tooltip: 'Partager',
                    constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                    onPressed: () => s.share(it),
                    icon: const Icon(Icons.ios_share, size: 20),
                  ),
                ]),
              ),
            if (it.status == ItemStatus.err)
              Align(
                alignment: Alignment.centerLeft,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(10, 0, 10, 10),
                  child: OutlinedButton(onPressed: s.exporting ? null : () => s.retry(it), child: const Text('Réessayer')),
                ),
              ),
          ]),
        ),
      ),
    );
  }
}

/// Bande de vidéos affichée sous le moniteur sur tablette : changer de vidéo d'un toucher.
class Filmstrip extends StatelessWidget {
  const Filmstrip({super.key, required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    final s = state;
    return SizedBox(
      height: 92,
      child: AnimatedBuilder(
        animation: s.exportTick,
        builder: (context, _) => ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          children: [
            for (final it in s.queue)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: Semantics(
                  button: true,
                  label: it.name,
                  child: GestureDetector(
                    onTap: () => s.preview(it),
                    child: Stack(children: [
                      Container(
                        foregroundDecoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: s.current == it ? C.accent : C.line, width: s.current == it ? 2 : 1),
                        ),
                        child: Thumb(it, width: 118, height: 76),
                      ),
                      Positioned(
                        right: 5,
                        top: 5,
                        child: Icon(
                          switch (it.status) {
                            ItemStatus.done => Icons.check_circle,
                            ItemStatus.err => Icons.error,
                            ItemStatus.run => Icons.autorenew,
                            ItemStatus.wait => null,
                          },
                          size: 18,
                          color: it.status == ItemStatus.err ? C.err : (it.status == ItemStatus.done ? C.ok : C.accent),
                        ),
                      ),
                      if (it.status == ItemStatus.run)
                        Positioned(
                          left: 4,
                          right: 4,
                          bottom: 4,
                          child: LinearProgressIndicator(value: it.shownProgress, minHeight: 4, backgroundColor: const Color(0x66000000)),
                        ),
                    ]),
                  ),
                ),
              ),
            Center(
              child: IconButton.outlined(
                tooltip: 'Ajouter des vidéos',
                constraints: const BoxConstraints(minWidth: 76, minHeight: 76),
                onPressed: s.importing ? null : s.addVideos,
                icon: const Icon(Icons.add),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
