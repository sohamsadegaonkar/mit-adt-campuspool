import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'session_transport_base.dart';

enum CampusAuthPhase {
  guest,
  checking,
  requestingCode,
  awaitingCode,
  verifyingCode,
  authenticated,
  signingOut,
  unavailable,
}

enum CampusAuthIssue {
  none,
  invalidEmail,
  invalidCode,
  rateLimited,
  deliveryUnavailable,
  invalidOrExpiredCode,
  network,
  invalidResponse,
  sessionRequired,
  unsupportedLegacyAuth,
}

@immutable
class CampusMember {
  const CampusMember({required this.displayName});
  final String displayName;

  factory CampusMember.fromServer(Map<String, dynamic> user) {
    final name = user['name'];
    if (name is! String || name.trim().isEmpty || name.length > 100) {
      throw const CampusAuthException(CampusAuthIssue.invalidResponse);
    }
    // Deliberately discard email, phone, account identifiers and all other
    // student profile fields from the view model.
    return CampusMember(displayName: name.trim());
  }
}

class CampusAuthException implements Exception {
  const CampusAuthException(this.issue);
  final CampusAuthIssue issue;
}

/// Existing Node endpoints, not a new or local authentication authority.
/// The transport is responsible for HttpOnly cookies. No OTP, session cookie,
/// or CSRF token is saved to disk, diagnostics or application state logs.
class CampusAuthApi {
  CampusAuthApi({
    required Uri origin,
    required http.Client client,
    this.timeout = const Duration(seconds: 10),
  })  : _origin = origin,
        _client = client;

  final Uri _origin;
  final http.Client _client;
  final Duration timeout;
  String? _csrf;

  Future<http.Response> _request(String method, String path,
      [Map<String, dynamic>? payload, bool needCsrf = false]) async {
    final headers = <String, String>{'Accept': 'application/json'};
    if (payload != null) headers['Content-Type'] = 'application/json';
    if (needCsrf) {
      if (_csrf == null) {
        throw const CampusAuthException(CampusAuthIssue.sessionRequired);
      }
      headers['X-CSRF-Token'] = _csrf!;
    }
    try {
      final url = _origin.resolve(path);
      if (method == 'GET') {
        return await _client.get(url, headers: headers).timeout(timeout);
      }
      return await _client.post(url, headers: headers,
          body: jsonEncode(payload ?? <String, dynamic>{})).timeout(timeout);
    } on TimeoutException {
      throw const CampusAuthException(CampusAuthIssue.network);
    } on http.ClientException {
      throw const CampusAuthException(CampusAuthIssue.network);
    }
  }

  Map<String, dynamic> _decode(http.Response response) {
    if (response.bodyBytes.length > 32768) {
      throw const CampusAuthException(CampusAuthIssue.invalidResponse);
    }
    try {
      final data = jsonDecode(response.body);
      if (data is Map<String, dynamic>) return data;
    } on FormatException {
      // Intentionally do not expose raw server body to the user or logs.
    }
    throw const CampusAuthException(CampusAuthIssue.invalidResponse);
  }

  CampusAuthIssue _error(http.Response response) {
    if (response.statusCode == 429) return CampusAuthIssue.rateLimited;
    if (response.statusCode == 503) return CampusAuthIssue.deliveryUnavailable;
    if (response.statusCode == 401 || response.statusCode == 403) {
      return CampusAuthIssue.sessionRequired;
    }
    if (response.statusCode == 400) return CampusAuthIssue.invalidOrExpiredCode;
    return CampusAuthIssue.network;
  }

