import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rouge_retrouve/model/crop.dart';
import 'package:rouge_retrouve/state/app_state.dart';
import 'package:rouge_retrouve/theme.dart';
import 'package:rouge_retrouve/ui/stage.dart';

// Contraste WCAG entre deux couleurs opaques.
double contrast(Color a, Color b) {
  final la = a.computeLuminance(), lb = b.computeLuminance();
  return (math.max(la, lb) + .05) / (math.min(la, lb) + .05);
}

void main() {
  for (final (name, p) in [('sombre', darkPalette), ('clair', lightPalette)]) {
    group('palette $name', () {
      final texts = {'fg': p.fg, 'muted': p.muted, 'accent': p.accent, 'r': p.r, 'g': p.g, 'b': p.b, 'ok': p.ok, 'err': p.err};
      final backgrounds = {'bg': p.bg, 'panel': p.panel, 'panel2': p.panel2};
      for (final t in texts.entries) {
        for (final f in backgrounds.entries) {
          test('${t.key} lisible sur ${f.key} (4,5:1)', () {
            expect(contrast(t.value, f.value), greaterThanOrEqualTo(4.5));
          });
        }
      }
      test('texte des boutons pleins lisible sur l\'accent', () {
        expect(contrast(p.accentInk, p.accent), greaterThanOrEqualTo(4.5));
      });
    });
  }

  test('le cadre se redessine quand le thème change, même sans bouger', () {
    const crop = CropRect(.2, .2, .5, .5), track = TrackInfo('ok');
    C.use(Brightness.dark);
    final before = CropPainter(crop, track);
    expect(CropPainter(crop, track).shouldRepaint(before), isFalse);
    C.use(Brightness.light);
    expect(CropPainter(crop, track).shouldRepaint(before), isTrue);
    C.use(Brightness.dark);
  });

  test('le thème suit la palette choisie', () {
    C.use(Brightness.light);
    expect(buildTheme().brightness, Brightness.light);
    expect(buildTheme().scaffoldBackgroundColor, lightPalette.bg);
    C.use(Brightness.dark);
    expect(buildTheme().brightness, Brightness.dark);
    expect(buildTheme().colorScheme.primary, darkPalette.accent);
  });
}
