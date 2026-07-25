import 'package:flutter/material.dart';
import 'package:flutter_acrylic/flutter_acrylic.dart';

/// App color tokens. Keep Accent AABBGGRR twins in
/// `windows/runner/color_tokens.h` in sync with [glassTint] / [glassDragFill].
abstract final class ColorTokens {
  // --- glass (OS Accent layer; Flutter stays transparent) ---

  /// Frosted-glass material. Win11 SystemBackdrop acrylic often looks solid.
  static const glassEffect = WindowEffect.aero;

  /// Accent blur tint while idle (AARRGGBB).
  /// RGB 26,34,32 — dark green-gray; alpha ~60%.
  static const glassTint = Color(0x991A2220);

  /// Solid fill while moving/resizing (AARRGGBB). Same RGB, higher alpha.
  /// Applied natively on WM_ENTERSIZEMOVE to avoid blur drag lag.
  static const glassDragFill = Color(0xE01A2220);

  static const glassDarkBackdrop = true;

  // --- ink / text ---

  static const ink = Color(0xFFE8F2ED);

  // --- surfaces (Flutter overlays; keep clear so OS glass shows) ---

  static const surfaceClear = Color(0x00000000);
}
