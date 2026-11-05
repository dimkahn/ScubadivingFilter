import 'package:flutter/material.dart';

/// Fond neutre sombre pour juger les couleurs sans biais ; accent corail,
/// la couleur que l'eau absorbe en premier.
abstract final class C {
  static const bg = Color(0xFF121416);
  static const panel = Color(0xFF1A1D20);
  static const panel2 = Color(0xFF22262A);
  static const line = Color(0xFF2C3136);
  static const fg = Color(0xFFE8EAEB);
  static const muted = Color(0xFF9AA3AA);
  static const accent = Color(0xFFFF6A4D);
  static const accentInk = Color(0xFF1A0C08);
  static const r = Color(0xFFFF5D4A);
  static const g = Color(0xFF5FD38D);
  static const b = Color(0xFF5AA8FF);
  static const ok = Color(0xFF5FD38D);
  static const err = Color(0xFFFF6B6B);
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
  const scheme = ColorScheme.dark(
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
    colorScheme: scheme,
    scaffoldBackgroundColor: C.bg,
    fontFamily: 'Plex',
    dividerColor: C.line,
    dividerTheme: const DividerThemeData(color: C.line, space: 1, thickness: 1),
    sliderTheme: const SliderThemeData(
      trackHeight: 4,
      activeTrackColor: C.accent,
      inactiveTrackColor: C.line,
      thumbColor: C.accent,
      disabledActiveTrackColor: C.muted,
      disabledInactiveTrackColor: C.line,
      disabledThumbColor: C.muted,
      overlayColor: Color(0x33FF6A4D),
      thumbShape: RoundSliderThumbShape(enabledThumbRadius: 10),
      overlayShape: RoundSliderOverlayShape(overlayRadius: 22),
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
        side: const BorderSide(color: C.line),
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
    bottomSheetTheme: const BottomSheetThemeData(
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
