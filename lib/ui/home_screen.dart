import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../state/app_state.dart';
import '../theme.dart';
import 'panels.dart';
import 'sheets.dart';
import 'stage.dart';
import 'transport.dart';

/// Écran unique, adapté à la place disponible :
/// - téléphone portrait : moniteur en haut, outil au milieu, barre d'outils sous le pouce ;
/// - téléphone paysage : barre latérale, moniteur au centre, outil à droite ;
/// - tablette portrait : même logique, grand moniteur et outil sur deux colonnes ;
/// - tablette paysage : moniteur et bande de vidéos à gauche, console d'outils à droite.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.state, required this.surface});
  final AppState state;
  final Widget surface;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  StreamSubscription<AppMessage>? _sub;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _sub = widget.state.messages.listen((m) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(
          content: Text(m.text),
          action: m.actionLabel == null ? null : SnackBarAction(label: m.actionLabel!, onPressed: m.action ?? () {}),
        ));
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.paused && !widget.state.exporting) widget.state.pause();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _sub?.cancel();
    super.dispose();
  }

  Future<bool> _confirmLeave() async {
    final s = widget.state;
    final leave = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Quitter ?'),
        content: Text(s.exporting
            ? 'Un export est en cours : il sera perdu.'
            : 'Les vidéos exportées et non enregistrées seront perdues.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Rester')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Quitter')),
        ],
      ),
    );
    return leave ?? false;
  }

  void _primary() {
    final s = widget.state;
    if (s.queue.isEmpty) {
      s.addVideos();
    } else {
      showExportSheet(context, s);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.state;
    return ListenableBuilder(
      listenable: s,
      builder: (context, _) => PopScope(
        canPop: !s.hasPendingWork,
        onPopInvokedWithResult: (didPop, _) async {
          if (didPop) return;
          final nav = Navigator.of(context);
          if (await _confirmLeave()) nav.pop();
        },
        child: Scaffold(
          body: LayoutBuilder(builder: (context, c) {
            final landscape = c.maxWidth > c.maxHeight;
            final isPhoneLandscape = landscape && c.maxHeight < 500;
            final isTabletLandscape = landscape && !isPhoneLandscape && c.maxWidth >= 840;
            if (isPhoneLandscape) return _phoneLandscape(s);
            if (isTabletLandscape) return _tabletLandscape(s, c);
            return _portrait(s, c);
          }),
        ),
      ),
    );
  }

  Widget get _surface => widget.surface;

  // ---------- Portrait (téléphone et tablette, et petites fenêtres) ----------
  Widget _portrait(AppState s, BoxConstraints c) {
    final tablet = c.maxWidth >= 600;
    // Le moniteur garde sa proportion, sans jamais priver l'outil de place.
    final maxStage = c.maxHeight * (tablet ? .5 : .4);
    final stageH = math.min(c.maxWidth / s.stageRatio, maxStage);
    return Column(children: [
      SafeArea(bottom: false, child: _TopBar(state: s, onPrimary: _primary)),
      ExportBanner(state: s),
      SizedBox(height: stageH, child: Stage(state: s, surface: _surface)),
      Transport(state: s),
      const Divider(),
      Expanded(child: ColoredBox(color: C.panel, child: ToolPanel(state: s))),
      const Divider(),
      SafeArea(top: false, child: _ToolBar(state: s)),
    ]);
  }

  // ---------- Téléphone paysage : priorité à l'image ----------
  Widget _phoneLandscape(AppState s) {
    return SafeArea(
      child: Row(children: [
        _ToolRail(state: s, onPrimary: _primary),
        const VerticalDivider(width: 1),
        Expanded(
          child: Column(children: [
            ExportBanner(state: s),
            Expanded(child: Stage(state: s, surface: _surface)),
            Transport(state: s),
          ]),
        ),
        const VerticalDivider(width: 1),
        SizedBox(width: 300, child: ColoredBox(color: C.panel, child: ToolPanel(state: s))),
      ]),
    );
  }

  // ---------- Tablette paysage : console permanente et bande de vidéos ----------
  Widget _tabletLandscape(AppState s, BoxConstraints c) {
    return Column(children: [
      SafeArea(bottom: false, child: _TopBar(state: s, onPrimary: _primary)),
      ExportBanner(state: s),
      Expanded(
        child: SafeArea(
          top: false,
          child: Row(children: [
            Expanded(
              child: Column(children: [
                Expanded(child: Stage(state: s, surface: _surface)),
                Transport(state: s),
                if (s.queue.isNotEmpty) ...[const Divider(), Filmstrip(state: s)],
              ]),
            ),
            const VerticalDivider(width: 1),
            SizedBox(
              width: math.min(400, c.maxWidth * .4),
              child: ColoredBox(
                color: C.panel,
                child: Column(children: [
                  _ToolBar(state: s),
                  const Divider(),
                  Expanded(child: ToolPanel(state: s)),
                ]),
              ),
            ),
          ]),
        ),
      ),
    ]);
  }
}

