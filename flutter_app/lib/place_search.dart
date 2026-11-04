import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'session_transport_base.dart';

@immutable
class PlaceSuggestion {
  const PlaceSuggestion({
    required this.id,
    required this.title,
    required this.subtitle,
  });
  final String id;
  final String title;
  final String subtitle;
}

@immutable
class SelectedPlace {
  const SelectedPlace({
    required this.id,
    required this.title,
    required this.address,
    required this.latitude,
    required this.longitude,
  });
  final String id;
  final String title;
  final String address;
  final double latitude;
  final double longitude;
}

enum PlaceSearchFailure { unavailable, rateLimited, notConfigured, invalidResponse }

class PlaceSearchException implements Exception {
  const PlaceSearchException(this.reason);
  final PlaceSearchFailure reason;
}

abstract interface class PlaceSearchSource {
  Future<List<PlaceSuggestion>> suggest({
    required String query,
    required String sessionToken,
  });

  Future<SelectedPlace> resolve({
    required PlaceSuggestion suggestion,
    required String sessionToken,
  });
}

/// Calls ONLY the CampusPool origin, never Google directly. The API key is
/// private on the Node server. The same session token is used for suggestions
/// and the selected place's details before it is discarded.
class HttpPlaceSearchSource implements PlaceSearchSource {
  HttpPlaceSearchSource({
    required Uri origin,
    required http.Client client,
    this.timeout = const Duration(seconds: 7),
  }) : _origin = origin, _client = client {
    validateApiOrigin(origin);
  }

  final Uri _origin;
  final http.Client _client;
  final Duration timeout;

  Future<Map<String, dynamic>> _post(String path, Map<String, String> query) async {
    final url = _origin.replace(path: path);
    http.Response response;
    try {
      response = await _client.post(url,
        headers: const {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: jsonEncode(query),
      ).timeout(timeout);
    } on TimeoutException {
      throw const PlaceSearchException(PlaceSearchFailure.unavailable);
    } on http.ClientException {
      throw const PlaceSearchException(PlaceSearchFailure.unavailable);
    }
    if (response.statusCode == 429) {
      throw const PlaceSearchException(PlaceSearchFailure.rateLimited);
    }
    if (response.statusCode == 503 &&
        response.body.contains('LOCATION_SEARCH_NOT_CONFIGURED')) {
      throw const PlaceSearchException(PlaceSearchFailure.notConfigured);
    }
    if (response.statusCode != 200) {
      throw const PlaceSearchException(PlaceSearchFailure.unavailable);
    }
    if (response.bodyBytes.length > 20000) {
      throw const PlaceSearchException(PlaceSearchFailure.invalidResponse);
    }
    try {
      final data = jsonDecode(response.body);
      if (data is Map<String, dynamic> && data['success'] == true &&
          data['provider'] == 'google') {
        return data;
      }
    } on FormatException {
      // Never reflect raw upstream response or private user search text.
    }
    throw const PlaceSearchException(PlaceSearchFailure.invalidResponse);
  }

  static String _text(Object? input, {int limit = 180}) {
    if (input is! String) return '';
    final cleaned = input.replaceAll(RegExp(r'[<>\u0000-\u001f\u007f]'), '').trim();
    return cleaned.length <= limit ? cleaned : cleaned.substring(0, limit);
  }

  @override
  Future<List<PlaceSuggestion>> suggest({
    required String query,
    required String sessionToken,
  }) async {
    final data = await _post('/api/places/suggest', {
      'q': query.trim(), 'sessionToken': sessionToken,
    });
    final raw = data['suggestions'];
    if (raw is! List || raw.length > 5) {
      throw const PlaceSearchException(PlaceSearchFailure.invalidResponse);
    }
    final suggestions = <PlaceSuggestion>[];
    for (final value in raw) {
      if (value is! Map<String, dynamic>) {
        throw const PlaceSearchException(PlaceSearchFailure.invalidResponse);
      }
      final id = _text(value['id']);
      final title = _text(value['title'], limit: 110);
      final subtitle = _text(value['subtitle']);
      if (!RegExp(r'^[A-Za-z0-9_-]{8,180}$').hasMatch(id) || title.isEmpty) {
        throw const PlaceSearchException(PlaceSearchFailure.invalidResponse);
      }
      suggestions.add(PlaceSuggestion(id: id, title: title, subtitle: subtitle));
    }
    return List.unmodifiable(suggestions);
  }

  @override
  Future<SelectedPlace> resolve({
    required PlaceSuggestion suggestion,
    required String sessionToken,
  }) async {
    final data = await _post('/api/places/resolve', {
      'id': suggestion.id, 'sessionToken': sessionToken,
    });
    final place = data['place'];
    if (place is! Map<String, dynamic> || place['id'] != suggestion.id) {
      throw const PlaceSearchException(PlaceSearchFailure.invalidResponse);
    }
    final lat = place['latitude'];
    final lng = place['longitude'];
    final address = _text(place['address'], limit: 260);
    if (lat is! num || lng is! num || !lat.isFinite || !lng.isFinite ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180 || address.isEmpty) {
      throw const PlaceSearchException(PlaceSearchFailure.invalidResponse);
    }
    return SelectedPlace(
      id: suggestion.id, title: suggestion.title, address: address,
      latitude: lat.toDouble(), longitude: lng.toDouble(),
    );
  }
}
