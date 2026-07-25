#ifndef RUNNER_COLOR_TOKENS_H_
#define RUNNER_COLOR_TOKENS_H_

#include <windows.h>

// Keep in sync with lib/theme/color_tokens.dart
// SetWindowCompositionAttribute GradientColor uses AABBGGRR (not AARRGGBB).

// Dart Color(0x991A2220) -> AA=99 R=1A G=22 B=20 -> 0x9920221A
constexpr DWORD kGlassTintAccent = 0x9920221A;

// Dart Color(0xE01A2220) -> 0xE020221A
constexpr DWORD kGlassDragFillAccent = 0xE020221A;

#endif  // RUNNER_COLOR_TOKENS_H_
