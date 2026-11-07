import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../model/crop.dart';
import '../state/app_state.dart';
import '../theme.dart';

/// Moniteur : la surface du moteur et, par-dessus, les gestes et repères dessinés en Flutter.
///
/// Mode normal : glisser = ligne avant/après, toucher = lecture/pause, maintenir = original.
/// Mode cadre : déplacer le cadre ou tirer ses coins. Mode sujet : entourer ou toucher le sujet.
class Stage extends StatelessWidget {
  const Stage({super.key, required this.state, required this.surface});
  final AppState state;
  final Widget surface;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Colors.black,
      child: Center(
        child: AspectRatio(
          aspectRatio: state.stageRatio,
          child: Stack(
            fit: StackFit.expand,
            children: [
              IgnorePointer(child: surface),
              switch (state.mode) {
                'edit' => _CropLayer(state: state),
                'select' => _SelectLayer(state: state),
                _ => _CompareLayer(state: state),
              },
            ],
          ),
        ),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill(this.text, {this.color = const Color(0x99000000), this.big = false});
  final String text;
  final Color color;
  final bool big;

  @override
  Widget build(BuildContext context) => Container(
        padding: EdgeInsets.symmetric(horizontal: big ? 12 : 8, vertical: big ? 6 : 4),
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(big ? 99 : 5)),
        child: Text(text,
            textAlign: TextAlign.center,
            style: big ? T.body(13, wght: 500, color: Colors.white) : T.mono(11, color: Colors.white, medium: true)),
      );
}

// ---------- Mode normal : comparaison ----------
class _CompareLayer extends StatefulWidget {
  const _CompareLayer({required this.state});
  final AppState state;
  @override
  State<_CompareLayer> createState() => _CompareLayerState();
}

class _CompareLayerState extends State<_CompareLayer> {
  bool _touched = false;

  void _drag(DragUpdateDetails d, double width) {
    if (!widget.state.compare || widget.state.exporting) return;
    if (!_touched) setState(() => _touched = true);
    widget.state.setSplit(d.localPosition.dx / width);
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.state;
    final holding = s.holdingOriginal;
    final showLine = s.compare && !holding && !s.exporting;
    return LayoutBuilder(builder: (context, c) {
      return GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: s.exporting ? null : s.togglePlay,
        onHorizontalDragStart: (d) {
          if (s.compare && !s.exporting) s.setSplit(d.localPosition.dx / c.maxWidth);
        },
        onHorizontalDragUpdate: (d) => _drag(d, c.maxWidth),
        onLongPressStart: s.exporting
            ? null
            : (_) {
                HapticFeedback.selectionClick();
                s.holdOriginal(true);
              },
        onLongPressEnd: s.exporting ? null : (_) => s.holdOriginal(false),
        child: Stack(children: [
          if (s.fatalError != null)
            Center(child: _Pill(s.fatalError!, big: true, color: const Color(0xCCB3261E))),
          if (showLine) ...[
            Positioned(
              left: s.split * c.maxWidth - 1,
              top: 0,
              bottom: 0,
              child: Container(width: 2, color: Colors.white),
            ),
            Positioned(
              left: s.split * c.maxWidth - 18,
              top: c.maxHeight / 2 - 18,
              child: Container(
                width: 36,
                height: 36,
                decoration: const BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  boxShadow: [BoxShadow(color: Color(0x66000000), blurRadius: 8, offset: Offset(0, 2))],
                ),
                child: const Icon(Icons.unfold_more, color: Color(0xFF333333), size: 22, semanticLabel: 'Ligne de comparaison')
                    ._rotated(),
              ),
            ),
            const Positioned(left: 10, top: 10, child: _Pill('ORIGINAL')),
          ],
          if (holding) const Positioned(left: 10, top: 10, child: _Pill('ORIGINAL')),
          if (!holding) const Positioned(right: 10, top: 10, child: _Pill('CORRIGÉ')),
          if (!s.hasVideo)
            const Positioned(left: 10, bottom: 10, child: _Pill('SCÈNE DE DÉMONSTRATION')),
          if (s.compare && !_touched && !s.exporting && !holding)
            const Positioned(
              left: 8,
              right: 8,
              bottom: 40,
              child: IgnorePointer(
                child: Center(child: _Pill('Glissez pour comparer · maintenez pour voir l\'original', big: true)),
              ),
            ),
          ValueListenableBuilder(
            valueListenable: s.live,
            builder: (context, live, _) => live.track.state == 'lost'
                ? const Positioned(top: 44, left: 8, right: 8, child: Center(child: _Pill('Sujet perdu de vue', big: true, color: Color(0xCCB3261E))))
                : const SizedBox.shrink(),
          ),
          ValueListenableBuilder(
            valueListenable: s.playback,
            builder: (context, p, _) => (!p.playing && !s.exporting && !holding)
                ? const Center(
                    child: IgnorePointer(
                      child: DecoratedBox(
                        decoration: BoxDecoration(color: Color(0x80000000), shape: BoxShape.circle),
                        child: Padding(padding: EdgeInsets.all(12), child: Icon(Icons.play_arrow, size: 36, color: Colors.white)),
                      ),
                    ),
                  )
                : const SizedBox.shrink(),
          ),
          if (s.exporting)
            const Positioned(left: 10, bottom: 10, child: _Pill('EXPORT EN COURS')),
        ]),
      );
    });
  }
}

