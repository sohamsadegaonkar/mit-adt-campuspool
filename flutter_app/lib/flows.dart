import 'package:flutter/material.dart';

import 'place_autocomplete_field.dart';
import 'place_search.dart';
import 'pricing.dart';
import 'ride_feed.dart';
import 'ride_results.dart';
import 'theme.dart';
import 'widgets.dart';

class RidePreview extends StatefulWidget {
  const RidePreview({
    super.key,
    this.source,
    this.hasVerifiedSession = false,
    this.onSignIn,
    this.placeSource,
  });

  /// Networking is opt-in and requires a verified server session.
  final RideFeedSource? source;
  final bool hasVerifiedSession;
  final VoidCallback? onSignIn;
  final PlaceSearchSource? placeSource;

  @override
  State<RidePreview> createState() => _RidePreviewState();
}

class _RidePreviewState extends State<RidePreview> {
  final TextEditingController _destination = TextEditingController();
  String _vehicle = 'All';
  String _time = 'Today';
  RideFeedController? _feedController;

  @override
  void initState() {
    super.initState();
    _installFeed();
  }

  void _installFeed() {
    if (widget.source == null) return;
    _feedController = RideFeedController(
      source: widget.source!, hasVerifiedSession: widget.hasVerifiedSession);
    if (widget.hasVerifiedSession) {
      _feedController!.refresh();
    }
  }

  @override
  void didUpdateWidget(covariant RidePreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.source != oldWidget.source) {
      _feedController?.dispose();
      _feedController = null;
      _installFeed();
    } else if (widget.hasVerifiedSession != oldWidget.hasVerifiedSession) {
      _feedController?.updateSession(verified: widget.hasVerifiedSession);
      if (widget.hasVerifiedSession) _feedController?.refresh();
    }
  }

  RideFeedSnapshot _filteredSnapshot(RideFeedSnapshot current) {
    if (current.phase != RideFeedPhase.ready) return current;
    final query = _destination.text.trim().toLowerCase();
    final rides = current.rides.where((ride) {
      return (_vehicle == 'All' || ride.vehicle == _vehicle) &&
          (query.isEmpty || ride.destination.toLowerCase().contains(query));
    }).toList(growable: false);
    return RideFeedSnapshot(
      rides.isEmpty ? RideFeedPhase.empty : RideFeedPhase.ready, rides,
    );
  }

  Widget _results() {
    final controller = _feedController;
    if (controller == null) {
      return const RideResultsPanel(
        snapshot: RideFeedSnapshot(RideFeedPhase.preview));
    }
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) => RideResultsPanel(
        snapshot: _filteredSnapshot(controller.snapshot),
        onRetry: controller.refresh,
        onSignIn: widget.onSignIn,
      ),
    );
  }

  @override
  void dispose() {
    _destination.dispose();
    _feedController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Text('RIDES / GUEST PREVIEW', style:
        TextStyle(color: CpColors.warning, fontSize: 11,
          fontWeight: FontWeight.w800)),
      const SizedBox(height: 14),
      Text('Find a ride', style: Theme.of(context).textTheme.headlineSmall),
      const SizedBox(height: 7),
      const Text('Share a journey with a student on your route.'),
      const SizedBox(height: 22),
      CampusPanel(child: Column(crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.source == null ? 'LEAVING FROM' : 'CAMPUS', style: const TextStyle(
            fontSize: 11, fontWeight: FontWeight.w700, color: CpColors.muted)),
          const SizedBox(height: 8),
          Text(widget.source == null ? 'MIT-ADT Main Gate' : 'MIT-ADT University',
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const Divider(height: 30),
          const Text('GOING TO', style: TextStyle(
            fontSize: 11, fontWeight: FontWeight.w700, color: CpColors.muted)),
          const SizedBox(height: 7),
          PlaceAutocompleteField(
            controller: _destination,
            source: widget.placeSource,
            onQueryChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 16),
          if (widget.source == null)
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final time in ['Today', 'Tomorrow'])
                ChoiceChip(label: Text(time), selected: _time == time,
                  selectedColor: CpColors.yellowSoft,
                  onSelected: (_) => setState(() => _time = time)),
            ]),
        ])),
      const SizedBox(height: 20),
      const Text('VEHICLE TYPE', style: TextStyle(
        fontSize: 11, fontWeight: FontWeight.w700, color: CpColors.muted)),
      const SizedBox(height: 9),
      Wrap(spacing: 9, runSpacing: 8, children: [
        for (final type in ['All', 'Car', 'Bike'])
          ChoiceChip(label: Text(type), selected: _vehicle == type,
            selectedColor: CpColors.yellowSoft,
            onSelected: (_) => setState(() => _vehicle = type)),
      ]),
      const SizedBox(height: 22),
      CampusNote(icon: Icons.info_outline,
        message: widget.source == null
          ? 'No live ride inventory is connected to this Flutter build. '
              'Filters are interactive previews, not a search of student trips.'
          : 'Read-only results from the authenticated server. Destination '
              'and vehicle filters apply locally. Booking is not enabled.'),
      const SizedBox(height: 28),
      _results(),
      const SizedBox(height: 30),
    ],
  );
}

