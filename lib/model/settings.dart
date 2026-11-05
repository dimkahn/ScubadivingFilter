/// Réglages à curseur, avec leurs bornes, valeurs par défaut et formats d'affichage.
class SliderSpec {
  const SliderSpec(this.key, this.label, this.min, this.max, this.def, this.format);
  final String key;
  final String label;
  final double min;
  final double max;
  final double def;
  final String Function(double) format;
}

String _pct(double v) => '${v.round()} %';
String _x100(double v) => (v / 100).toStringAsFixed(2);
String _clip(double v) => '${(v / 10).toStringAsFixed(1)} %';

const colorSliders = [
  SliderSpec('strength', 'Intensité du filtre', 0, 100, 100, _pct),
  SliderSpec('red', 'Récupération du rouge', 0, 200, 100, _x100),
  SliderSpec('clip', 'Contraste', 0, 40, 8, _clip),
  SliderSpec('sat', 'Saturation', 0, 200, 115, _x100),
  SliderSpec('bright', 'Luminosité', 60, 160, 105, _x100),
  SliderSpec('smooth', 'Lissage temporel', 0, 98, 90, _pct),
];
const forceSlider = SliderSpec('sforce', 'Force', 50, 99, 92, _pct);
const marginSlider = SliderSpec('scrop', 'Recadrage maximum', 4, 24, 10, _pct);
const followSlider = SliderSpec('follow', 'Fluidité du suivi', 0, 98, 88, _pct);

Map<String, double> defaultValues() => {
      for (final s in [...colorSliders, forceSlider, marginSlider, followSlider])
        s.key: s.def,
    };

enum WaterPreset {
  auto('Auto', 'Polyvalent'),
  blue('Eau bleue', 'Mer, large'),
  green('Eau verte', 'Lac, port'),
  deep('Profond', 'Plus de 20 m');

  const WaterPreset(this.label, this.hint);
  final String label;
  final String hint;

  Map<String, double> get settings => switch (this) {
        auto => defaultValues(),
        blue => {'strength': 100, 'red': 120, 'clip': 8, 'sat': 120, 'bright': 105, 'smooth': 90},
        green => {'strength': 100, 'red': 90, 'clip': 10, 'sat': 105, 'bright': 108, 'smooth': 90},
        deep => {'strength': 90, 'red': 65, 'clip': 12, 'sat': 100, 'bright': 115, 'smooth': 94},
      };
}

const aspectChoices = <(String, String, double?)>[
  ('none', 'Original', null),
  ('free', 'Libre', null),
  ('16:9', '16:9', 16 / 9),
  ('9:16', '9:16', 9 / 16),
  ('1:1', '1:1', 1),
  ('4:5', '4:5', 4 / 5),
  ('4:3', '4:3', 4 / 3),
  ('3:4', '3:4', 3 / 4),
  ('21:9', '21:9', 21 / 9),
];

double? aspectRatioOf(String aspect) {
  for (final a in aspectChoices) {
    if (a.$1 == aspect) return a.$3;
  }
  return null;
}

String fmtTime(double seconds) {
  final s = seconds.isFinite && seconds > 0 ? seconds : 0.0;
  final m = s ~/ 60;
  final r = (s % 60).floor();
  return '$m:${r.toString().padLeft(2, '0')}';
}

String fmtLong(double seconds) {
  final s = seconds.round().clamp(0, 1 << 31);
  if (s < 60) return '$s s';
  final m = (s / 60).round();
  return m < 60 ? '$m min' : '${m ~/ 60} h ${(m % 60).toString().padLeft(2, '0')}';
}

String fmtSize(num bytes) {
  const mb = 1048576;
  final v = bytes / mb;
  if (v >= 1024) return '${(v / 1024).toStringAsFixed(1).replaceAll('.', ',')} Go';
  return '${v.toStringAsFixed(v < 10 ? 1 : 0).replaceAll('.', ',')} Mo';
}
