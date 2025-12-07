import 'package:flutter_test/flutter_test.dart';
import 'package:iris_app/main.dart';

void main() {
  testWidgets('App starts correctly', (WidgetTester tester) async {
    await tester.pumpWidget(const IrisApp());
    expect(find.text('Connecting to Iris...'), findsOneWidget);
  });
}
