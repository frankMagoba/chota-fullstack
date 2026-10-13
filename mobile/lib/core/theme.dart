import 'package:flutter/material.dart';

/// Colours and type carried over from the 2021 app: white sheets over the
/// map, grey (#EDEDED) service circles, black text, Averta.
class ChotaColors {
  static const ink = Colors.black;
  static const chip = Color(0xffededed);
  static const accent = Color(0xFF7B51D3);
  static const water = Color(0xFF1E88E5);
  static const sewage = Color(0xFF6D4C41);
  static const ok = Color(0xFF2E7D32);
}

ThemeData chotaTheme() {
  final base = ThemeData(
    useMaterial3: true,
    fontFamily: 'Averta',
    colorScheme: ColorScheme.fromSeed(seedColor: ChotaColors.accent, primary: ChotaColors.ink),
    scaffoldBackgroundColor: Colors.white,
  );
  return base.copyWith(
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.white,
      foregroundColor: Colors.black,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: ChotaColors.ink,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        textStyle: const TextStyle(fontFamily: 'Averta', fontWeight: FontWeight.w600, fontSize: 16),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: ChotaColors.chip,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
    ),
  );
}

/// The rounded white sheet the old screens used at the bottom of the map.
class BottomSheetCard extends StatelessWidget {
  const BottomSheetCard({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.only(topLeft: Radius.circular(20), topRight: Radius.circular(20)),
        boxShadow: [BoxShadow(color: Colors.black26, blurRadius: 12)],
      ),
      child: SafeArea(top: false, child: child),
    );
  }
}