class ErrandDraftFlow extends StatefulWidget {
  const ErrandDraftFlow({super.key});

  @override
  State<ErrandDraftFlow> createState() => _ErrandDraftFlowState();
}

class _ErrandDraftFlowState extends State<ErrandDraftFlow> {
  final _item = TextEditingController(text: 'One cold coffee');
  final _pickup = TextEditingController(text: 'Main Canteen');
  final _handover = TextEditingController(text: 'Hostel B gate');
  int _step = 0;
  int _tip = 0;

  CampusQuote get _quote => CampusQuote(extraTip: _tip);

  @override
  void dispose() {
    _item.dispose();
    _pickup.dispose();
    _handover.dispose();
    super.dispose();
  }

  void _next() {
    if (_step == 0 &&
      (_item.text.trim().isEmpty || _pickup.text.trim().isEmpty ||
       _handover.text.trim().isEmpty)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Complete all three fields first.')));
      return;
    }
    if (_step < 3) setState(() => _step++);
  }

  @override
  Widget build(BuildContext context) => Column(
    key: const Key('errandDraftFlow'),
    crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Text('ERRANDS / CONCEPT REQUEST', style:
        TextStyle(color: CpColors.warning, fontSize: 11,
          fontWeight: FontWeight.w800)),
      const SizedBox(height: 12),
      Text(['Request an item', 'Optional urgent tip', 'Review total',
           'Payment preview'][_step],
        style: Theme.of(context).textTheme.headlineSmall),
      const SizedBox(height: 9),
      const Text('Example order only. No request will be published.'),
      const SizedBox(height: 17),
      Row(children: [
        for (int i = 0; i < 4; i++) ...[
          Expanded(child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            height: 5,
            decoration: BoxDecoration(
              color: i <= _step ? CpColors.yellow : CpColors.border,
              borderRadius: BorderRadius.circular(4)))),
          if (i < 3) const SizedBox(width: 6),
        ],
      ]),
      const SizedBox(height: 25),
      AnimatedSwitcher(duration: MediaQuery.disableAnimationsOf(context)
          ? Duration.zero : const Duration(milliseconds: 240),
        child: switch (_step) {
          0 => _details(key: const ValueKey('details')),
          1 => _reward(key: const ValueKey('reward')),
          2 => _review(key: const ValueKey('review')),
          _ => _payment(key: const ValueKey('payment')),
        },
      ),
      const SizedBox(height: 22),
      if (_step < 3) CampusButton(
        label: ['Continue to reward', 'Review estimated total',
          'Continue to payment preview'][_step],
        onPressed: _next,
      ),
      if (_step > 0) ...[
        const SizedBox(height: 8),
        CampusButton(label: 'Go back', primary: false,
          onPressed: () => setState(() => _step--)),
      ],
      const SizedBox(height: 28),
    ],
  );

  Widget _details({Key? key}) => Column(
    key: key, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _field('ITEM AND QUANTITY', _item, 'What do you need?'),
      const SizedBox(height: 18),
      _field('PICKUP SHOP', _pickup, 'Where should it be picked up?'),
      const SizedBox(height: 18),
      _field('SHARED HANDOVER POINT', _handover, 'Public campus location'),
      const SizedBox(height: 20),
      const CampusNote(message:
        'Use public meeting points. Avoid sharing residence-room numbers. '
        'Item cost is illustrative until a shop price is verified.'),
    ],
  );

  Widget _field(String label, TextEditingController controller, String hint) =>
    Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: const TextStyle(color: CpColors.muted,
        fontSize: 11, fontWeight: FontWeight.w800)),
      const SizedBox(height: 9),
      TextField(controller: controller, onChanged: (_) => setState(() {}),
        decoration: InputDecoration(hintText: hint)),
    ]);

  Widget _reward({Key? key}) => Column(
    key: key, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      CampusPanel(color: CpColors.yellowSoft, child: Column(
        crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Row(children: [
            Icon(Icons.bolt_outlined, size: 25),
            SizedBox(width: 9),
            Text('Need it sooner?', style: TextStyle(fontSize: 18,
                fontWeight: FontWeight.w800)),
          ]),
          const SizedBox(height: 8),
          const Text('Offer an optional extra reward to nearby runners. '
            'Urgent does not guarantee delivery time.'),
          const SizedBox(height: 17),
          Wrap(spacing: 8, runSpacing: 9, children: [
            for (final amount in [0, 10, 20, 30])
              ChoiceChip(
                key: ValueKey('tip_$amount'),
                label: Text(amount == 0 ? 'No extra tip' : '+₹$amount'),
                selected: _tip == amount,
                selectedColor: CpColors.yellow,
                onSelected: (_) => setState(() => _tip = amount),
              ),
          ]),
        ])),
      const SizedBox(height: 17),
      CampusPanel(child: Row(children: [
        const Expanded(child: Text('Runner reward',
          style: TextStyle(fontWeight: FontWeight.w700))),
        Text(CampusQuote.rupees(_quote.runnerReward),
          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 22)),
      ])),
      const SizedBox(height: 12),
      const CampusNote(message:
        'The reward shown to a runner includes the base reward and any '
        'voluntary extra tip. No money will be collected in this preview.'),
    ],
  );

  Widget _review({Key? key}) => Column(
    key: key, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      CampusPanel(child: Row(children: [
        const Icon(Icons.shopping_bag_outlined, size: 33),
        const SizedBox(width: 14),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_item.text, style: const TextStyle(
                fontWeight: FontWeight.w800)),
            const SizedBox(height: 5),
            Text('${_pickup.text} → ${_handover.text}', style: const TextStyle(
                color: CpColors.muted, fontSize: 11)),
          ],
        )),
      ])),
      if (_tip > 0) ...[
        const SizedBox(height: 12),
        CampusPanel(color: CpColors.yellowSoft, child: Row(children: [
          const Icon(Icons.bolt_outlined),
          const SizedBox(width: 9),
          Expanded(child: Text('Urgent preference · +₹$_tip voluntary tip',
            style: const TextStyle(fontWeight: FontWeight.w700))),
        ])),
      ],
      const SizedBox(height: 18),
      PriceDetails(quote: _quote),
      const SizedBox(height: 14),
      const CampusNote(message:
        '₹40 item cost is an example, not a verified shop price. '
        'The final amount must be confirmed before any real charge.'),
    ],
  );

  Widget _payment({Key? key}) => Column(
    key: key, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      PriceDetails(quote: _quote),
      const SizedBox(height: 16),
      const CampusPanel(child: Row(children: [
        Icon(Icons.account_balance_wallet_outlined, size: 28),
        SizedBox(width: 13),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('UPI · preview only', style: TextStyle(
                fontWeight: FontWeight.w800)),
            SizedBox(height: 4),
            Text('Provider integration not enabled.',
                style: TextStyle(fontSize: 12)),
          ],
        )),
      ])),
      const SizedBox(height: 16),
      const CampusNote(message:
        'Payment capture, refund, runner settlement and top-ups '
        'require approved server-side provider confirmation.'),
      const SizedBox(height: 18),
      const CampusButton(label: 'Payment unavailable in preview',
        onPressed: null),
    ],
  );
}

