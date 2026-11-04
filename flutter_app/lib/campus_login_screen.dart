import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'campus_auth.dart';
import 'theme.dart';
import 'widgets.dart';

/// Real server-backed sign-in UI; never confuses the design preview with an
/// authenticated session. The server decides if a verified account exists.
class CampusLoginScreen extends StatefulWidget {
  const CampusLoginScreen({super.key, required this.auth});
  final CampusAuthController? auth;

  @override
  State<CampusLoginScreen> createState() => _CampusLoginScreenState();
}

class _CampusLoginScreenState extends State<CampusLoginScreen> {
  final _email = TextEditingController();
  final _otp = TextEditingController();

  @override
  void initState() {
    super.initState();
    widget.auth?.addListener(_refresh);
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    widget.auth?.removeListener(_refresh);
    _email.dispose();
    _otp.dispose();
    super.dispose();
  }

  Future<void> _requestCode() async {
    final auth = widget.auth;
    if (auth == null) return;
    await auth.requestCode(_email.text);
  }

  Future<void> _verify() async {
    final auth = widget.auth;
    if (auth == null) return;
    final ok = await auth.verifyCode(_otp.text);
    if (!mounted) return;
    if (ok) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final auth = widget.auth;
    final awaiting = auth?.awaitingCode ?? false;
    final disabled = auth == null || auth.busy;
    return Scaffold(
      appBar: AppBar(title: const Text('Campus sign-in')),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: ListView(
              padding: const EdgeInsets.all(24),
              children: [
                const CampusMark(size: 49),
                const SizedBox(height: 25),
                Text('Your campus. Your community.',
                    style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 13),
                const Text(
                  'Use the email address of an existing verified CampusPool '
                  'account. A real sign-in code is required.',
                  style: TextStyle(color: CpColors.muted, height: 1.5),
                ),
                const SizedBox(height: 26),
                if (auth == null) ...[
                  const CampusNote(
                    icon: Icons.lock_outline,
                    message: 'Sign-in is not configured for this build. '
                        'The guest experience remains available; no '
                        'authentication or ride data is being simulated.',
                  ),
                ] else ...[
                  const Text('REGISTERED EMAIL',
                      style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          color: CpColors.muted)),
                  const SizedBox(height: 9),
                  TextField(
                    key: const Key('campusLoginEmail'),
                    controller: _email,
                    enabled: !awaiting && !disabled,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.email],
                    textInputAction: TextInputAction.done,
                    maxLength: 254,
                    decoration: const InputDecoration(
                      hintText: 'Your registered email',
                      counterText: '',
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (awaiting) ...[
                    const CampusNote(
                      icon: Icons.mark_email_read_outlined,
                      message: 'If a verified account exists, the server '
                          'has requested a code for its registered email. '
                          'Delivery depends on the configured email provider.',
                    ),
                    const SizedBox(height: 18),
                    const Text('SIX-DIGIT EMAIL CODE',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          color: CpColors.muted,
                        )),
                    const SizedBox(height: 9),
                    TextField(
                      key: const Key('campusLoginOtp'),
                      controller: _otp,
                      enabled: !disabled,
                      keyboardType: TextInputType.number,
                      autofillHints: const [AutofillHints.oneTimeCode],
                      textInputAction: TextInputAction.done,
                      maxLength: 6,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      decoration: const InputDecoration(
                        hintText: 'Enter verification code',
                        counterText: '',
                      ),
                    ),
                    const SizedBox(height: 18),
                    CampusButton(
                      label: auth.phase == CampusAuthPhase.verifyingCode
                          ? 'Verifying…' : 'Verify and sign in',
                      onPressed: disabled ? null : _verify,
                    ),
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: disabled ? null : () {
                        _otp.clear();
                        auth.cancelChallenge();
                      },
                      child: const Text('Use a different email'),
                    ),
                  ] else ...[
                    CampusButton(
                      label: auth.phase == CampusAuthPhase.requestingCode
                          ? 'Requesting code…' : 'Request sign-in code',
                      onPressed: disabled ? null : _requestCode,
                    ),
                  ],
                  const SizedBox(height: 13),
                  if (auth.issue != CampusAuthIssue.none)
                    CampusNote(
                      icon: Icons.info_outline,
                      message: _safeMessage(auth.issue),
                    ),
                ],
                const SizedBox(height: 28),
                const Text(
                  'Never share your verification code. '
                  'CampusPool will not ask for it in a chat.',
                  style: TextStyle(fontSize: 12, color: CpColors.muted),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  static String _safeMessage(CampusAuthIssue issue) {
    switch (issue) {
      case CampusAuthIssue.invalidEmail:
        return 'Enter a valid registered email address.';
      case CampusAuthIssue.invalidCode:
        return 'Enter the six-digit email code.';
      case CampusAuthIssue.rateLimited:
        return 'Too many attempts. Try again later.';
      case CampusAuthIssue.deliveryUnavailable:
        return 'Email verification is temporarily unavailable.';
      case CampusAuthIssue.invalidOrExpiredCode:
        return 'The code was invalid or expired. Check it or request a new one.';
      case CampusAuthIssue.network:
        return 'Cannot reach CampusPool right now. Please try again.';
      case CampusAuthIssue.invalidResponse:
      case CampusAuthIssue.sessionRequired:
        return 'Your session was not confirmed. Please request a new code.';
      case CampusAuthIssue.none:
        return '';
    }
  }
}
