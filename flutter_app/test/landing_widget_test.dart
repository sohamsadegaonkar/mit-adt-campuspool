import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:campuspool_flutter/main.dart' as app;
import 'package:campuspool_flutter/flows.dart';
import 'package:campuspool_flutter/pricing.dart';

void expectFixedGuestActions() {
  final sticky = find.byKey(const Key('stickyGuestActions'));
  expect(sticky, findsOneWidget);
  expect(find.descendant(
    of: sticky, matching: find.text('Get started')), findsOneWidget);
  expect(find.descendant(
    of: sticky, matching: find.text('Become a runner')), findsOneWidget);
}

void main() {
  testWidgets('logged-out CTA pair remains while exploring rides and errands',
      (tester) async {
    await tester.pumpWidget(const app.CampusPoolApp());
    expectFixedGuestActions();

    await tester.tap(find.byKey(const ValueKey('tab_rides')));
    await tester.pumpAndSettle();
    expect(find.text('No live rides to display'), findsOneWidget);
    expectFixedGuestActions();

    await tester.tap(find.byKey(const ValueKey('tab_errands')));
    await tester.pumpAndSettle();
    expect(find.text('Request an item'), findsOneWidget);
    expectFixedGuestActions();
  });

  testWidgets('price disclosure is collapsed by default and toggles',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(body: Center(
        child: PriceDetails(quote: CampusQuote(extraTip: 20)),
      )),
    ));
    expect(find.text('₹75'), findsOneWidget);
    expect(find.text('Voluntary extra tip'), findsNothing);
    await tester.tap(find.byKey(const Key('priceDetailsToggle')));
    await tester.pumpAndSettle();
    expect(find.text('Voluntary extra tip'), findsOneWidget);
    expect(find.text('₹20'), findsOneWidget);
    await tester.tap(find.byKey(const Key('priceDetailsToggle')));
    await tester.pumpAndSettle();
    expect(find.text('Voluntary extra tip'), findsNothing);
    expect(find.text('₹75'), findsOneWidget);
  });

  testWidgets('errand preview tip adjusts total without enabling payment',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(body: SingleChildScrollView(
        child: ErrandDraftFlow(),
      )),
    ));
    await tester.tap(find.text('Continue to reward'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('tip_20')));
    await tester.pumpAndSettle();
    expect(find.text('₹30'), findsOneWidget);
    await tester.tap(find.text('Review estimated total'));
    await tester.pumpAndSettle();
    expect(find.text('₹75'), findsOneWidget);
    await tester.tap(find.text('Continue to payment preview'));
    await tester.pumpAndSettle();
    expect(find.text('Payment unavailable in preview'), findsOneWidget);
  });
}
