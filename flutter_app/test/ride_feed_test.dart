import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:campuspool_flutter/ride_feed.dart';

class _FakeSource implements RideFeedSource {
  _FakeSource(this.response);
  final Future<List<RideSummary>> Function() response;
  int calls = 0;

  @override
  Future<List<RideSummary>> load() {
    calls++;
    return response();
  }
}

const _fixture = RideSummary(
  id: 'r-1',
  pickup: 'MIT-ADT Main Gate',
  destination: 'Hadapsar',
  departureTime: '17:45',
  vehicle: 'Car',
  seatsLeft: 2,
);

void main() {
  test('read-only client verifies existing session before listing rides', () async {
    final routes = <String>[];
    final feed = AuthenticatedRideFeed(
      origin: Uri.parse('https://campuspool.example'),
      client: MockClient((request) async {
        routes.add(request.url.path);
        if (request.url.path == '/api/auth/me') {
          return http.Response('{"success":true,"user":{"id":"123"}}', 200);
        }
        if (request.url.path == '/api/rides') {
          return http.Response(
            '{"success":true,"rides":[{"id":"r-1",'
            '"pickup":"Main Gate","destination":"Hadapsar",'
            '"departureTime":"17:45","vehicle":"Car","seatsLeft":2,'
            '"driverEmail":"private@example.com",'
            '"driverPhone":"0000000000","upiId":"secret@upi",'
            '"note":"private note"}]}', 200);
        }
        throw StateError('Unexpected path');
      }),
    );
    final rides = await feed.load();
    expect(routes, ['/api/auth/me', '/api/rides']);
    expect(rides, hasLength(1));
    expect(rides.single.destination, 'Hadapsar');
    expect(rides.single.seatsLeft, 2);
    expect(rides.single.toString(), isNot(contains('private@example.com')));
  });

  test('session rejection stops before rides endpoint', () async {
    var calledRides = false;
    final feed = AuthenticatedRideFeed(
      origin: Uri.parse('https://campuspool.example'),
      client: MockClient((request) async {
        if (request.url.path == '/api/rides') calledRides = true;
        return http.Response('{"success":false,"error":"AUTH_REQUIRED"}', 401);
      }),
    );
    await expectLater(feed.load(), throwsA(
      isA<RideFeedException>().having((e) => e.reason,
        'reason', RideFeedFailure.authRequired),
    ));
    expect(calledRides, isFalse);
  });

  test('rejects insecure origins and embedded URL credentials', () {
    final client = MockClient((request) async => http.Response('{}', 200));
    expect(() => AuthenticatedRideFeed(
      origin: Uri.parse('http://unsafe.example'), client: client),
      throwsArgumentError);
    expect(() => AuthenticatedRideFeed(
      origin: Uri.parse('https://name:pass@example.test'), client: client),
      throwsArgumentError);
  });

  test('rejects malformed responses rather than inventing rides', () async {
    final feed = AuthenticatedRideFeed(
      origin: Uri.parse('https://campuspool.example'),
      client: MockClient((request) async => http.Response(
        request.url.path == '/api/auth/me'
          ? '{"success":true,"user":{"id":"verified"}}'
          : '{"success":true,"rides":[{"id":"r-1","driverPhone":"123"}]}',
        200)),
    );
    await expectLater(feed.load(), throwsA(
      isA<RideFeedException>().having((e) => e.reason,
        'reason', RideFeedFailure.invalidResponse)));
  });

  test('guest state never calls network source', () async {
    final source = _FakeSource(() async => [_fixture]);
    final controller = RideFeedController(
        source: source, hasVerifiedSession: false);
    await controller.refresh();
    expect(controller.snapshot.phase, RideFeedPhase.authRequired);
    expect(source.calls, 0);
    controller.updateSession(verified: true);
    await controller.refresh();
    expect(source.calls, 1);
    expect(controller.snapshot.phase, RideFeedPhase.ready);
    expect(controller.snapshot.rides.single.id, 'r-1');
    controller.dispose();
  });

  test('logging out discards late server results', () async {
    final completed = Completer<List<RideSummary>>();
    final source = _FakeSource(() => completed.future);
    final controller = RideFeedController(
      source: source, hasVerifiedSession: true);
    final loading = controller.refresh();
    expect(controller.snapshot.phase, RideFeedPhase.loading);
    controller.updateSession(verified: false);
    completed.complete([_fixture]);
    await loading;
    expect(controller.snapshot.phase, RideFeedPhase.preview);
    expect(controller.snapshot.rides, isEmpty);
    controller.dispose();
  });
}
