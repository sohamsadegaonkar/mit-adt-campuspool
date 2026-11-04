import 'package:flutter/material.dart';

import 'flows.dart';
import 'landing.dart';
import 'theme.dart';
import 'widgets.dart';

enum CampusSection { home, rides, errands, activity, profile }

class CampusShell extends StatefulWidget {
  const CampusShell({super.key});

  @override
  State<CampusShell> createState() => _CampusShellState();
}

class _CampusShellState extends State<CampusShell> {
  CampusSection _section = CampusSection.home;
  bool _signedInPreview = false;

  void _select(CampusSection section) => setState(() => _section = section);

  void _previewVerification() {
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => VerificationPreview(
        onContinue: () {
          Navigator.of(context).pop();
          setState(() => _signedInPreview = true);
        },
      ),
    ));
  }

  void _openRunner() {
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => RunnerIntro(onVerify: () {
        Navigator.of(context).pop();
        _previewVerification();
      }),
    ));
  }

  void _showNotifications() {
    showModalBottomSheet<void>(
      context: context, showDragHandle: true,
      builder: (context) => const SafeArea(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Campus updates', style: TextStyle(fontSize: 23,
                  fontWeight: FontWeight.w800)),
              SizedBox(height: 13),
              CampusNote(message:
                  'Notifications will show verified ride and errand updates once your account is connected.'),
              SizedBox(height: 16),
            ]),
        ),
      ),
    );
  }

  Widget _content() {
    switch (_section) {
      case CampusSection.home:
        return LandingContent(
          onRide: () => _select(CampusSection.rides),
          onErrand: () => _select(CampusSection.errands),
          onRunner: _openRunner,
        );
      case CampusSection.rides:
        return const RidePreview();
      case CampusSection.errands:
        return const ErrandDraftFlow();
      case CampusSection.activity:
        return ActivityPreview(onOpenTopUp: () {
          Navigator.of(context).push(MaterialPageRoute<void>(
            builder: (_) => const TipTopUpPreview()));
        });
      case CampusSection.profile:
        return ProfilePreview(signedInPreview: _signedInPreview,
          onPreviewSignIn: _previewVerification,
          onReturnGuest: () => setState(() => _signedInPreview = false));
    }
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, size) {
      final wide = size.maxWidth >= 900;
      return Scaffold(
        body: SafeArea(
          child: Column(children: [
            _header(wide),
            Expanded(
              child: AnimatedSwitcher(
                duration: MediaQuery.disableAnimationsOf(context)
                    ? Duration.zero : const Duration(milliseconds: 240),
                child: SingleChildScrollView(
                  key: ValueKey('${_section.name}-${_signedInPreview ? 'preview' : 'guest'}'),
                  padding: EdgeInsets.symmetric(
                    horizontal: wide ? 38 : 20, vertical: wide ? 24 : 22),
                  child: Center(
                    child: ConstrainedBox(
                      constraints: BoxConstraints(maxWidth: wide ? 1336 : 640),
                      child: _content(),
                    ),
                  ),
                ),
              ),
            ),
            if (!wide) _stickyActions(),
            if (!wide) _navigation(),
          ]),
        ),
      );
    });
  }

  Widget _header(bool wide) {
    return Container(
      height: wide ? 78 : 66,
      padding: EdgeInsets.symmetric(horizontal: wide ? 38 : 20),
      decoration: const BoxDecoration(color: Colors.white,
        border: Border(bottom: BorderSide(color: CpColors.border))),
      child: Row(children: [
        const CampusMark(size: 36),
        const SizedBox(width: 12),
        Column(mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('CampusPool', style: Theme.of(context).textTheme.titleMedium),
            const Text('MIT-ADT University', style:
                TextStyle(color: CpColors.muted, fontSize: 10)),
          ]),
        if (wide) ...[
          const Spacer(),
          TextButton(onPressed: () => _select(CampusSection.home),
              child: const Text('Home')),
          TextButton(onPressed: () => _select(CampusSection.rides),
              child: const Text('Rides')),
          TextButton(onPressed: () => _select(CampusSection.errands),
              child: const Text('Errands')),
          const Spacer(),
          SizedBox(width: 155, child: CampusButton(
            label: _signedInPreview ? 'Find a ride' : 'Get started',
            onPressed: _signedInPreview
                ? () => _select(CampusSection.rides) : _previewVerification)),
          const SizedBox(width: 9),
          SizedBox(width: 175, child: CampusButton(
            label: _signedInPreview ? 'Request an item' : 'Become a runner',
            primary: false, onPressed: _signedInPreview
              ? () => _select(CampusSection.errands) : _openRunner)),
        ] else ...[
          const Spacer(),
          IconButton(
            onPressed: _showNotifications,
            tooltip: 'Campus updates',
            icon: const Icon(Icons.notifications_none_rounded)),
        ],
      ]),
    );
  }

  Widget _stickyActions() {
    return Container(
      key: const Key('stickyGuestActions'),
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 14),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: CpColors.border)),
      ),
      child: Row(children: [
        Expanded(child: CampusButton(
          label: _signedInPreview ? 'Find a ride' : 'Get started',
          onPressed: _signedInPreview
            ? () => _select(CampusSection.rides) : _previewVerification,
        )),
        const SizedBox(width: 10),
        Expanded(child: CampusButton(
          label: _signedInPreview ? 'Request an item' : 'Become a runner',
          primary: false,
          onPressed: _signedInPreview
            ? () => _select(CampusSection.errands) : _openRunner,
        )),
      ]),
    );
  }

  Widget _navigation() {
    const entries = <(CampusSection, IconData, String)>[
      (CampusSection.home, Icons.home_outlined, 'Home'),
      (CampusSection.rides, Icons.directions_car_outlined, 'Rides'),
      (CampusSection.errands, Icons.shopping_bag_outlined, 'Errands'),
      (CampusSection.activity, Icons.assignment_outlined, 'Activity'),
      (CampusSection.profile, Icons.person_outline_rounded, 'Profile'),
    ];
    return Container(
      decoration: const BoxDecoration(color: Colors.white,
        border: Border(top: BorderSide(color: CpColors.border))),
      padding: const EdgeInsets.fromLTRB(7, 6, 7, 5),
      child: Row(children: [
        for (final (section, icon, label) in entries)
          Expanded(child: Semantics(
            button: true, selected: _section == section, label: label,
            child: InkWell(
              key: ValueKey('tab_${section.name}'),
              onTap: () => _select(section),
              borderRadius: BorderRadius.circular(12),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 8),
                decoration: BoxDecoration(
                  color: _section == section
                    ? CpColors.yellowSoft : Colors.transparent,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Icon(icon, size: 22, color: CpColors.ink),
                  const SizedBox(height: 4),
                  Text(label, style: TextStyle(
                    color: _section == section ? CpColors.ink : CpColors.muted,
                    fontWeight: _section == section
                      ? FontWeight.w700 : FontWeight.w400,
                    fontSize: 10,
                  )),
                ]),
              ),
            ),
          )),
      ]),
    );
  }
}

