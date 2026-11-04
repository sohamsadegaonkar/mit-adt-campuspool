import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:campuspool_flutter/place_search.dart';

void main() {
  final origin = Uri.parse('https://campuspool.test');
  const suggestion = PlaceSuggestion(
    id: 'ChIJ123456789ABCDEFGHIJK',
    title: 'Swargate',
    subtitle: 'Pune, Maharashtra, India',
  );

  test('only campus origin receives autocomplete queries', () async {
    final source = HttpPlaceSearchSource(
      origin: origin,
      client: MockClient((request) async {
        expect(request.url.origin, 'https://campuspool.test');
        expect(request.url.path, '/api/places/suggest');
        expect(request.url.queryParameters['q'], 'swargat');
        expect(request.url.queryParameters['sessionToken'], 'a' * 24);
        return http.Response(
          '{"success":true,"provider":"google","suggestions":['
          '{"id":"ChIJ123456789ABCDEFGHIJK",'
          '"title":"Swargate","subtitle":"Pune, Maharashtra, India"}]}',
          200,
        );
      }),
    );
    final results = await source.suggest(
        query: 'swargat', sessionToken: 'a' * 24);
    expect(results.single.title, 'Swargate');
    expect(results.single.subtitle, 'Pune, Maharashtra, India');
  });

  test('details only accept a verified matching place ID', () async {
    final source = HttpPlaceSearchSource(
      origin: origin,
      client: MockClient((request) async {
        expect(request.url.path, '/api/places/resolve');
        expect(request.url.queryParameters['id'], suggestion.id);
        return http.Response(
          '{"success":true,"provider":"google","place":{'
          '"id":"ChIJ123456789ABCDEFGHIJK",'
          '"address":"Swargate, Pune, Maharashtra, India",'
          '"latitude":18.5,"longitude":73.86}}',
          200,
        );
      }),
    );
    final place = await source.resolve(
      suggestion: suggestion, sessionToken: 'a' * 24);
    expect(place.address, contains('Swargate'));
    expect(place.longitude, 73.86);
  });

  test('rate-limited provider is clearly classified', () async {
    final source = HttpPlaceSearchSource(
      origin: origin,
      client: MockClient((_) async => http.Response('{}', 429)),
    );
    await expectLater(
      source.suggest(query: 'swargat', sessionToken: 'a' * 24),
      throwsA(isA<PlaceSearchException>().having(
        (e) => e.reason, 'reason', PlaceSearchFailure.rateLimited,
      )),
    );
  });

  test('malformed provider replies fail closed', () async {
    final source = HttpPlaceSearchSource(
      origin: origin,
      client: MockClient((_) async =>
          http.Response('{"success":true,"provider":"google","suggestions":'
              '[{"id":"bad","title":"Fake","subtitle":"x"}]}', 200)),
    );
    await expectLater(
      source.suggest(query: 'swargat', sessionToken: 'a' * 24),
      throwsA(isA<PlaceSearchException>().having(
        (e) => e.reason, 'reason', PlaceSearchFailure.invalidResponse,
      )),
    );
  });

  test('client refuses insecure provider origin', () {
    expect(
      () => HttpPlaceSearchSource(
        origin: Uri.parse('http://public.example'),
        client: MockClient((_) async => http.Response('{}', 200))),
      throwsArgumentError,
    );
  });
}