extension on Icon {
  Widget _rotated() => RotatedBox(quarterTurns: 1, child: this);
}

// ---------- Mode cadre ----------
class _CropLayer extends StatefulWidget {
  const _CropLayer({required this.state});
  final AppState state;
  @override
  State<_CropLayer> createState() => _CropLayerState();
}

class _CropLayerState extends State<_CropLayer> {
  CropHandle? _handle;
  CropRect? _r0;
  Offset _p0 = Offset.zero;

  static const _touchRadius = 30.0; // large : un doigt n'est pas une souris

  void _start(DragStartDetails d, Size size) {
    final s = widget.state;
    final p = Offset(d.localPosition.dx / size.width, d.localPosition.dy / size.height);
    final h = hitCrop(s.crop, p.dx, p.dy, _touchRadius / size.width, _touchRadius / size.height);
    if (h == null) return;
    final tracked = s.live.value.track.state != 'idle' && s.live.value.track.state != 'other';
    if (h == CropHandle.move && tracked) return; // la position suit le sujet
    _handle = h;
    _r0 = s.crop;
    _p0 = p;
    s.beginCropDrag();
    HapticFeedback.selectionClick();
  }

  void _update(DragUpdateDetails d, Size size) {
    final h = _handle, r0 = _r0;
    if (h == null || r0 == null) return;
    final s = widget.state;
    final p = Offset(
      (d.localPosition.dx / size.width).clamp(0.0, 1.0),
      (d.localPosition.dy / size.height).clamp(0.0, 1.0),
    );
    s.updateCrop(h == CropHandle.move
        ? moveCrop(r0, p.dx - _p0.dx, p.dy - _p0.dy)
        : resizeCrop(r0, h, p.dx, p.dy, s.normRatio));
  }

  void _end() {
    _handle = null;
    widget.state.endCropDrag();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.state;
    return LayoutBuilder(builder: (context, c) {
      final size = c.biggest;
      return GestureDetector(
        behavior: HitTestBehavior.opaque,
        onPanStart: (d) => _start(d, size),
        onPanUpdate: (d) => _update(d, size),
        onPanEnd: (_) => _end(),
        onPanCancel: _end,
        child: CustomPaint(painter: CropPainter(s.crop, s.live.value.track), size: size),
      );
    });
  }
}

class CropPainter extends CustomPainter {
  CropPainter(this.crop, this.track);
  final CropRect crop;
  final TrackInfo track;
  // Palette au moment de la construction : un changement de thème doit redessiner, même si les données sont les mêmes.
  final Palette palette = C.palette;

