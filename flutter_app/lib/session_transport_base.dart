import 'package:http/http.dart' as http;

/// A private cookie transport. Session credentials never appear in Flutter
/// widgets, local storage, query parameters or application logs.
abstract class CampusSessionClient extends http.BaseClient {
  void clearLocalSession();
}

void validateApiOrigin(Uri origin) {
  final loopback = origin.host == 'localhost' ||
      origin.host == '127.0.0.1' || origin.host == '::1';
  final allowed = origin.scheme == 'https' ||
      (loopback && origin.scheme == 'http');
  if (!allowed ||
      origin.userInfo.isNotEmpty ||
      origin.hasQuery ||
      origin.hasFragment ||
      (origin.path.isNotEmpty && origin.path != '/')) {
    throw ArgumentError.value(origin, 'origin',
        'A clean HTTPS origin is required (HTTP only on loopback).');
  }
}
