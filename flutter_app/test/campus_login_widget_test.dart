import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:campuspool_flutter/main.dart';
import 'package:campuspool_flutter/campus_auth.dart';
import 'package:campuspool_flutter/campus_login_screen.dart';

void main() {
  testWidgets('offline build cannot enter a fake signed-in state',
      (tester) async {
    await tester.pumpWidget(const CampusPoolApp());
    final sticky = find.byKey(const Key('stickyGuestActions'));
    await tester.tap(find.descendant(
      of: sticky, matching: find.text('Get started')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Sign-in is not configured'), findsOneWidget);
    expect(find.text('Preview signed-in layout'), findsNothing);
    expect(find.text('Verify and sign in'), findsNothing);
  });

  testWidgets('OTP entry appears only after server accepts request',
      (tester) async {
    final client = MockClient((request) async {
      if (request.url.path == '/api/auth/login-request') {
        return http.Response('{"success":true,"expiresInSeconds":300}', 200);
      }
      return http.Response('{"success":false}', 400);
    });
    final controller = CampusAuthController(CampusAuthApi(
      origin: Uri.parse('https://campuspool.example'),
      client: client,
    ));
    await tester.pumpWidget(MaterialApp(
      home: CampusLoginScreen(auth: controller),
    ));
    expect(find.byKey(const Key('campusLoginOtp')), findsNothing);
    await tester.enterText(
      find.byKey(const Key('campusLoginEmail')), 'student@mit.edu');
    await tester.tap(find.text('Request sign-in code'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('campusLoginOtp')), findsOneWidget);
    expect(find.textContaining('If a verified account exists'),
      findsOneWidget);
    controller.dispose();
    client.close();
  });
}
