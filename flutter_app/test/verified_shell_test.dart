import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:campuspool_flutter/app.dart';
import 'package:campuspool_flutter/campus_auth.dart';
import 'package:campuspool_flutter/ride_feed.dart';
import 'package:campuspool_flutter/theme.dart';

class _TestRideFeed implements RideFeedSource {
  @override
  Future<List<RideSummary>> load() async => const [
    RideSummary(
      id: 'r-1',
      pickup: 'MIT-ADT Gate',
      destination: 'Hadapsar',
      departureTime: '17:45',
      vehicle: 'Car',
      seatsLeft: 2,
    ),
  ];
}

void main() {
  testWidgets('only server-confirmed state reveals protected ride list',
      (tester) async {
    final csrf = List.filled(64, 'a').join();
    final client = MockClient((request) async {
      if (request.url.path == '/api/auth/me') {
        return http.Response(
          '{"success":true,"user":{"name":"Verified Student"},'
          '"csrfToken":"$csrf"}', 200);
      }
      if (request.url.path == '/api/auth/logout') {
        return http.Response('{"success":true}', 200);
      }
      throw StateError('Unexpected route');
    });
    final controller = CampusAuthController(CampusAuthApi(
      origin: Uri.parse('https://campuspool.example'),
      client: client,
    ));
    await tester.pumpWidget(MaterialApp(
      theme: CpTheme.data,
      home: CampusShell(auth: controller, rideSource: _TestRideFeed()),
    ));
    await tester.pumpAndSettle();
    final sticky = find.byKey(const Key('stickyGuestActions'));
    expect(find.descendant(
      of: sticky, matching: find.text('Find a ride')), findsOneWidget);
    expect(find.descendant(
      of: sticky, matching: find.text('Get started')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('tab_rides')));
    await tester.pumpAndSettle();
    expect(find.text('1 available ride'), findsOneWidget);
    expect(find.textContaining('Hadapsar'), findsWidgets);
    await tester.tap(find.byKey(const ValueKey('tab_profile')));
    await tester.pumpAndSettle();
    expect(find.text('Verified Student'), findsOneWidget);
    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();
    expect(find.descendant(
      of: sticky, matching: find.text('Get started')), findsOneWidget);
    controller.dispose();
    client.close();
  });
}