class _Brand extends StatelessWidget {
  const _Brand();

  @override
  Widget build(BuildContext context) => Text.rich(
        TextSpan(children: [
          TextSpan(text: 'Rouge ', style: T.display(21)),
          TextSpan(text: 'retrouvé', style: T.display(21, color: C.accent)),
        ]),
        maxLines: 1,
      );
}

class _PrimaryButton extends StatelessWidget {
  const _PrimaryButton({required this.state, required this.onPressed});
  final AppState state;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final s = state;
    final empty = s.queue.isEmpty;
    return FilledButton.icon(
      onPressed: s.exporting || s.importing || (!empty && !s.canExport) ? null : onPressed,
      icon: Icon(empty ? Icons.add : Icons.ios_share, size: 19),
      label: Text(empty ? 'Ajouter' : 'Exporter'),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.state, required this.onPrimary});
  final AppState state;
  final VoidCallback onPrimary;

  @override
  Widget build(BuildContext context) {
    final name = state.current?.name;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 6, 12, 6),
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            const _Brand(),
            if (name != null) Text(name, style: T.mono(11.5), maxLines: 1, overflow: TextOverflow.ellipsis),
          ]),
        ),
        IconButton(
          tooltip: 'Comment ça marche',
          onPressed: () => showHelpSheet(context),
          icon: const Icon(Icons.help_outline, color: C.muted),
        ),
        const SizedBox(width: 4),
        _PrimaryButton(state: state, onPressed: onPrimary),
      ]),
    );
  }
}

const _tools = <(Tool, IconData, String)>[
  (Tool.videos, Icons.video_library_outlined, 'Vidéos'),
  (Tool.color, Icons.palette_outlined, 'Couleur'),
  (Tool.stabilize, Icons.vibration, 'Stabilité'),
  (Tool.frame, Icons.crop, 'Cadre'),
  (Tool.analysis, Icons.bar_chart, 'Analyse'),
];

class _ToolButton extends StatelessWidget {
  const _ToolButton({required this.state, required this.tool, required this.icon, required this.label, this.compact = false});
  final AppState state;
  final Tool tool;
  final IconData icon;
  final String label;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final sel = state.tool == tool;
    final color = sel ? C.accent : C.muted;
    final n = state.queue.length;
    return Semantics(
      button: true,
      selected: sel,
      child: InkWell(
        onTap: () => state.setTool(tool),
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: compact ? 5 : 8),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Badge(
              isLabelVisible: tool == Tool.videos && n > 0,
              backgroundColor: C.accent,
              textColor: C.accentInk,
              label: Text('$n'),
              child: Icon(icon, color: color, size: compact ? 21 : 24),
            ),
            const SizedBox(height: 3),
            Text(label, style: T.body(11.5, wght: sel ? 600 : 400, color: color), maxLines: 1),
          ]),
        ),
      ),
    );
  }
}

class _ToolBar extends StatelessWidget {
  const _ToolBar({required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) => Row(children: [
        for (final (t, i, l) in _tools)
          Expanded(child: _ToolButton(state: state, tool: t, icon: i, label: l)),
      ]);
}

class _ToolRail extends StatelessWidget {
  const _ToolRail({required this.state, required this.onPrimary});
  final AppState state;
  final VoidCallback onPrimary;

  @override
  Widget build(BuildContext context) {
    final empty = state.queue.isEmpty;
    return SizedBox(
      width: 72,
      child: Column(children: [
        Expanded(
          child: SingleChildScrollView(
            child: Column(children: [
              for (final (t, i, l) in _tools) _ToolButton(state: state, tool: t, icon: i, label: l, compact: true),
            ]),
          ),
        ),
        IconButton.filled(
          tooltip: empty ? 'Ajouter des vidéos' : 'Exporter',
          onPressed: state.exporting || state.importing || (!empty && !state.canExport) ? null : onPrimary,
          icon: Icon(empty ? Icons.add : Icons.ios_share),
        ),
        const SizedBox(height: 6),
      ]),
    );
  }
}
