import 'package:flutter_test/flutter_test.dart';
import 'package:pkg_script_runner/app.dart';

void main() {
  testWidgets('app boots', (tester) async {
    await tester.pumpWidget(const PkgScriptRunnerApp());
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.textContaining('Pkg'), findsWidgets);
  });
}
