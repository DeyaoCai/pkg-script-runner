import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_acrylic/flutter_acrylic.dart';
import 'package:pkg_script_runner/theme/color_tokens.dart';

const _chrome = MethodChannel('pkg.chrome');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  if (Platform.isWindows || Platform.isMacOS || Platform.isLinux) {
    await Window.initialize();
  }

  runApp(const HelloApp());
}

class HelloApp extends StatelessWidget {
  const HelloApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      color: ColorTokens.surfaceClear,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: ColorTokens.surfaceClear,
        canvasColor: ColorTokens.surfaceClear,
      ),
      home: const HelloGlassPage(),
    );
  }
}

class HelloGlassPage extends StatefulWidget {
  const HelloGlassPage({super.key});

  @override
  State<HelloGlassPage> createState() => _HelloGlassPageState();
}

class _HelloGlassPageState extends State<HelloGlassPage> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _pinGlass());
  }

  Future<void> _pinGlass() async {
    if (!Platform.isWindows && !Platform.isMacOS) return;

    await Window.setEffect(
      effect: ColorTokens.glassEffect,
      color: ColorTokens.glassTint,
      dark: ColorTokens.glassDarkBackdrop,
    );
  }

  Future<void> _startDrag() async {
    if (!Platform.isWindows) return;
    try {
      await _chrome.invokeMethod<void>('startDrag');
    } catch (_) {
      /* channel not ready */
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: ColorTokens.surfaceClear,
      body: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onPanStart: (_) => _startDrag(),
        child: const Center(
          child: Text(
            'Hello World',
            style: TextStyle(
              fontSize: 32,
              fontWeight: FontWeight.w700,
              color: ColorTokens.ink,
            ),
          ),
        ),
      ),
    );
  }
}