/// Tap anywhere in the 55dp row. The total remains visible in either state.
class PriceDetails extends StatefulWidget {
  const PriceDetails({super.key, required this.quote});
  final CampusQuote quote;

  @override
  State<PriceDetails> createState() => _PriceDetailsState();
}

class _PriceDetailsState extends State<PriceDetails> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) => Column(children: [
    CampusPanel(
      color: CpColors.yellowSoft,
      child: Row(children: [
        const Expanded(child: Text('Estimated total',
          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700))),
        Text(CampusQuote.rupees(widget.quote.estimatedTotal),
          key: const Key('estimatedTotal'),
          style: const TextStyle(fontSize: 23, fontWeight: FontWeight.w800)),
      ]),
    ),
    const SizedBox(height: 10),
    Material(
      color: CpColors.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        key: const Key('priceDetailsToggle'),
        onTap: () => setState(() => _expanded = !_expanded),
        borderRadius: BorderRadius.circular(12),
        child: SizedBox(height: 57,
          child: Padding(padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(children: [
              const Expanded(child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Price details', style: TextStyle(
                    fontWeight: FontWeight.w800, fontSize: 14)),
                  Text('Item, reward and fee included',
                    style: TextStyle(color: CpColors.muted, fontSize: 11)),
                ],
              )),
              AnimatedRotation(
                turns: _expanded ? .5 : 0,
                duration: const Duration(milliseconds: 220),
                child: const Icon(Icons.keyboard_arrow_down_rounded)),
            ]),
          )),
      ),
    ),
    AnimatedSize(
      duration: MediaQuery.disableAnimationsOf(context)
        ? Duration.zero : const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
      child: _expanded
        ? Padding(padding: const EdgeInsets.only(top: 8),
            child: CampusPanel(
              color: const Color(0xFFFAFAF8),
              child: Column(children: [
                _row('Estimated item price', widget.quote.itemPrice),
                const Divider(height: 20),
                _row('Runner reward', widget.quote.baseReward),
                if (widget.quote.extraTip > 0) ...[
                  const Divider(height: 20),
                  _row('Voluntary extra tip', widget.quote.extraTip),
                ],
                const Divider(height: 20),
                _row('CampusPool service fee', widget.quote.serviceFee),
              ]),
            ))
        : const SizedBox.shrink(),
    ),
  ]);

  Widget _row(String label, int amount) => Row(children: [
    Expanded(child: Text(label,
      style: const TextStyle(color: CpColors.muted, fontSize: 13))),
    Text(CampusQuote.rupees(amount), style: const TextStyle(
        fontWeight: FontWeight.w700, fontSize: 13)),
  ]);
}

