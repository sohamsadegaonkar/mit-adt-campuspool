import 'package:flutter/material.dart';

abstract final class CpColors {
  static const ink = Color(0xFF171717);
  static const yellow = Color(0xFFF4CE37);
  static const yellowSoft = Color(0xFFFFF3C5);
  static const surface = Color(0xFFF6F6F6);
  static const field = Color(0xFFF3F3F3);
  static const border = Color(0xFFE7E7E5);
  static const muted = Color(0xFF636363);
  static const green = Color(0xFF263D30);
  static const success = Color(0xFF087443);
  static const warning = Color(0xFF795600);
}

abstract final class CpTheme {
  static ThemeData get data {
    const radius = BorderRadius.all(Radius.circular(12));
    final scheme = ColorScheme.fromSeed(
      seedColor: CpColors.yellow,
      brightness: Brightness.light,
      surface: Colors.white,
    ).copyWith(primary: CpColors.ink, onPrimary: Colors.white);
    return ThemeData(
      useMaterial3: true,
      scaffoldBackgroundColor: Colors.white,
      colorScheme: scheme,
      splashFactory: InkRipple.splashFactory,
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.white,
        foregroundColor: CpColors.ink,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
      ),
      textTheme: const TextTheme(
        displaySmall: TextStyle(fontSize: 34, height: 1.08, letterSpacing: -1.2,
            fontWeight: FontWeight.w800, color: CpColors.ink),
        headlineSmall: TextStyle(fontSize: 25, fontWeight: FontWeight.w800,
            color: CpColors.ink, letterSpacing: -0.5),
        titleLarge: TextStyle(fontSize: 20, fontWeight: FontWeight.w700,
            color: CpColors.ink),
        titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w700,
            color: CpColors.ink),
        bodyMedium: TextStyle(fontSize: 14, height: 1.5,
            color: CpColors.muted),
        labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w700,
            color: CpColors.ink),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: CpColors.yellow,
          foregroundColor: CpColors.ink,
          minimumSize: const Size.fromHeight(49),
          shape: const RoundedRectangleBorder(borderRadius: radius),
          textStyle: const TextStyle(fontWeight: FontWeight.w700),
        ),
      ),
      inputDecorationTheme: const InputDecorationTheme(
        filled: true,
        fillColor: CpColors.surface,
        contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 17),
        border: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide.none),
        enabledBorder: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide.none),
        focusedBorder: OutlineInputBorder(borderRadius: radius,
          borderSide: BorderSide(color: CpColors.ink, width: 1.3)),
      ),
      dividerColor: CpColors.border,
    );
  }
}
