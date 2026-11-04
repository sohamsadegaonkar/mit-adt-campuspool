import 'package:flutter/foundation.dart';

import 'campus_auth.dart';
import 'ride_feed.dart';
import 'session_transport.dart';
import 'session_transport_base.dart';

/// API connection is an explicit deployment decision, never an implicit
/// localhost/production fallback. Build with:
/// --dart-define=CAMPUSPOOL_API_ORIGIN=same-origin (browser, same origin only)
/// --dart-define=CAMPUSPOOL_API_ORIGIN=https://approved-api-host (native)
class CampusRuntime {
  CampusRuntime._(this.transport, this.auth, this.rideSource);

  final CampusSessionClient transport;
  final CampusAuthController auth;
  final RideFeedSource rideSource;

  static CampusRuntime? fromEnvironment() {
    const configured = String.fromEnvironment('CAMPUSPOOL_API_ORIGIN');
    if (configured.isEmpty) return null;
    final origin = configured == 'same-origin'
        ? Uri.parse(Uri.base.origin)
        : Uri.tryParse(configured);
    if (origin == null) {
      throw ArgumentError('Invalid configured CampusPool API origin');
    }
    validateApiOrigin(origin);
    if (kIsWeb && origin.origin != Uri.base.origin) {
      throw ArgumentError('Flutter Web requires same-origin API deployment');
    }
    final transport = createCampusSessionClient(origin);
    return CampusRuntime._(
      transport,
      CampusAuthController(CampusAuthApi(
          origin: origin, client: transport)),
      AuthenticatedRideFeed(origin: origin, client: transport),
    );
  }

  void dispose() {
    auth.dispose();
    transport.close();
  }
}
