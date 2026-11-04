import 'package:flutter/material.dart';

import 'campus_auth.dart';
import 'campus_login_screen.dart';
import 'ride_feed.dart';
import 'place_search.dart';
import 'flows.dart';
import 'landing.dart';
import 'theme.dart';
import 'widgets.dart';

enum CampusSection { home, rides, errands, activity, profile }

class CampusShell extends StatefulWidget {
  const CampusShell({super.key, this.auth, this.rideSource, this.placeSource});

  final CampusAuthController? auth;
  final RideFeedSource? rideSource;
  final PlaceSearchSource? placeSource;

  @override
  State<CampusShell> createState() => _CampusShellState();
}

class _CampusShellState extends State<CampusShell> {
  CampusSection _section = CampusSection.home;

  bool get _signedIn => widget.auth?.isAuthenticated ?? false;

  @override
  void initState() {
    super.initState();
    widget.auth?.addListener(_onSessionChanged);
    widget.auth?.restore();
  }

  @override
  void didUpdateWidget(covariant CampusShell oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.auth != widget.auth) {
      oldWidget.auth?.removeListener(_onSessionChanged);
      widget.auth?.addListener(_onSessionChanged);
      widget.auth?.restore();
    }
  }

  @override
  void dispose() {
    widget.auth?.removeListener(_onSessionChanged);
    super.dispose();
  }

  void _onSessionChanged() {
    if (mounted) setState(() {});
  }

  void _select(CampusSection section) => setState(() => _section = section);

  void _openLogin() {
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => CampusLoginScreen(auth: widget.auth),
    ));
  }

  Future<void> _logout() async {
    final auth = widget.auth;
    if (auth == null) return;
    final complete = await auth.logout();
    if (!mounted || complete) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text(
        'Could not securely sign out. Check your connection and retry.')),
    );
  }

  void _openRunner() {
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => RunnerIntro(onVerify: () {
        Navigator.of(context).pop();
        _openLogin();
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
        return RidePreview(
          source: _signedIn ? widget.rideSource : null,
          hasVerifiedSession: _signedIn,
          placeSource: widget.placeSource,
        );
      case CampusSection.errands:
        return const ErrandDraftFlow();
      case CampusSection.activity:
        return ActivityPreview(onOpenTopUp: () {
          Navigator.of(context).push(MaterialPageRoute<void>(
            builder: (_) => const TipTopUpPreview()));
        });
      case CampusSection.profile:
        return ProfilePreview(
          hasVerifiedSession: _signedIn,
          memberName: widget.auth?.member?.displayName,
          onSignIn: _openLogin,
          onSignOut: _logout,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, size) {
      final wide = size.maxWidth >= 900;
      // The Android IME needs the full remaining viewport for address
      // predictions. Temporarily hide the guest CTA/nav bars only while
      // a text field is actively using the on-screen keyboard. On dismiss,
      // they return to their identical fixed positions.
      final keyboardOpen = MediaQuery.viewInsetsOf(context).bottom > 0;
      return Scaffold(
        body: SafeArea(
          child: Column(children: [
            _header(wide),
            Expanded(
              child: AnimatedSwitcher(
                duration: MediaQuery.disableAnimationsOf(context)
                    ? Duration.zero : const Duration(milliseconds: 240),
                child: SingleChildScrollView(
                  key: ValueKey('${_section.name}-${_signedIn ? 'verified' : 'guest'}'),
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
            if (!wide && !keyboardOpen) _stickyActions(),
            if (!wide && !keyboardOpen) _navigation(),
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
            label: _signedIn ? 'Find a ride' : 'Get started',
            onPressed: _signedIn
                ? () => _select(CampusSection.rides) : _openLogin)),
          const SizedBox(width: 9),
          SizedBox(width: 175, child: CampusButton(
            label: _signedIn ? 'Request an item' : 'Become a runner',
            primary: false, onPressed: _signedIn
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
          label: _signedIn ? 'Find a ride' : 'Get started',
          onPressed: _signedIn
            ? () => _select(CampusSection.rides) : _openLogin,
        )),
        const SizedBox(width: 10),
        Expanded(child: CampusButton(
          label: _signedIn ? 'Request an item' : 'Become a runner',
          primary: false,
          onPressed: _signedIn
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
    ))),
  );
}
