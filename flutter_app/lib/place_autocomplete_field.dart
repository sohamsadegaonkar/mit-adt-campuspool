import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'place_search.dart';
import 'theme.dart';

enum _SuggestPhase { idle, loading, results, empty, error, resolving, selected }

/// Figma-aligned suggestion panel below the destination input.
/// Min three characters, 320ms debounce, stale-result protection,
/// keyboard controls, a single selection/details billing session and
/// no persistent Google place-content cache.
class PlaceAutocompleteField extends StatefulWidget {
  const PlaceAutocompleteField({
    super.key,
    required this.controller,
    this.source,
    this.onQueryChanged,
    this.onSelected,
  });

  final TextEditingController controller;
  final PlaceSearchSource? source;
  final ValueChanged<String>? onQueryChanged;
  final ValueChanged<SelectedPlace?>? onSelected;

  @override
  State<PlaceAutocompleteField> createState() => _PlaceAutocompleteFieldState();
}

class _PlaceAutocompleteFieldState extends State<PlaceAutocompleteField> {
  late final FocusNode _focus;

  @override
  void initState() {
    super.initState();
    _focus = FocusNode(debugLabel: 'destination-search', onKeyEvent: _onKey);
  }
  Timer? _debounce;
  String? _sessionToken;
  SelectedPlace? _selected;
  List<PlaceSuggestion> _suggestions = const [];
  _SuggestPhase _phase = _SuggestPhase.idle;
  PlaceSearchFailure? _failure;
  int _generation = 0;
  int _highlighted = 0;

  String _freshToken() {
    final secure = Random.secure();
    final bytes = List<int>.generate(18, (_) => secure.nextInt(256));
    return base64UrlEncode(bytes).replaceAll('=', '');
  }

