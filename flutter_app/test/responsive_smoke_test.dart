import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:campuspool_flutter/main.dart';
import 'package:campuspool_flutter/app.dart';
import 'package:campuspool_flutter/theme.dart';

void main() {

  testWidgets('guest actions return to fixed positions after IME closes',
      (tester) async {
    Future<void> showShell(double keyboardInset) async {
      await tester.pumpWidget(MaterialApp(
        theme: CpTheme.data,
        home: MediaQuery(
          data: MediaQueryData(viewInsets: EdgeInsets.only(bottom: keyboardInset)),
          child: const CampusShell(),
        ),
      ));
      await tester.pumpAndSettle();
    }

    await showShell(0);
    expect(find.byKey(const Key('stickyGuestActions')), findsOneWidget);
    expect(find.byKey(const ValueKey('tab_rides')), findsOneWidget);
    await showShell(290);
    expect(find.byKey(const Key('stickyGuestActions')), findsNothing);
    expect(find.byKey(const ValueKey('tab_rides')), findsNothing);
    await showShell(0);
    expect(find.byKey(const Key('stickyGuestActions')), findsOneWidget);
    expect(find.byKey(const ValueKey('tab_rides')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  for (final width in [390.0, 1200.0]) {
    testWidgets('landing fits ${width.toInt()}px without overflow',
        (tester) async {
      tester.view.physicalSize = Size(width, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(const CampusPoolApp());
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Get started'), findsOneWidget);
      expect(find.text('Become a runner'), findsWidgets);
      if (width < 900) {
        expect(find.byKey(const Key('stickyGuestActions')), findsOneWidget);
        expect(find.byKey(const ValueKey('tab_home')), findsOneWidget);
      } else {
        expect(find.byKey(const Key('stickyGuestActions')), findsNothing);
      }
    });
  }
}
