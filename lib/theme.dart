import 'package:flutter/material.dart';

/// Couleurs de l'interface. Fonds neutres pour juger les couleurs sans biais ; accent corail,
/// la couleur que l'eau absorbe en premier. En clair, les couleurs de texte sont assombries pour
/// rester lisibles (contraste de 4,5:1 au moins sur tous les fonds).
class Palette {
  const Palette({
    required this.brightness,
    required this.bg,
    required this.panel,
    required this.panel2,
    required this.line,
    required this.fg,
    required this.muted,
    required this.accent,
    required this.accentInk,
    required this.r,
    required this.g,
    required this.b,
    required this.ok,
    required this.err,
  });
  final Brightness brightness;
  final Color bg, panel, panel2, line, fg, muted, accent, accentInk, r, g, b, ok, err;
}

const darkPalette = Palette(
  brightness: Brightness.dark,
  bg: Color(0xFF121416),
  panel: Color(0xFF1A1D20),
  panel2: Color(0xFF22262A),
  line: Color(0xFF2C3136),
  fg: Color(0xFFE8EAEB),
  muted: Color(0xFF9AA3AA),
  accent: Color(0xFFFF6A4D),
  accentInk: Color(0xFF1A0C08),
  r: Color(0xFFFF5D4A),
  g: Color(0xFF5FD38D),
  b: Color(0xFF5AA8FF),
  ok: Color(0xFF5FD38D),
  err: Color(0xFFFF6B6B),
);

const lightPalette = Palette(
  brightness: Brightness.light,
  bg: Color(0xFFF4F5F6),
  panel: Color(0xFFFFFFFF),
  panel2: Color(0xFFEBEEF0),
  line: Color(0xFFD5DADE),
  fg: Color(0xFF16191C),
  muted: Color(0xFF5A636A),
  accent: Color(0xFFB53C1C),
  accentInk: Color(0xFFFFFFFF),
  r: Color(0xFFC8321F),
  g: Color(0xFF16793F),
  b: Color(0xFF1F66C8),
  ok: Color(0xFF16793F),
  err: Color(0xFFC62828),
);

/// Palette en cours, choisie d'après le thème du système (voir RougeApp).
abstract final class C {
  static Palette _p = darkPalette;
  static Palette get palette => _p;
  static Brightness get brightness => _p.brightness;
  static void use(Brightness b) => _p = b == Brightness.light ? lightPalette : darkPalette;

  static Color get bg => _p.bg;
  static Color get panel => _p.panel;
  static Color get panel2 => _p.panel2;
  static Color get line => _p.line;
  static Color get fg => _p.fg;
  static Color get muted => _p.muted;
  static Color get accent => _p.accent;
  static Color get accentInk => _p.accentInk;
  static Color get r => _p.r;
  static Color get g => _p.g;
  static Color get b => _p.b;
  static Color get ok => _p.ok;
  static Color get err => _p.err;
}

/// Styles de texte. Les polices sont variables : la graisse passe par `wght`.
abstract final class T {
  static TextStyle body(double size, {double wght = 400, Color? color}) =>
      TextStyle(
        fontFamily: 'Plex',
        fontSize: size,
        height: 1.35,
        color: color ?? C.fg,
        fontVariations: [FontVariation('wght', wght)],
      );

  static TextStyle mono(double size, {Color? color, bool medium = false}) =>
      TextStyle(
        fontFamily: 'PlexMono',
        fontSize: size,
        height: 1.3,
        color: color ?? C.muted,
        fontWeight: medium ? FontWeight.w500 : FontWeight.w400,
        fontFeatures: const [FontFeature.tabularFigures()],
      );

  static TextStyle display(double size, {Color? color}) => TextStyle(
        fontFamily: 'Bricolage',
        fontSize: size,
        height: 1.05,
        color: color ?? C.fg,
        letterSpacing: -0.2,
        fontVariations: const [FontVariation('wght', 700)],
      );

  static TextStyle label() =>
      body(11.5, wght: 600, color: C.muted).copyWith(letterSpacing: 1.0);
}

ThemeData buildTheme() {
  final base = C.brightness == Brightness.light ? const ColorScheme.light() : const ColorScheme.dark();
  final scheme = base.copyWith(
    primary: C.accent,
    onPrimary: C.accentInk,
    secondary: C.accent,
    onSecondary: C.accentInk,
    surface: C.panel,
    onSurface: C.fg,
    error: C.err,
    outline: C.line,
    surfaceContainerHighest: C.panel2,
  );
  final buttonShape =
      RoundedRectangleBorder(borderRadius: BorderRadius.circular(10));
  return ThemeData(
    useMaterial3: true,
    brightness: C.brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: C.bg,
    fontFamily: 'Plex',
    dividerColor: C.line,
    dividerTheme: DividerThemeData(color: C.line, space: 1, thickness: 1),
    sliderTheme: SliderThemeData(
      trackHeight: 4,
      activeTrackColor: C.accent,
      inactiveTrackColor: C.line,
      thumbColor: C.accent,
      disabledActiveTrackColor: C.muted,
      disabledInactiveTrackColor: C.line,
      disabledThumbColor: C.muted,
      overlayColor: C.accent.withAlpha(0x33),
      thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 10),
      overlayShape: const RoundSliderOverlayShape(overlayRadius: 22),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: C.accent,
        foregroundColor: C.accentInk,
        disabledBackgroundColor: C.panel2,
        disabledForegroundColor: C.muted,
        minimumSize: const Size(48, 48),
        shape: buttonShape,
        textStyle: T.body(15, wght: 600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: C.fg,
        backgroundColor: C.panel2,
        side: BorderSide(color: C.line),
        minimumSize: const Size(48, 48),
        shape: buttonShape,
        textStyle: T.body(14, wght: 500),
      ),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((s) =>
          s.contains(WidgetState.selected) ? C.accentInk : C.muted),
      trackColor: WidgetStateProperty.resolveWith((s) =>
          s.contains(WidgetState.selected) ? C.accent : C.panel2),
      trackOutlineColor: WidgetStateProperty.all(C.line),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: C.panel2,
      contentTextStyle: T.body(14),
      actionTextColor: C.accent,
      behavior: SnackBarBehavior.floating,
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: C.panel,
      showDragHandle: true,
      dragHandleColor: C.muted,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: C.panel,
      titleTextStyle: T.display(20),
      contentTextStyle: T.body(14, color: C.muted),
    ),
  );
}