  /// Returns a generic acknowledgement only; the backend deliberately does
  /// not reveal whether the account exists in Postgres-auth mode.
  Future<void> requestCode(String email) async {
    final response = await _request('POST', '/api/auth/login-request',
        {'identifier': email});
    if (response.statusCode != 200) {
      throw CampusAuthException(_error(response));
    }
    final data = _decode(response);
    final expires = data['expiresInSeconds'];
    if (data['success'] != true ||
        expires is! num || !expires.isFinite ||
        expires < 60 || expires > 900 ||
        data.containsKey('email') ||
        data.containsKey('phone') ||
        data.containsKey('name') ||
        data.containsKey('devOtpHint')) {
      // Older SQLite auth can enumerate registered accounts and return
      // private profile fields. Never use it to unlock this Flutter flow.
      throw const CampusAuthException(CampusAuthIssue.unsupportedLegacyAuth);
    }
  }

  Future<CampusMember> verifyCode(String email, String otp) async {
    final response = await _request('POST', '/api/auth/verify-email-otp', {
      'email': email,
      'otp': otp,
      'isLoginFlow': true,
    });
    if (response.statusCode != 200) {
      throw CampusAuthException(_error(response));
    }
    final data = _decode(response);
    if (data['success'] != true || data['isLogin'] != true ||
        data.containsKey('emailToken') ||
        data.containsKey('devOtpHint')) {
      throw const CampusAuthException(CampusAuthIssue.sessionRequired);
    }
    // Even a 200 verification reply is not evidence of a login. The server
    // session cookie must round-trip through its authenticated /me endpoint.
    final member = await currentMember();
    if (member == null) {
      throw const CampusAuthException(CampusAuthIssue.sessionRequired);
    }
    return member;
  }

  Future<CampusMember?> currentMember() async {
    final response = await _request('GET', '/api/auth/me');
    if (response.statusCode == 401 || response.statusCode == 403) {
      _csrf = null;
      return null;
    }
    if (response.statusCode != 200) {
      throw CampusAuthException(_error(response));
    }
    final data = _decode(response);
    if (data['success'] != true || data['user'] is! Map<String, dynamic>) {
      throw const CampusAuthException(CampusAuthIssue.invalidResponse);
    }
    final csrf = data['csrfToken'];
    if (csrf is! String || !RegExp(r'^[a-f0-9]{64}$').hasMatch(csrf)) {
      throw const CampusAuthException(CampusAuthIssue.invalidResponse);
    }
    final member = CampusMember.fromServer(data['user'] as Map<String, dynamic>);
    _csrf = csrf;
    return member;
  }

  Future<void> logout() async {
    final response = await _request(
        'POST', '/api/auth/logout', <String, dynamic>{}, true);
    if (response.statusCode != 200 || _decode(response)['success'] != true) {
      throw CampusAuthException(_error(response));
    }
    _csrf = null;
    if (_client is CampusSessionClient) {
      _client.clearLocalSession();
    }
  }

  void discardLocalState() => _csrf = null;
}

/// Binds the UI only to a verified /api/auth/me result. No fake sign-in state
/// is accepted from preview buttons, and late requests cannot resurrect auth.
class CampusAuthController extends ChangeNotifier {
  CampusAuthController(this.api);

  final CampusAuthApi api;
  CampusAuthPhase phase = CampusAuthPhase.guest;
  CampusAuthIssue issue = CampusAuthIssue.none;
  CampusMember? member;
  String? _pendingEmail;
  int _revision = 0;
  bool _disposed = false;

  bool get isAuthenticated =>
      phase == CampusAuthPhase.authenticated && member != null;
  bool get awaitingCode => phase == CampusAuthPhase.awaitingCode;
  bool get busy => {
        CampusAuthPhase.checking,
        CampusAuthPhase.requestingCode,
        CampusAuthPhase.verifyingCode,
        CampusAuthPhase.signingOut,
      }.contains(phase);

  void _publish() {
    if (!_disposed) notifyListeners();
  }

