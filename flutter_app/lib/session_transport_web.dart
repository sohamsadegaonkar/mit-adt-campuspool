import 'package:http/http.dart' as http;
import 'package:http/browser_client.dart';
import 'session_transport_base.dart';

CampusSessionClient makeCampusSessionClient(Uri origin) =>
    WebCampusSessionClient(origin: origin);

/// Browser manages the HttpOnly cookie. Never attempt to read it in Dart.
/// Same-origin is mandatory: the existing server does not allow credentialed
/// cross-origin CORS and the client must not silently weaken that policy.
class WebCampusSessionClient extends CampusSessionClient {
  WebCampusSessionClient({required Uri origin}) : _origin = origin {
    validateApiOrigin(origin);
    if (origin.origin != Uri.base.origin) {
      throw ArgumentError.value(
          origin, 'origin', 'Flutter Web must use same-origin CampusPool API');
    }
    _delegate.withCredentials = true;
  }

  final Uri _origin;
  final BrowserClient _delegate = BrowserClient();

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    if (request.url.origin != _origin.origin) {
      throw http.ClientException('Cross-origin request blocked');
    }
    return _delegate.send(request);
  }

  @override
  void clearLocalSession() {
    // A browser's HttpOnly cookie is removed ONLY by /api/auth/logout.
    // Clearing JavaScript state cannot revoke a server session.
  }

  @override
  void close() => _delegate.close();
}