class VerificationPreview extends StatelessWidget {
  const VerificationPreview({super.key, required this.onContinue});
  final VoidCallback onContinue;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Campus verification')),
    body: SafeArea(child: Center(child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 540),
      child: ListView(padding: const EdgeInsets.all(24), children: [
        const CampusMark(size: 50),
        const SizedBox(height: 26),
        Text('Your campus. Your community.',
          style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 12),
        const Text('Student verification protects rides and handovers. '
          'Email and OTP services are not connected in this UI build.'),
        const SizedBox(height: 27),
        const Text('UNIVERSITY EMAIL', style:
          TextStyle(fontWeight: FontWeight.w700, fontSize: 11)),
        const SizedBox(height: 10),
        const TextField(key: Key('emailField'), keyboardType:
          TextInputType.emailAddress,
          decoration: InputDecoration(hintText: 'Your university email')),
        const SizedBox(height: 20),
        const CampusNote(message:
          'This form is a visual preview only. No email is submitted or verified.'),
        const SizedBox(height: 22),
        CampusButton(
          label: 'Preview signed-in layout',
          onPressed: onContinue,
        ),
      ]),
    )))),
  );
}

class RunnerIntro extends StatelessWidget {
  const RunnerIntro({super.key, required this.onVerify});
  final VoidCallback onVerify;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Become a runner')),
    body: SafeArea(child: Center(child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 550),
      child: ListView(padding: const EdgeInsets.all(24), children: [
        const SizedBox(height: 15),
        const CampusRouteArt(height: 180),
        const SizedBox(height: 28),
        Text('Already going somewhere?',
          style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 13),
        const Text('Help students with nearby errands on trips you are already making. '
          'See the offered reward before accepting.'),
        const SizedBox(height: 24),
        const CampusNote(message: 'An urgent tip is optional and never a '
          'guarantee of faster delivery. Safety matters more than speed.'),
        const SizedBox(height: 28),
        CampusButton(label: 'Continue to campus verification',
            onPressed: onVerify),
      ]),
    )))),
  );
}
