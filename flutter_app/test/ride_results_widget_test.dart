import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:campuspool_flutter/ride_feed.dart';
import 'package:campuspool_flutter/ride_results.dart';

void main() {
  testWidgets('loading shows semantic skeleton rather than invented rides',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(
      body: RideResultsPanel(
        snapshot: RideFeedSnapshot(RideFeedPhase.loading),
      ),
    )));
    expect(find.byKey(const Key('rideLoadingSkeleton')), findsOneWidget);
    expect(find.text('No matching rides'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('error state has a working retry action', (tester) async {
    var retries = 0;
    await tester.pumpWidget(MaterialApp(home: Scaffold(
      body: RideResultsPanel(
        snapshot: const RideFeedSnapshot(RideFeedPhase.unavailable),
        onRetry: () => retries++,
      ),
    )));
    expect(find.text('Unable to load rides'), findsOneWidget);
    await tester.tap(find.text('Try again'));
    expect(retries, 1);
  });

  testWidgets('session expiry asks for sign-in', (tester) async {
    var tries = 0;
    await tester.pumpWidget(MaterialApp(home: Scaffold(
      body: RideResultsPanel(
        snapshot: const RideFeedSnapshot(RideFeedPhase.authRequired),
        onSignIn: () => tries++,
      ),
    )));
    expect(find.text('Campus sign-in required'), findsOneWidget);
    await tester.tap(find.text('Sign in'));
    expect(tries, 1);
  });

  testWidgets('empty state does not make up inventory', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(
      body: RideResultsPanel(
        snapshot: RideFeedSnapshot(RideFeedPhase.empty),
      ),
    )));
    expect(find.text('No matching rides'), findsOneWidget);
    expect(find.textContaining('seat left'), findsNothing);
  });
}
