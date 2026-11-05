import 'package:flutter_test/flutter_test.dart';
import 'package:rouge_retrouve/model/crop.dart';

void main() {
  const r = CropRect(.2, .2, .5, .5);

  test('déplacer le cadre reste dans l\'image', () {
    final m = moveCrop(r, .9, -.9);
    expect(m.x, closeTo(.5, 1e-9));
    expect(m.y, 0);
    expect(m.w, r.w);
  });

  test('tirer un coin garde le coin opposé fixe', () {
    final c = resizeCrop(r, CropHandle.nw, .1, .1, null);
    expect(c.right, closeTo(r.right, 1e-9));
    expect(c.bottom, closeTo(r.bottom, 1e-9));
    expect(c.w, closeTo(.6, 1e-9));
  });

  test('le rapport imposé est respecté', () {
    final c = resizeCrop(r, CropHandle.se, .95, .4, 1.5);
    expect(c.w / c.h, closeTo(1.5, 1e-9));
    expect(c.x, r.x);
    expect(c.y, r.y);
  });

  test('le cadre ne déborde jamais et garde une taille minimale', () {
    final big = resizeCrop(r, CropHandle.se, 5, 5, null);
    expect(big.right, lessThanOrEqualTo(1));
    expect(big.bottom, lessThanOrEqualTo(1));
    final tiny = resizeCrop(r, CropHandle.se, r.x, r.y, null);
    expect(tiny.w, closeTo(.05, 1e-9));
  });

  test('la zone tactile d\'un coin dépasse le cadre, et le centre déplace', () {
    expect(hitCrop(r, .19, .19, .03, .05), CropHandle.nw);
    expect(hitCrop(r, .71, .71, .03, .05), CropHandle.se);
    expect(hitCrop(r, .45, .45, .03, .05), CropHandle.move);
    expect(hitCrop(r, .95, .05, .03, .05), isNull);
  });
}