class ActivityPreview extends StatelessWidget {
  const ActivityPreview({super.key, required this.onOpenTopUp});
  final VoidCallback onOpenTopUp;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('Your activity', style: Theme.of(context).textTheme.headlineSmall),
      const SizedBox(height: 7),
      const Text('Rides, errands and receipts in one place.'),
      const SizedBox(height: 25),
      const CampusPanel(
        padding: EdgeInsets.all(28),
        child: Column(children: [
          Icon(Icons.receipt_long_outlined, size: 50, color: CpColors.muted),
          SizedBox(height: 17),
          Text('Your history starts here', style: TextStyle(
            fontWeight: FontWeight.w800, fontSize: 18)),
          SizedBox(height: 9),
          Text('Sign in to view server-backed requests. '
            'No activity is being simulated as completed.',
            textAlign: TextAlign.center),
        ]),
      ),
      const SizedBox(height: 22),
      CampusButton(label: 'Preview adding an extra tip',
        primary: false, onPressed: onOpenTopUp),
      const SizedBox(height: 13),
      const CampusNote(message:
        'A real extra tip requires an unmatched request, separate payment '
        'authorization and verified provider confirmation.'),
    ],
  );
}

class TipTopUpPreview extends StatefulWidget {
  const TipTopUpPreview({super.key});