  @override
  void dispose() {
    _generation++;
    _debounce?.cancel();
    _focus.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant PlaceAutocompleteField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.source != widget.source) {
      _generation++;
      _debounce?.cancel();
      _sessionToken = null;
      _selected = null;
      _suggestions = const [];
      _phase = _SuggestPhase.idle;
    }
  }

  void _inputChanged(String value) {
    _generation++;
    _debounce?.cancel();
    _selected = null;
    widget.onSelected?.call(null);
    widget.onQueryChanged?.call(value);

    final text = value.trim();
    setState(() {
      _suggestions = const [];
      _highlighted = 0;
      _failure = null;
      _phase = _SuggestPhase.idle;
    });
    if (text.length < 3) {
      // A new session is required after clearing the field.
      if (text.isEmpty) _sessionToken = null;
      return;
    }
    if (widget.source == null) {
      setState(() {
        _phase = _SuggestPhase.error;
        _failure = PlaceSearchFailure.notConfigured;
      });
      return;
    }
    _sessionToken ??= _freshToken();
    setState(() => _phase = _SuggestPhase.loading);
    final request = _generation;
    final token = _sessionToken!;
    _debounce = Timer(const Duration(milliseconds: 320), () async {
      try {
        final results = await widget.source!.suggest(
          query: text, sessionToken: token,
        );
        if (!mounted || request != _generation) return;
        setState(() {
          _suggestions = results;
          _highlighted = 0;
          _phase = results.isEmpty ? _SuggestPhase.empty : _SuggestPhase.results;
        });
      } on PlaceSearchException catch (error) {
        if (!mounted || request != _generation) return;
        setState(() {
          _failure = error.reason;
          _phase = _SuggestPhase.error;
        });
      } catch (_) {
        if (!mounted || request != _generation) return;
        setState(() {
          _failure = PlaceSearchFailure.unavailable;
          _phase = _SuggestPhase.error;
        });
      }
    });
  }

  Future<void> _pick(PlaceSuggestion value) async {
    final source = widget.source;
    final token = _sessionToken;
    if (source == null || token == null) return;
    final request = ++_generation;
    _debounce?.cancel();
    _focus.unfocus();
    setState(() {
      _phase = _SuggestPhase.resolving;
      _suggestions = const [];
    });
    try {
      final resolved = await source.resolve(
        suggestion: value, sessionToken: token,
      );
      if (!mounted || _generation != request) return;
      _sessionToken = null; // Never reuse a concluded billing session.
      _selected = resolved;
      widget.controller.value = TextEditingValue(
        text: resolved.title,
        selection: TextSelection.collapsed(offset: resolved.title.length),
      );
      widget.onQueryChanged?.call(resolved.title);
      widget.onSelected?.call(resolved);
      setState(() => _phase = _SuggestPhase.selected);
    } on PlaceSearchException catch (error) {
      if (!mounted || request != _generation) return;
      // Do not represent an unverified prediction as a selected address.
      _sessionToken = null;
      setState(() {
        _failure = error.reason;
        _phase = _SuggestPhase.error;
      });
    } catch (_) {
      if (!mounted || request != _generation) return;
      _sessionToken = null;
      setState(() {
        _failure = PlaceSearchFailure.unavailable;
        _phase = _SuggestPhase.error;
      });
    }
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent || _phase != _SuggestPhase.results) {
      return KeyEventResult.ignored;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowDown) {
      setState(() => _highlighted = (_highlighted + 1) % _suggestions.length);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowUp) {
      setState(() => _highlighted =
          (_highlighted - 1 + _suggestions.length) % _suggestions.length);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.enter) {
      _pick(_suggestions[_highlighted]);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.escape) {
      setState(() => _phase = _SuggestPhase.idle);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        TextField(
          key: const Key('destinationField'),
          focusNode: _focus,
          controller: widget.controller,
          onChanged: _inputChanged,
          keyboardType: TextInputType.streetAddress,
          textCapitalization: TextCapitalization.words,
          textInputAction: TextInputAction.search,
          autofillHints: const [AutofillHints.fullStreetAddress],
          decoration: InputDecoration(
            hintText: 'Search destinations, e.g. Swargate',
            prefixIcon: const Icon(Icons.location_on_outlined),
            suffixIcon: widget.controller.text.isNotEmpty
                ? IconButton(
                    key: const Key('clearDestination'),
                    tooltip: 'Clear destination',
                    icon: const Icon(Icons.close, size: 19),
                    onPressed: () {
                      widget.controller.clear();
                      _inputChanged('');
                      _focus.requestFocus();
                    },
                  )
                : null,
          ),
        ),
        if (_phase == _SuggestPhase.loading ||
            _phase == _SuggestPhase.resolving)
          const Padding(
            key: Key('placeLoading'),
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Row(children: [
              SizedBox(width: 18, height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2)),
              SizedBox(width: 12),
              Text('Searching addresses…',
                  style: TextStyle(fontSize: 12, color: CpColors.muted)),
            ]),
          ),
        if (_phase == _SuggestPhase.results)
          _suggestionsBox(),
        if (_phase == _SuggestPhase.empty)
          const Padding(
            key: Key('placeEmpty'),
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Text('No matching places. Try a landmark or area.',
                style: TextStyle(fontSize: 12, color: CpColors.muted)),
          ),
        if (_phase == _SuggestPhase.error)
          _errorMessage(),
        if (_phase == _SuggestPhase.selected && _selected != null)
          Padding(
            key: const Key('placeConfirmed'),
            padding: const EdgeInsets.only(top: 10),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Icon(Icons.check_circle_outline,
                  color: CpColors.success, size: 18),
              const SizedBox(width: 8),
              Expanded(child: Text(_selected!.address,
                  style: const TextStyle(
                      color: CpColors.muted, fontSize: 12, height: 1.35))),
            ]),
          ),
      ]);
  }

  Widget _errorMessage() {
    final text = switch (_failure) {
      PlaceSearchFailure.notConfigured =>
        'Live address suggestions are not enabled in this build.',
      PlaceSearchFailure.rateLimited =>
        'Too many searches. Please try again shortly.',
      _ => 'Could not load addresses. Check your connection.',
    };
    return Padding(
      key: const Key('placeError'),
      padding: const EdgeInsets.only(top: 10),
      child: Row(children: [
        const Icon(Icons.info_outline, size: 17, color: CpColors.warning),
        const SizedBox(width: 8),
        Expanded(child: Text(text, style: const TextStyle(
            color: CpColors.warning, fontSize: 12))),
        if (_failure != PlaceSearchFailure.notConfigured)
          TextButton(
            onPressed: () => _inputChanged(widget.controller.text),
            child: const Text('Retry'),
          ),
      ]),
    );
  }

  Widget _suggestionsBox() => Material(
    key: const Key('placeSuggestions'),
    elevation: 6,
    shadowColor: Colors.black26,
    color: Colors.white,
    borderRadius: BorderRadius.circular(13),
    child: Column(mainAxisSize: MainAxisSize.min, children: [
      for (var i = 0; i < _suggestions.length; i++) ...[
        if (i > 0) const Divider(height: 1),
        InkWell(
          key: ValueKey('placeSuggestion_$i'),
          borderRadius: BorderRadius.circular(8),
          onTap: () => _pick(_suggestions[i]),
          child: Semantics(
            button: true,
            label: '${_suggestions[i].title}, ${_suggestions[i].subtitle}',
            child: Container(
              color: i == _highlighted
                  ? const Color(0xFFFFF8DF) : Colors.transparent,
              padding: const EdgeInsets.symmetric(
                  horizontal: 13, vertical: 11),
              child: Row(children: [
                const Icon(Icons.place_outlined, size: 22,
                    color: CpColors.ink),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(_suggestions[i].title,
                          maxLines: 1, overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 14, fontWeight: FontWeight.w700)),
                      if (_suggestions[i].subtitle.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(_suggestions[i].subtitle,
                            maxLines: 2, overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                color: CpColors.muted, fontSize: 11)),
                      ],
                    ],
                  ),
                ),
                const Icon(Icons.north_west_rounded,
                    size: 17, color: CpColors.muted),
              ]),
            ),
          ),
        ),
      ],
      const Divider(height: 1),
      // Official Google attribution is required if predictions are displayed
      // outside a Google Map. Replace this hosted logo with an approved local
      // official attribution asset during platform packaging review.
      Align(
        alignment: Alignment.centerRight,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(10, 7, 12, 8),
          child: Image.network(
            'https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png',
            height: 16,
            fit: BoxFit.contain,
            errorBuilder: (_, __, ___) => const Text(
              'Powered by Google',
              style: TextStyle(fontSize: 11, color: CpColors.muted),
            ),
          ),
        ),
      ),
    ]),
  );
}
