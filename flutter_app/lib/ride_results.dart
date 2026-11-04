import 'package:flutter/material.dart';

import 'ride_feed.dart';
import 'theme.dart';
import 'widgets.dart';

/// Figma-aligned, explicit states. None of these cards create fake inventory.
class RideResultsPanel extends StatelessWidget {
  const RideResultsPanel({
    super.key,
    required this.snapshot,
    this.onRetry,
    this.onSignIn,
  });

  final RideFeedSnapshot snapshot;
  final VoidCallback? onRetry;
  final VoidCallback? onSignIn;

  @override
  Widget build(BuildContext context) {
    switch (snapshot.phase) {
      case RideFeedPhase.preview:
        return const _InformationState(
          icon: Icons.directions_car_outlined,
          title: 'No live rides to display',
          description: 'Verified matches will appear here once a real '
              'campus session and server-backed search are connected.',
        );
      case RideFeedPhase.loading:
        return const _RideSkeleton();
      case RideFeedPhase.empty:
        return const _InformationState(
          icon: Icons.search_off_outlined,
          title: 'No matching rides',
          description: 'There are no available seats for the selected '
              'criteria. You can change the filters and try again.',
        );
      case RideFeedPhase.authRequired:
        return _InformationState(
          icon: Icons.lock_outline_rounded,
          title: 'Campus sign-in required',
          description: 'Your verified session is needed to see student rides.',
          action: onSignIn == null
              ? null
              : CampusButton(label: 'Sign in', onPressed: onSignIn),
        );
      case RideFeedPhase.unavailable:
        return _InformationState(
          icon: Icons.wifi_off_rounded,
          title: 'Unable to load rides',
          description: 'The service may be unavailable. Please retry.',
          action: onRetry == null
              ? null
              : CampusButton(label: 'Try again', onPressed: onRetry),
        );
      case RideFeedPhase.ready:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${snapshot.rides.length} available ride${snapshot.rides.length == 1 ? '' : 's'}',
              style: const TextStyle(
                  fontWeight: FontWeight.w800, color: CpColors.ink),
            ),
            const SizedBox(height: 12),
            for (final ride in snapshot.rides) ...[
              _RideResultCard(ride),
              const SizedBox(height: 10),
            ],
          ],
        );
    }
  }
}

class _RideResultCard extends StatelessWidget {
  const _RideResultCard(this.ride);
  final RideSummary ride;

  @override
  Widget build(BuildContext context) => CampusPanel(
        color: Colors.white,
        padding: const EdgeInsets.all(16),
        child: Semantics(
          label: '${ride.vehicle} from ${ride.pickup} to '
              '${ride.destination}, ${ride.seatsLeft} seats left',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Icon(
                  ride.vehicle == 'Bike'
                      ? Icons.two_wheeler_outlined
                      : Icons.directions_car_outlined,
                  color: CpColors.ink,
                ),
                const SizedBox(width: 9),
                Expanded(
                    child: Text(ride.vehicle,
                        style: const TextStyle(
                            fontWeight: FontWeight.w700))),
                Text('${ride.seatsLeft} seat${ride.seatsLeft == 1 ? '' : 's'}',
                    style: const TextStyle(color: CpColors.muted)),
              ]),
              const SizedBox(height: 12),
              Text('${ride.pickup}  →  ${ride.destination}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontWeight: FontWeight.w800, color: CpColors.ink)),
              const SizedBox(height: 7),
              Text(ride.departureTime,
                  style: const TextStyle(color: CpColors.muted)),
              const SizedBox(height: 6),
              const Text('Booking is not available in this client preview.',
                  style: TextStyle(fontSize: 11, color: CpColors.muted)),
            ],
          ),
        ),
      );
}

class _InformationState extends StatelessWidget {
  const _InformationState({
    required this.icon,
    required this.title,
    required this.description,
    this.action,
  });

  final IconData icon;
  final String title;
  final String description;
  final Widget? action;

  @override
  Widget build(BuildContext context) => CampusPanel(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 28),
        child: Column(children: [
          Icon(icon, size: 44, color: CpColors.muted),
          const SizedBox(height: 14),
          Text(title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                  fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          Text(description,
              textAlign: TextAlign.center,
              style: const TextStyle(
                  color: CpColors.muted, height: 1.45)),
          if (action != null) ...[
            const SizedBox(height: 20),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 250),
              child: action!,
            ),
          ],
        ]),
      );
}

class _RideSkeleton extends StatefulWidget {
  const _RideSkeleton();

  @override
  State<_RideSkeleton> createState() => _RideSkeletonState();
}

class _RideSkeletonState extends State<_RideSkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 900))
      ..repeat(reverse: true);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _pulse.stop();
    } else if (!_pulse.isAnimating) {
      _pulse.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Loading available rides',
      liveRegion: true,
      child: ExcludeSemantics(
        child: AnimatedBuilder(
          animation: _pulse,
          builder: (context, child) => Opacity(
            opacity: MediaQuery.disableAnimationsOf(context)
                ? 1
                : 0.58 + 0.42 * _pulse.value,
            child: child,
          ),
          child: Column(
            key: const Key('rideLoadingSkeleton'),
            children: [
              for (var index = 0; index < 2; index++) ...[
                const CampusPanel(
                  padding: EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _SkeletonLine(width: 75, height: 22),
                      SizedBox(height: 18),
                      _SkeletonLine(width: 250, height: 14),
                      SizedBox(height: 9),
                      _SkeletonLine(width: 156, height: 12),
                    ],
                  ),
                ),
                const SizedBox(height: 10),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _SkeletonLine extends StatelessWidget {
  const _SkeletonLine({required this.width, required this.height});
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) => Container(
        height: height,
        width: width,
        decoration: BoxDecoration(
          color: const Color(0xFFE1E1DF),
          borderRadius: BorderRadius.circular(6),
        ),
      );
}
