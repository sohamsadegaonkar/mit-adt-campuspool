import 'package:flutter/material.dart';

import 'theme.dart';
import 'widgets.dart';

class LandingContent extends StatefulWidget {
  const LandingContent({super.key, required this.onRide,
    required this.onErrand, required this.onRunner});
  final VoidCallback onRide;
  final VoidCallback onErrand;
  final VoidCallback onRunner;

  @override
  State<LandingContent> createState() => _LandingContentState();
}

class _LandingContentState extends State<LandingContent> {
  final PageController _carousel = PageController();
  int _currentSlide = 0;

  static const _slides = [
    ('CAMPUS LIFE', 'Better together',
      'A campus day, shared with others.', CpColors.green),
    ('THE RIDE', 'A seat on the way',
      'Find journeys before planning yours.', Color(0xFF33312B)),
    ('EVERYDAY HELP', 'Small errands, less effort',
      'Ask someone already heading out.', Color(0xFF2E3B45)),
  ];

  @override
  void dispose() {
    _carousel.dispose();
    super.dispose();
  }

  void _slide(int delta) {
    final next = (_currentSlide + delta + _slides.length) % _slides.length;
    if (MediaQuery.disableAnimationsOf(context)) {
      _carousel.jumpToPage(next);
    } else {
      _carousel.animateToPage(next, duration: const Duration(milliseconds: 220),
        curve: Curves.easeOutCubic);
    }
    setState(() => _currentSlide = next);
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final wide = constraints.maxWidth >= 780;
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (wide) _wideHero() else _mobileHero(),
        SizedBox(height: wide ? 38 : 30),
        SectionTitle(wide ? 'Whatever your day needs' : 'What brings you here?'),
        const SizedBox(height: 16),
        if (wide)
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(child: _service(Icons.directions_car_outlined,
                'Share a ride', 'Carpool with students on the way.',
                const Color(0xFFFFF0BD), widget.onRide)),
            const SizedBox(width: 12),
            Expanded(child: _service(Icons.shopping_bag_outlined,
                'Request an item', 'Get campus essentials on a shared trip.',
                CpColors.surface, widget.onErrand)),
            const SizedBox(width: 12),
            Expanded(child: _service(Icons.alt_route_rounded,
                'Become a runner', 'Earn on trips you already make.',
                const Color(0xFFFFF9E7), widget.onRunner)),
          ])
        else ...[
          Row(children: [
            Expanded(child: _service(Icons.directions_car_outlined,
                'Find a ride', 'Carpool with students',
                const Color(0xFFFFF0BD), widget.onRide)),
            const SizedBox(width: 10),
            Expanded(child: _service(Icons.shopping_bag_outlined,
                'Request an item', 'Get campus essentials',
                CpColors.surface, widget.onErrand)),
          ]),
          const SizedBox(height: 12),
          _runnerCard(),
        ],
        const SizedBox(height: 38),
        const SectionTitle('How CampusPool works'),
        const SizedBox(height: 16),
        if (wide)
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(child: _step('01', 'Post a request',
              'Choose a ride or describe the item you need.')),
            const SizedBox(width: 12),
            Expanded(child: _step('02', 'Get matched',
              'An eligible student can choose to accept.')),
            const SizedBox(width: 12),
            Expanded(child: _step('03', 'Complete safely',
              'Meet at a shared public handover point.')),
          ])
        else ...[
          _step('01', 'Post a request',
            'Choose a ride or describe the item you need.'),
          const SizedBox(height: 10),
          _step('02', 'Get matched',
            'An eligible student can choose to accept.'),
          const SizedBox(height: 10),
          _step('03', 'Complete safely',
            'Meet at a shared public handover point.'),
        ],
        const SizedBox(height: 34),
        const SectionTitle('Built for a better campus day'),
        const SizedBox(height: 14),
        Row(children: [
          Expanded(child: _benefit(Icons.people_outline, 'Community',
              'Campus-first')),
          const SizedBox(width: 8),
          Expanded(child: _benefit(Icons.receipt_long_outlined, 'Transparent',
              'Clear estimates')),
          const SizedBox(width: 8),
          Expanded(child: _benefit(Icons.alt_route_rounded, 'Flexible',
              'Choose your role')),
        ]),
        const SizedBox(height: 27),
        _buildCarousel(),
        const SizedBox(height: 14),
        const Text(
          'CampusPool 2.0 design preview · No live rides or payments connected.',
          style: TextStyle(color: CpColors.muted, fontSize: 11),
        ),
        const SizedBox(height: 22),
      ]);
    },
  );

  Widget _mobileHero() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('Campus is better\ntogether.',
        style: Theme.of(context).textTheme.displaySmall),
      const SizedBox(height: 15),
      const Text('Find a ride, get essentials, or help another student '
        'on a trip you are already making.',
        style: TextStyle(fontSize: 14, height: 1.6, color: CpColors.muted)),
      const SizedBox(height: 21),
      Stack(children: [
        const CampusRouteArt(height: 204),
        Positioned(left: 12, bottom: 12,
          child: DecoratedBox(decoration: BoxDecoration(
              color: Colors.white, borderRadius: BorderRadius.circular(9)),
            child: const Padding(padding: EdgeInsets.symmetric(
              horizontal: 11, vertical: 8),
              child: Text('ILLUSTRATIVE CAMPUS ROUTE', style: TextStyle(
                fontSize: 10, fontWeight: FontWeight.w700)))),
        ),
      ]),
    ],
  );

  Widget _wideHero() => CampusPanel(
    color: const Color(0xFFF7F3E7),
    padding: const EdgeInsets.all(28),
    child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Your campus.\nMore connected.',
          style: Theme.of(context).textTheme.displaySmall?.copyWith(fontSize: 52)),
        const SizedBox(height: 23),
        const Text('Find a seat on the way, get everyday essentials, or '
          'help on a trip you are already taking.',
          style: TextStyle(fontSize: 16, color: CpColors.muted, height: 1.6)),
        const SizedBox(height: 23),
        const CampusNote(message:
          'Campus-first design preview · Availability is not live.'),
      ])),
      const SizedBox(width: 30),
      const Expanded(child: CampusRouteArt(height: 305)),
    ]),
  );

  Widget _service(IconData icon, String title, String subtitle,
      Color color, VoidCallback onTap) => Material(
    color: color,
    borderRadius: BorderRadius.circular(15),
    child: InkWell(
      onTap: onTap, borderRadius: BorderRadius.circular(15),
      child: Padding(padding: const EdgeInsets.all(16),
        child: SizedBox(
          height: 132,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              DecoratedBox(decoration: BoxDecoration(color: Colors.white,
                borderRadius: BorderRadius.circular(10)),
                child: Padding(padding: const EdgeInsets.all(8),
                  child: Icon(icon, size: 23, color: CpColors.ink))),
              const Icon(Icons.arrow_forward_rounded, size: 20),
            ]),
            const Spacer(),
            Text(title, maxLines: 2, style: const TextStyle(
              fontSize: 15, fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            Text(subtitle, maxLines: 2, style: const TextStyle(
              color: CpColors.muted, fontSize: 11, height: 1.3)),
          ]),
        )),
      ),
  );

  Widget _runnerCard() => Material(
    color: const Color(0xFFFFF9E7),
    borderRadius: BorderRadius.circular(14),
    child: InkWell(onTap: widget.onRunner,
      borderRadius: BorderRadius.circular(14),
      child: const Padding(padding: EdgeInsets.all(17), child: Row(children: [
        DecoratedBox(decoration: BoxDecoration(
          color: CpColors.yellowSoft,
          borderRadius: BorderRadius.all(Radius.circular(10))),
          child: Padding(padding: EdgeInsets.all(10),
            child: Icon(Icons.alt_route_rounded, size: 26))),
        SizedBox(width: 13),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Become a runner', style: TextStyle(
              fontWeight: FontWeight.w800, fontSize: 16)),
            SizedBox(height: 5),
            Text('Earn on trips you are already making',
              style: TextStyle(fontSize: 12, color: CpColors.muted)),
          ],
        )),
        Icon(Icons.arrow_forward_rounded, size: 20),
      ])),
    ),
  );

  Widget _step(String number, String title, String description) => CampusPanel(
    color: number == '02' ? const Color(0xFFFFF3C7) : CpColors.surface,
    padding: const EdgeInsets.all(14),
    child: Row(children: [
      DecoratedBox(decoration: BoxDecoration(color: CpColors.yellow,
        borderRadius: BorderRadius.circular(11)),
        child: SizedBox(width: 43, height: 43,
          child: Center(child: Text(number, style: const TextStyle(
            fontWeight: FontWeight.w800, fontSize: 14))))),
      const SizedBox(width: 13),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: const TextStyle(fontSize: 15,
          fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        Text(description, style: const TextStyle(fontSize: 12,
          color: CpColors.muted, height: 1.4)),
      ])),
    ]),
  );

  Widget _benefit(IconData icon, String label, String detail) => CampusPanel(
    padding: const EdgeInsets.symmetric(vertical: 15, horizontal: 5),
    child: Column(children: [
      Icon(icon, size: 23), const SizedBox(height: 11),
      Text(label, textAlign: TextAlign.center, maxLines: 1,
        style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800)),
      const SizedBox(height: 3),
      Text(detail, textAlign: TextAlign.center, maxLines: 2,
        style: const TextStyle(fontSize: 10, color: CpColors.muted)),
    ]),
  );

  Widget _buildCarousel() => SizedBox(height: 182, child: Stack(children: [
    PageView.builder(
      controller: _carousel, itemCount: _slides.length,
      onPageChanged: (value) => setState(() => _currentSlide = value),
      itemBuilder: (context, index) {
        final slide = _slides[index];
        return CampusPanel(
          color: slide.$4, padding: const EdgeInsets.all(20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(slide.$1, style: const TextStyle(color: CpColors.yellow,
              fontSize: 11, fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            Text(slide.$2, style: const TextStyle(color: Colors.white,
              fontSize: 22, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            Text(slide.$3, style: const TextStyle(color: Colors.white70,
              fontSize: 12)),
          ]),
        );
      },
    ),
    Positioned(left: 20, bottom: 14, child: Row(children: [
      for (var i = 0; i < _slides.length; i++)
        Container(margin: const EdgeInsets.only(right: 6),
          width: 7, height: 7,
          decoration: BoxDecoration(shape: BoxShape.circle,
            color: _currentSlide == i ? CpColors.yellow : Colors.white54)),
    ])),
    Positioned(right: 10, bottom: 8, child: Row(children: [
      IconButton(onPressed: () => _slide(-1),
        tooltip: 'Previous campus slide',
        icon: const Icon(Icons.chevron_left_rounded, color: Colors.white)),
      IconButton(onPressed: () => _slide(1),
        tooltip: 'Next campus slide',
        style: IconButton.styleFrom(backgroundColor: CpColors.yellow),
        icon: const Icon(Icons.chevron_right_rounded, color: CpColors.ink)),
    ])),
  ]));
}
