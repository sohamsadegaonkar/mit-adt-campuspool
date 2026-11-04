import 'package:http/http.dart' as http;
import 'session_transport_base.dart';

CampusSessionClient makeCampusSessionClient(Uri origin) =>
    NativeCampusSessionClient(origin: origin, delegate: http.Client());

/// Native-only in-memory session cookie. It is discarded on process death,
/// explicit logout, client disposal or a failed /api/auth/me check.
/// Never persist the HttpOnly session in preferences or a debug logger.
class NativeCampusSessionClient extends CampusSessionClient {
  NativeCampusSessionClient({
    required Uri origin,
    required http.Client delegate,
  })  : _origin = origin,
        _delegate = delegate {
    validateApiOrigin(origin);
  }

  final Uri _origin;
  final http.Client _delegate;
  String? _cookie;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.url.origin != _origin.origin) {
      throw http.ClientException('Cross-origin request blocked');
    }
    request.followRedirects = false;
    if (_cookie != null) {
      request.headers['Cookie'] = _cookie!;
    }
    final response = await _delegate.send(request);
    final raw = response.headers['set-cookie'];
    if (raw != null) {
      if (RegExp(r'(?:^|[,\s])cp_session=;').hasMatch(raw)) {
        _cookie = null;
      } else {
        final found = RegExp(r'(?:^|[,\s])cp_session=([A-Za-z0-9_-]{43})(?:;|$)')
            .firstMatch(raw);
        if (found != null) _cookie = 'cp_session=${found.group(1)}';
      }
    }
    if (request.url.path == '/api/auth/me' && response.statusCode == 401) {
      _cookie = null;
    }
    return response;
  }

  @override
  void clearLocalSession() {
    _cookie = null;
  }

  @override
  void close() {
    _cookie = null;
    _delegate.close();
  }
}