  @override
  void paint(Canvas canvas, Size size) {
    final r = Rect.fromLTWH(crop.x * size.width, crop.y * size.height, crop.w * size.width, crop.h * size.height);
    canvas.drawPath(
      Path()
        ..fillType = PathFillType.evenOdd
        ..addRect(Offset.zero & size)
        ..addRect(r),
      Paint()..color = const Color(0x94000000),
    );
    final thin = Paint()
      ..color = const Color(0x55FFFFFF)
      ..strokeWidth = 1;
    for (final k in [1 / 3, 2 / 3]) {
      canvas.drawLine(Offset(r.left + r.width * k, r.top), Offset(r.left + r.width * k, r.bottom), thin);
      canvas.drawLine(Offset(r.left, r.top + r.height * k), Offset(r.right, r.top + r.height * k), thin);
    }
    canvas.drawRect(
      r,
      Paint()
        ..style = PaintingStyle.stroke
        ..color = Colors.white
        ..strokeWidth = 1.5,
    );
    // Coins en équerre, bien visibles sous le doigt
    final corner = Paint()
      ..style = PaintingStyle.stroke
      ..color = Colors.white
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 5;
    final len = (r.shortestSide * .3).clamp(10.0, 26.0);
    for (final (p, dx, dy) in [
      (r.topLeft, 1.0, 1.0),
      (r.topRight, -1.0, 1.0),
      (r.bottomLeft, 1.0, -1.0),
      (r.bottomRight, -1.0, -1.0),
    ]) {
      canvas.drawLine(p, p.translate(dx * len, 0), corner);
      canvas.drawLine(p, p.translate(0, dy * len), corner);
    }
    if (track.state == 'ok' || track.state == 'lost' || track.state == 'pending') {
      canvas.drawRect(
        Rect.fromCenter(
          center: Offset(track.x * size.width, track.y * size.height),
          width: track.w * size.width,
          height: track.h * size.height,
        ),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..color = track.state == 'lost' ? C.err : C.accent,
      );
    }
  }

  @override
  bool shouldRepaint(CropPainter old) => old.crop != crop || old.track != track || old.palette != palette;
}

// ---------- Mode sujet ----------
class _SelectLayer extends StatefulWidget {
  const _SelectLayer({required this.state});
  final AppState state;
  @override
  State<_SelectLayer> createState() => _SelectLayerState();
}

class _SelectLayerState extends State<_SelectLayer> {
  Offset? _a, _b;

  @override
  Widget build(BuildContext context) {
    final s = widget.state;
    return LayoutBuilder(builder: (context, c) {
      final size = c.biggest;
      Offset norm(Offset p) => Offset((p.dx / size.width).clamp(0.0, 1.0), (p.dy / size.height).clamp(0.0, 1.0));
      return GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapUp: (d) {
          final p = norm(d.localPosition);
          s.selectSubject(p.dx, p.dy, p.dx, p.dy);
        },
        onPanStart: (d) => setState(() => _a = _b = norm(d.localPosition)),
        onPanUpdate: (d) => setState(() => _b = norm(d.localPosition)),
        onPanEnd: (_) {
          final a = _a, b = _b;
          setState(() => _a = _b = null);
          if (a != null && b != null) s.selectSubject(a.dx, a.dy, b.dx, b.dy);
        },
        child: CustomPaint(painter: _SelectionPainter(_a, _b), size: size),
      );
    });
  }
}

class _SelectionPainter extends CustomPainter {
  _SelectionPainter(this.a, this.b);
  final Offset? a, b;
  // Palette au moment de la construction : un changement de thème doit redessiner, même si les données sont les mêmes.
  final Palette palette = C.palette;

  @override
  void paint(Canvas canvas, Size size) {
    final p = a, q = b;
    if (p == null || q == null) return;
    canvas.drawRect(
      Rect.fromPoints(Offset(p.dx * size.width, p.dy * size.height), Offset(q.dx * size.width, q.dy * size.height)),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.5
        ..color = C.accent,
    );
  }

  @override
  bool shouldRepaint(_SelectionPainter old) => old.a != a || old.b != b || old.palette != palette;
}
