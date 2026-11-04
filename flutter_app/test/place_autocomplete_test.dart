import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:campuspool_flutter/place_autocomplete_field.dart';
import 'package:campuspool_flutter/place_search.dart';

const swargate = PlaceSuggestion(
  id: 'ChIJ123456789ABCDEFGHIJK',
  title: 'Swargate',
  subtitle: 'Pune, Maharashtra, India',
);

class FakePlaces implements PlaceSearchSource {
  FakePlaces({
    this.lookup,
    this.details,
  });
  final Future<List<PlaceSuggestion>> Function(String, String)? lookup;
  final Future<SelectedPlace> Function(PlaceSuggestion, String)? details;
  final List<String> queries = [];
  final List<String> tokens = [];

  @override
  Future<List<PlaceSuggestion>> suggest({
    required String query,
    required String sessionToken,
  }) {
    queries.add(query);
    tokens.add(sessionToken);
    return lookup?.call(query, sessionToken) ??
        Future.value([swargate]);
  }

  @override
  Future<SelectedPlace> resolve({
    required PlaceSuggestion suggestion,
    required String sessionToken,
  }) {
    tokens.add(sessionToken);
    return details?.call(suggestion, sessionToken) ??
        Future.value(const SelectedPlace(
          id: 'ChIJ123456789ABCDEFGHIJK',
          title: 'Swargate',
          address: 'Swargate, Pune, Maharashtra, India',
          latitude: 18.50,
          longitude: 73.86,
        ));
  }
}

void main() {
  testWidgets('debounced swargat search displays matching addresses',
      (tester) async {
    final controller = TextEditingController();
    final source = FakePlaces();
    addTearDown(controller.dispose);
    await tester.pumpWidget(MaterialApp(home: Scaffold(
      body: SingleChildScrollView(
        child: PlaceAutocompleteField(controller: controller, source: source),
      ),
    )));
    await tester.enterText(
        find.byKey(const Key('destinationField')), 'swargat');
    await tester.pump(const Duration(milliseconds: 290));
    expect(source.queries, isEmpty);
    await tester.pump(const Duration(milliseconds: 45));
    await tester.pump();
    expect(source.queries, ['swargat']);
    expect(find.byKey(const Key('placeSuggestions')), findsOneWidget);
    expect(find.text('Swargate'), findsOneWidget);
    expect(find.text('Pune, Maharashtra, India'), findsOneWidget);
  });

  testWidgets('selection resolves an address with the same session token',
      (tester) async {
    final controller = TextEditingController();
    final source = FakePlaces();
    SelectedPlace? selected;
    addTearDown(controller.dispose);
    await tester.pumpWidget(MaterialApp(home: Scaffold(
      body: SingleChildScrollView(child: PlaceAutocompleteField(
        controller: controller, source: source,
        onSelected: (value) => selected = value,
      )),
    )));
    await tester.enterText(
        find.byKey(const Key('destinationField')), 'swargat');
    await tester.pump(const Duration(milliseconds: 330));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('placeSuggestion_0')));
    await tester.pump();
    expect(selected?.address, 'Swargate, Pune, Maharashtra, India');
    expect(controller.text, 'Swargate');
    expect(find.byKey(const Key('placeConfirmed')), findsOneWidget);
    expect(source.tokens, hasLength(2));
    expect(source.tokens[0], source.tokens[1]);
  });

  testWidgets('new input invalidates an old pending network response',
      (tester) async {
    final first = Completer<List<PlaceSuggestion>>();
    final second = Completer<List<PlaceSuggestion>>();
    final controller = TextEditingController();
    final source = FakePlaces(
      lookup: (query, _) => query == 'swargat'
          ? first.future : second.future,
    );
    addTearDown(controller.dispose);
    await tester.pumpWidget(MaterialApp(home: Scaffold(
      body: SingleChildScrollView(
        child: PlaceAutocompleteField(controller: controller, source: source),
      ),
    )));
    await tester.enterText(
        find.byKey(const Key('destinationField')), 'swargat');
    await tester.pump(const Duration(milliseconds: 330));
    await tester.enterText(
        find.byKey(const Key('destinationField')), 'hadapsar');
    await tester.pump(const Duration(milliseconds: 330));
    second.complete(const [
      PlaceSuggestion(
        id: 'ChIJ123456789ABCDEYYYYY',
        title: 'Hadapsar',
        subtitle: 'Pune, Maharashtra, India',
      ),
    ]);
    await tester.pump();
    first.complete([swargate]);
    await tester.pump();
    expect(find.text('Hadapsar'), findsOneWidget);
    expect(find.text('Swargate'), findsNothing);
  });

  testWidgets('offline build clearly explains live search is unavailable',
      (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(MaterialApp(home: Scaffold(
      body: PlaceAutocompleteField(controller: controller),
    )));
    await tester.enterText(
        find.byKey(const Key('destinationField')), 'swargat');
    await tester.pump();
    expect(find.textContaining('not enabled in this build'), findsOneWidget);
    expect(find.byKey(const Key('placeSuggestions')), findsNothing);
  });

  testWidgets('clearing the field hides suggestions',
      (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(MaterialApp(home: Scaffold(
      body: PlaceAutocompleteField(
        controller: controller, source: FakePlaces(),
      ),
    )));
    await tester.enterText(
        find.byKey(const Key('destinationField')), 'swargat');
    await tester.pump(const Duration(milliseconds: 330));
    await tester.pump();
    await tester.tap(find.byKey(const Key('clearDestination')));
    await tester.pump();
    expect(controller.text, isEmpty);
    expect(find.byKey(const Key('placeSuggestions')), findsNothing);
  });
}
