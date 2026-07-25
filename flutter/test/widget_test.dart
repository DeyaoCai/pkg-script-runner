import 'package:flutter_test/flutter_test.dart';
import 'package:pkg_script_runner/main.dart';

void main() {
  testWidgets('hello glass boots', (tester) async {
    await tester.pumpWidget(const HelloApp());
    expect(find.text('Hello World'), findsOneWidget);
  });
}
