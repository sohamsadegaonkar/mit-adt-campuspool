import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// Only deliberately approved, non-contact fields cross into the UI model.
/// Do not add driver phone/email, UPI identifiers, GPS, or free-form notes.
@immutable
class RideSummary {
  const RideSummary({
    required this.id,
    required this.pickup,
    required this.destination,
    required this.departureTime,
    required this.vehicle,
    required this.seatsLeft,
  });

  final String id;
  final String pickup;
  final String destination;
  final String departureTime;
  final String vehicle;
  final int seatsLeft;

  static String _text(dynamic value, {int maxLength = 120}) {
    if (value is! String) return '';
    final cleaned = value
        .replaceAll(RegExp(r'[\u0000-\u001f\u007f<>]'), '')
        .trim();
    return cleaned.length <= maxLength
        ? cleaned
        : cleaned.substring(0, maxLength);
  }

  factory RideSummary.fromServer(Map<String, dynamic> json) {
    final id = _text(json['id'], maxLength: 80);
    final pickup = _text(json['pickup']);
    final destination = _text(json['destination']);
    final departure = _text(json['departureTime']);
    final vehicle = _text(json['vehicle'], maxLength: 16);
    final seats = json['seatsLeft'];
    if (id.isEmpty || pickup.isEmpty || destination.isEmpty ||
        departure.isEmpty || !['Car', 'Bike'].contains(vehicle) ||
        seats is! num || !seats.isFinite || seats < 0 || seats > 8 ||
        seats != seats.roundToDouble()) {
      throw const RideFeedException(RideFeedFailure.invalidResponse);
    }
    return RideSummary(
      id: id,
      pickup: pickup,
      destination: destination,
      departureTime: departure,
      vehicle: vehicle,
      seatsLeft: seats.toInt(),
    );
  }
}

enum RideFeedFailure {
  authRequired,
  rateLimited,
  unavailable,
  invalidResponse,
}

class RideFeedException implements Exception {
  const RideFeedException(this.reason);
  final RideFeedFailure reason;
}

abstract interface class RideFeedSource {
  Future<List<RideSummary>> load();
}

/// Opt-in, read-only HTTP adapter for an already authenticated CampusPool
/// client. The caller MUST provide a transport that carries the real
/// server-issued session. This class never creates or stores credentials.
/// Server-side `/api/auth/me` and `/api/rides` enforce authorization.
class AuthenticatedRideFeed implements RideFeedSource {
  AuthenticatedRideFeed({
    required Uri origin,
    required http.Client client,
    this.timeout = const Duration(seconds: 8),
  })  : _origin = origin,
        _client = client {
    if (origin.userInfo.isNotEmpty ||
        (origin.scheme != 'https' &&
            !(origin.scheme == 'http' &&
              ['localhost', '127.0.0.1', '::1'].contains(origin.host))) ||
        origin.hasQuery || origin.hasFragment ||
        (origin.path.isNotEmpty && origin.path != '/')) {
      throw ArgumentError.value(origin, 'origin',
          'Use an HTTPS API origin without credentials, path or query.');
    }
  }

  final Uri _origin;
  final http.Client _client;
  final Duration timeout;

  Future<http.Response> _get(String route) async {
    try {
      return await _client
          .get(_origin.resolve(route), headers: const {
            'Accept': 'application/json',
          })
          .timeout(timeout);
    } on TimeoutException {
      throw const RideFeedException(RideFeedFailure.unavailable);
    } on http.ClientException {
      throw const RideFeedException(RideFeedFailure.unavailable);
    }
  }

