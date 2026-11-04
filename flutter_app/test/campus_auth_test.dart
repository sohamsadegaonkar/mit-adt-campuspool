import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:campuspool_flutter/campus_auth.dart';
import 'package:campuspool_flutter/session_transport_io.dart';

void main() {
  final origin = Uri.parse('https://campuspool.example');
  final csrf = List.filled(64, 'a').join();
  final cookieValue = List.filled(43, 'A').join();

  test('real OTP login only succeeds after HttpOnly cookie and /me check',
      () async {
    final paths = <String>[];
    final client = NativeCampusSessionClient(
      origin: origin,
      delegate: MockClient((request) async {
        paths.add(request.url.path);
        if (request.url.path == '/api/auth/login-request') {
          return http.Response('{"success":true,"expiresInSeconds":300}', 200);
        }
        if (request.url.path == '/api/auth/verify-email-otp') {
          return http.Response('{"success":true,"isLogin":true}', 200,
              headers: {
                'set-cookie': 'cp_session=$cookieValue; HttpOnly; '
                    'Secure; SameSite=Lax; Path=/',
              });
        }
        if (request.url.path == '/api/auth/me') {
          expect(request.headers['cookie'], 'cp_session=$cookieValue');
          return http.Response(
              '{"success":true,"user":{"name":"Verified Student",'
              '"email":"private@example.com","phone":"0000000000"},'
              '"csrfToken":"$csrf"}', 200);
        }
        if (request.url.path == '/api/auth/logout') {
          expect(request.headers['cookie'], 'cp_session=$cookieValue');
          expect(request.headers['x-csrf-token'], csrf);
          return http.Response('{"success":true}', 200,
              headers: const {'set-cookie': 'cp_session=; Max-Age=0; Path=/'});
        }
        throw StateError('Unexpected route');
      }),
    );
    final auth = CampusAuthController(
      CampusAuthApi(origin: origin, client: client),
    );
    expect(await auth.requestCode('student@mit.edu'), isTrue);
    expect(auth.awaitingCode, isTrue);
    expect(await auth.verifyCode('123456'), isTrue);
    expect(auth.isAuthenticated, isTrue);
    expect(auth.member?.displayName, 'Verified Student');
    expect(paths, [
      '/api/auth/login-request',
      '/api/auth/verify-email-otp',
      '/api/auth/me',
    ]);
    expect(await auth.logout(), isTrue);
    expect(auth.isAuthenticated, isFalse);
    expect(auth.member, isNull);
    auth.dispose();
    client.close();
  });

  test('OTP reply without a verifiable session does not unlock the UI',
      () async {
    final client = MockClient((request) async {
      switch (request.url.path) {
        case '/api/auth/login-request':
          return http.Response('{"success":true}', 200);
        case '/api/auth/verify-email-otp':
          return http.Response('{"success":true,"isLogin":true}', 200);
        case '/api/auth/me':
          return http.Response('{"success":false}', 401);
      }
      throw StateError('Unexpected route');
    });
    final auth = CampusAuthController(
      CampusAuthApi(origin: origin, client: client),
    );
    expect(await auth.requestCode('student@mit.edu'), isTrue);
    expect(await auth.verifyCode('123456'), isFalse);
    expect(auth.isAuthenticated, isFalse);
    expect(auth.issue, CampusAuthIssue.sessionRequired);
    auth.dispose();
    client.close();
  });

  test('incorrect email and invalid code are rejected before network', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response('{"success":true}', 200);
    });
    final auth = CampusAuthController(
      CampusAuthApi(origin: origin, client: client),
    );
    expect(await auth.requestCode('not-an-email'), isFalse);
    expect(auth.issue, CampusAuthIssue.invalidEmail);
    expect(calls, 0);
    expect(await auth.requestCode('student@mit.edu'), isTrue);
    expect(await auth.verifyCode('999'), isFalse);
    expect(auth.issue, CampusAuthIssue.invalidCode);
    expect(calls, 1);
    auth.dispose();
    client.close();
  });

  test('native client forbids cross-origin requests and retains no disk state',
      () async {
    final client = NativeCampusSessionClient(
      origin: origin,
      delegate: MockClient((request) async => http.Response('{}', 200)),
    );
    expect(
      () => client.get(Uri.parse('https://different.example/api/auth/me')),
      throwsA(isA<http.ClientException>()),
    );
    client.clearLocalSession();
    client.close();
  });

  test('invalid API origins fail closed', () {
    final inner = MockClient((_) async => http.Response('{}', 200));
    for (final invalid in [
      'http://public.example',
      'https://account:password@host.example',
      'https://host.example/path',
    ]) {
      expect(
        () => NativeCampusSessionClient(
          origin: Uri.parse(invalid), delegate: inner),
        throwsArgumentError,
      );
    }
    inner.close();
  });
}