  @override
  State<TipTopUpPreview> createState() => _TipTopUpPreviewState();
}

class _TipTopUpPreviewState extends State<TipTopUpPreview> {
  int _amount = 20;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Extra tip · demo')),
    body: SafeArea(child: Center(child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 520),
      child: ListView(padding: const EdgeInsets.all(22), children: [
        const CampusNote(message:
          'Demonstration only. There is no published request or '
          'real payment to update.'),
        const SizedBox(height: 21),
        Text('Offer an additional reward',
          style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 10),
        const Text('An optional extra reward may encourage a nearby runner '
          'to consider a request. It is not guaranteed.'),
        const SizedBox(height: 20),
        Wrap(spacing: 8, children: [
          for (final amount in [10, 20, 30])
            ChoiceChip(label: Text('+₹$amount'),
              selected: _amount == amount,
              selectedColor: CpColors.yellowSoft,
              onSelected: (_) => setState(() => _amount = amount)),
        ]),
        const SizedBox(height: 23),
        CampusPanel(color: CpColors.yellowSoft,
          child: Column(children: [
            Row(children: [
              const Expanded(child: Text('Additional payment (example)')),
              Text('₹$_amount', style: const TextStyle(
                fontSize: 24, fontWeight: FontWeight.w800)),
            ]),
            const Divider(),
            Row(children: [
              const Expanded(child: Text('Revised runner reward')),
              Text('₹${10 + _amount}', style: const TextStyle(
                fontWeight: FontWeight.w800)),
            ]),
          ])),
        const SizedBox(height: 20),
        const CampusNote(message: 'The original ₹55 estimate is separate. '
          'No new reward may take effect before a verified second payment.'),
        const SizedBox(height: 25),
        const CampusButton(label: 'Payment disabled in preview',
          onPressed: null),
      ]),
    ))),
  );
}

class ProfilePreview extends StatelessWidget {
  const ProfilePreview({
    super.key,
    required this.hasVerifiedSession,
    required this.onSignIn,
    required this.onSignOut,
    this.memberName,
  });

  final bool hasVerifiedSession;
  final String? memberName;
  final VoidCallback onSignIn;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text('Your campus profile',
          style: Theme.of(context).textTheme.headlineSmall),
      const SizedBox(height: 8),
      const Text('Identity, trust and privacy controls.'),
      const SizedBox(height: 25),
      CampusPanel(
        child: Row(children: [
          const Icon(Icons.person_outline_rounded, size: 33),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  hasVerifiedSession
                      ? (memberName ?? 'Verified campus student')
                      : 'Student account',
                  style: const TextStyle(
                      fontWeight: FontWeight.w800, fontSize: 17),
                ),
                const SizedBox(height: 5),
                Text(
                  hasVerifiedSession
                      ? 'Session confirmed by the CampusPool server.'
                      : 'Sign in with your verified campus email.',
                  style: const TextStyle(fontSize: 12),
                ),
              ],
            ),
          ),
        ]),
      ),
      const SizedBox(height: 19),
      const CampusNote(
          message: 'Private student IDs and precise locations '
              'must never be shown in public profiles.'),
      const SizedBox(height: 25),
      CampusButton(
        label: hasVerifiedSession ? 'Sign out' : 'Sign in with email code',
        onPressed: hasVerifiedSession ? onSignOut : onSignIn,
      ),
    ],
  );
}