  @override
  Future<List<RideSummary>> load() async {
    final me = await _get('/api/auth/me');
    _assertResponse(me);
    final session = _jsonObject(me.body);
    if (session['success'] != true || session['user'] is! Map) {
      throw const RideFeedException(RideFeedFailure.authRequired);
    }

    final ridesResponse = await _get('/api/rides');
    _assertResponse(ridesResponse);
    final payload = _jsonObject(ridesResponse.body);
    if (payload['success'] != true || payload['rides'] is! List) {
      throw const RideFeedException(RideFeedFailure.invalidResponse);
    }
    final all = payload['rides'] as List;
    if (all.length > 500) {
      throw const RideFeedException(RideFeedFailure.invalidResponse);
    }
    final result = <RideSummary>[];
    for (final item in all) {
      if (item is! Map<String, dynamic>) {
        throw const RideFeedException(RideFeedFailure.invalidResponse);
      }
      final ride = RideSummary.fromServer(item);
      if (ride.seatsLeft > 0) result.add(ride);
      if (result.length >= 50) break; // bounded presentation only
    }
    return List.unmodifiable(result);
  }

  void _assertResponse(http.Response response) {
    if (response.statusCode == 401 || response.statusCode == 403) {
      throw const RideFeedException(RideFeedFailure.authRequired);
    }
    if (response.statusCode == 429) {
      throw const RideFeedException(RideFeedFailure.rateLimited);
    }
    if (response.statusCode != 200) {
      throw const RideFeedException(RideFeedFailure.unavailable);
    }
    if (response.bodyBytes.length > 1024 * 1024) {
      throw const RideFeedException(RideFeedFailure.invalidResponse);
    }
  }

  Map<String, dynamic> _jsonObject(String input) {
    try {
      final data = jsonDecode(input);
      if (data is Map<String, dynamic>) return data;
    } on FormatException {
      // Never echo server payload or private student fields in diagnostics.
    }
    throw const RideFeedException(RideFeedFailure.invalidResponse);
  }
}

enum RideFeedPhase {
  preview,
  loading,
  empty,
  ready,
  authRequired,
  unavailable,
}

@immutable
class RideFeedSnapshot {
  const RideFeedSnapshot(this.phase, [this.rides = const []]);
  final RideFeedPhase phase;
  final List<RideSummary> rides;
}

/// This is a UI guard, not an authentication authority. The server must also
/// verify the session for every request (including this read-only API call).
class RideFeedController extends ChangeNotifier {
  RideFeedController({
    required RideFeedSource source,
    required bool hasVerifiedSession,
  })  : _source = source,
        _verified = hasVerifiedSession,
        snapshot = RideFeedSnapshot(
          hasVerifiedSession ? RideFeedPhase.empty : RideFeedPhase.preview,
        );

  final RideFeedSource _source;
  bool _verified;
  int _generation = 0;
  RideFeedSnapshot snapshot;

  void updateSession({required bool verified}) {
    _generation++;
    _verified = verified;
    snapshot = RideFeedSnapshot(
      verified ? RideFeedPhase.empty : RideFeedPhase.preview,
    );
    notifyListeners();
  }

  Future<void> refresh() async {
    if (!_verified) {
      snapshot = const RideFeedSnapshot(RideFeedPhase.authRequired);
      notifyListeners();
      return;
    }
    if (snapshot.phase == RideFeedPhase.loading) return;
    final requestId = ++_generation;
    snapshot = const RideFeedSnapshot(RideFeedPhase.loading);
    notifyListeners();
    try {
      final rides = await _source.load();
      if (requestId != _generation || !_verified) return;
      snapshot = RideFeedSnapshot(
          rides.isEmpty ? RideFeedPhase.empty : RideFeedPhase.ready, rides);
    } on RideFeedException catch (error) {
      if (requestId != _generation) return;
      snapshot = RideFeedSnapshot(
        error.reason == RideFeedFailure.authRequired
            ? RideFeedPhase.authRequired
            : RideFeedPhase.unavailable,
      );
    } catch (_) {
      if (requestId != _generation) return;
      snapshot = const RideFeedSnapshot(RideFeedPhase.unavailable);
    }
    notifyListeners();
  }

  @override
  void dispose() {
    // Invalidate an in-flight response before ChangeNotifier is disposed.
    _generation++;
    _verified = false;
    super.dispose();
  }
}
