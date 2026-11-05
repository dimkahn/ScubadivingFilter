import 'dart:math';

/// Cadre de sortie en fractions de l'image orientée (0 à 1, origine en haut à gauche).
class CropRect {
  const CropRect(this.x, this.y, this.w, this.h);
  static const full = CropRect(0, 0, 1, 1);
  final double x, y, w, h;

  double get right => x + w;
  double get bottom => y + h;
}

enum CropHandle {
  nw(true, true),
  ne(false, true),
  sw(true, false),
  se(false, false),
  move(false, false);

  const CropHandle(this.left, this.up);
  final bool left, up;
}

const _minSide = .05;

CropRect moveCrop(CropRect r0, double dx, double dy) => CropRect(
      (r0.x + dx).clamp(0.0, 1 - r0.w),
      (r0.y + dy).clamp(0.0, 1 - r0.h),
      r0.w,
      r0.h,
    );

/// Redimensionne depuis un coin, le coin opposé restant fixe.
/// [normRatio] est le rapport largeur/hauteur exprimé en fractions d'image, ou null si libre.
CropRect resizeCrop(CropRect r0, CropHandle h, double px, double py, double? normRatio) {
  final fx = h.left ? r0.right : r0.x;
  final fy = h.up ? r0.bottom : r0.y;
  var w = min(h.left ? fx : 1 - fx, max(_minSide, (px - fx).abs()));
  var hh = min(h.up ? fy : 1 - fy, max(_minSide, (py - fy).abs()));
  if (normRatio != null) {
    if (w / hh > normRatio) {
      w = hh * normRatio;
    } else {
      hh = w / normRatio;
    }
  }
  return CropRect(h.left ? fx - w : fx, h.up ? fy - hh : fy, w, hh);
}

/// Poignée sous le doigt. La tolérance est exprimée séparément sur chaque axe, car un même
/// rayon tactile ne représente pas la même fraction en largeur et en hauteur.
CropHandle? hitCrop(CropRect r, double px, double py, double tolX, double tolY) {
  bool near(double cx, double cy) => (px - cx).abs() <= tolX && (py - cy).abs() <= tolY;
  if (near(r.x, r.y)) return CropHandle.nw;
  if (near(r.right, r.y)) return CropHandle.ne;
  if (near(r.x, r.bottom)) return CropHandle.sw;
  if (near(r.right, r.bottom)) return CropHandle.se;
  if (px >= r.x && px <= r.right && py >= r.y && py <= r.bottom) return CropHandle.move;
  return null;
}
