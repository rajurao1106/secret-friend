import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:secret_friend/features/auth/presentation/login_screen.dart';

void main() {
  testWidgets('shows phone sign-in and privacy explanation', (
    tester,
  ) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: LoginScreen()),
      ),
    );

    expect(find.text('A little mystery.\nA genuine connection.'), findsOneWidget);
    expect(find.text('Your mobile number'), findsOneWidget);
    expect(find.text('Send me a code'), findsOneWidget);
    expect(find.textContaining('Other people never see it'), findsOneWidget);
  });

  testWidgets('validates Indian mobile numbers before sending an OTP', (
    tester,
  ) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: LoginScreen()),
      ),
    );

    await tester.enterText(find.byType(TextField).first, '+91 12345 67890');
    await tester.tap(find.text('Send me a code'));
    await tester.pump();

    expect(find.text('Enter a valid 10-digit Indian mobile number.'), findsOneWidget);
  });
}