  Future<void> restore() async {
    if (_disposed || busy) return;
    final turn = ++_revision;
    phase = CampusAuthPhase.checking;
    issue = CampusAuthIssue.none;
    _publish();
    try {
      final current = await api.currentMember();
      if (turn != _revision || _disposed) return;
      member = current;
      phase = current == null
          ? CampusAuthPhase.guest : CampusAuthPhase.authenticated;
    } on CampusAuthException catch (error) {
      if (turn != _revision || _disposed) return;
      member = null;
      issue = error.issue;
      phase = CampusAuthPhase.unavailable;
    } catch (_) {
      if (turn != _revision || _disposed) return;
      member = null;
      issue = CampusAuthIssue.network;
      phase = CampusAuthPhase.unavailable;
    }
    _publish();
  }

  Future<bool> requestCode(String email) async {
    if (_disposed || busy) return false;
    final value = email.trim().toLowerCase();
    if (value.length > 254 ||
        !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value)) {
      issue = CampusAuthIssue.invalidEmail;
      _publish();
      return false;
    }
    final turn = ++_revision;
    _pendingEmail = null;
    issue = CampusAuthIssue.none;
    phase = CampusAuthPhase.requestingCode;
    _publish();
    try {
      await api.requestCode(value);
      if (turn != _revision || _disposed) return false;
      _pendingEmail = value;
      phase = CampusAuthPhase.awaitingCode;
      _publish();
      return true;
    } on CampusAuthException catch (error) {
      if (turn != _revision || _disposed) return false;
      issue = error.issue;
    } catch (_) {
      if (turn != _revision || _disposed) return false;
      issue = CampusAuthIssue.network;
    }
    phase = CampusAuthPhase.guest;
    _publish();
    return false;
  }

  Future<bool> verifyCode(String otp) async {
    if (_disposed || busy || _pendingEmail == null) return false;
    if (!RegExp(r'^\d{6}$').hasMatch(otp)) {
      issue = CampusAuthIssue.invalidCode;
      _publish();
      return false;
    }
    final turn = ++_revision;
    final email = _pendingEmail!;
    issue = CampusAuthIssue.none;
    phase = CampusAuthPhase.verifyingCode;
    _publish();
    try {
      final confirmed = await api.verifyCode(email, otp);
      if (turn != _revision || _disposed) return false;
      member = confirmed;
      _pendingEmail = null;
      phase = CampusAuthPhase.authenticated;
      _publish();
      return true;
    } on CampusAuthException catch (error) {
      if (turn != _revision || _disposed) return false;
      issue = error.issue;
    } catch (_) {
      if (turn != _revision || _disposed) return false;
      issue = CampusAuthIssue.network;
    }
    // Never reuse a consumed / invalid challenge without an explicit new
    // request if the authoritative session check failed.
    phase = CampusAuthPhase.awaitingCode;
    _publish();
    return false;
  }

  void cancelChallenge() {
    ++_revision;
    _pendingEmail = null;
    issue = CampusAuthIssue.none;
    if (!isAuthenticated) phase = CampusAuthPhase.guest;
    _publish();
  }

  Future<bool> logout() async {
    if (!isAuthenticated || busy || _disposed) return false;
    final turn = ++_revision;
    phase = CampusAuthPhase.signingOut;
    issue = CampusAuthIssue.none;
    _publish();
    try {
      await api.logout();
      if (turn != _revision || _disposed) return false;
      member = null;
      _pendingEmail = null;
      phase = CampusAuthPhase.guest;
      _publish();
      return true;
    } on CampusAuthException catch (error) {
      if (turn != _revision || _disposed) return false;
      issue = error.issue;
    } catch (_) {
      if (turn != _revision || _disposed) return false;
      issue = CampusAuthIssue.network;
    }
    // Do not claim logout if remote revocation failed.
    phase = CampusAuthPhase.authenticated;
    _publish();
    return false;
  }

  @override
  void dispose() {
    _revision++;
    _disposed = true;
    member = null;
    _pendingEmail = null;
    api.discardLocalState();
    super.dispose();
  }
}
