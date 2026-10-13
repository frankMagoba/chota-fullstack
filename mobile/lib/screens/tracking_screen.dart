import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../core/app_state.dart';
import '../core/models.dart';
import '../core/theme.dart';
import '../widgets/map_bits.dart';
import 'rating_screen.dart';

/// Live booking status and driver position over the WebSocket.
/// Replaces the 2021 OrderStatus screen, which was static.
class TrackingScreen extends StatefulWidget {
  const TrackingScreen({super.key, required this.initial});
  final Booking initial;

  @override
  State<TrackingScreen> createState() => _TrackingScreenState();
}

class _TrackingScreenState extends State<TrackingScreen> {
  late Booking _b = widget.initial;
  LatLng? _driver;
  int? _eta;
  String? _message;
  StreamSubscription<Map<String, dynamic>>? _sub;
  final _map = MapController();

  AppState get _app => context.read<AppState>();

  @override
  void initState() {
    super.initState();
    _driver = _b.driverLocation;
    _sub = _app.realtime?.messages.listen(_onMessage);
    _app.realtime?.subscribe('booking', {'type': 'subscribe_booking', 'bookingId': _b.id});
    // Catch up on anything we missed before the socket subscription landed.
    _app.api
        .booking(_b.id)
        .then((b) {
          if (mounted) _apply(b);
        })
        .catchError((Object _) {});
    _loadMessage();
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  void _onMessage(Map<String, dynamic> m) {
    if (m['bookingId'] != _b.id) return;
    if (m['type'] == 'driver_location') {
      final at = LatLng((m['lat'] as num).toDouble(), (m['lng'] as num).toDouble());
      // Same rough ETA rule as the backend (lib/geo.ts): 25 km/h plus 3 minutes.
      final km = const Distance().as(LengthUnit.Meter, at, _b.pickup) / 1000;
      setState(() {
        _driver = at;
        if (_b.status == 'en_route' || _b.status == 'assigned') _eta = (3 + km / 25 * 60).round();
      });
    } else if (m['type'] == 'booking') {
      _apply(Booking.fromJson(m['booking'] as Map<String, dynamic>));
    }
  }

  void _apply(Booking b) {
    // Ignore out-of-order updates: version only goes up.
    if (b.version < _b.version) return;
    final changed = b.status != _b.status;
    setState(() {
      _b = b;
      _driver = b.driverLocation ?? _driver;
      _eta = b.etaMinutes ?? _eta;
    });
    if (changed) {
      _loadMessage();
      if (b.status == 'completed') _rate();
    }
  }

  Future<void> _loadMessage() async {
    try {
      final text = await _app.api.statusMessage(_b.id);
      if (mounted) setState(() => _message = text);
    } catch (_) {}
  }

  Future<void> _rate() async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => RatingScreen(booking: _b)));
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _cancel() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Cancel this order?'),
        content: const Text('Cancelling after a driver is assigned counts against your reliability score.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('No')),
          TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Yes, cancel')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      _apply(await _app.api.cancel(_b.id));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final showTrust = context.watch<AppState>().assignments.on('trust_badge');
    return Scaffold(
      body: Stack(
        children: [
          FlutterMap(
            mapController: _map,
            options: MapOptions(initialCenter: _b.pickup, initialZoom: 14),
            children: [
              osmTiles(),
              if (_driver != null)
                PolylineLayer(
                  polylines: [
                    Polyline(
                      points: [_driver!, _b.pickup],
                      color: Colors.black54,
                      strokeWidth: 3,
                      pattern: StrokePattern.dotted(),
                    ),
                  ],
                ),
              MarkerLayer(
                markers: [
                  pinMarker(_b.pickup),
                  if (_driver != null) truckMarker(_driver!, _b.service, highlight: true),
                ],
              ),
            ],
          ),
          Positioned(
            top: 0,
            left: 16,
            child: SafeArea(
              child: RoundIconButton(icon: Icons.arrow_back, onPressed: () => Navigator.pop(context)),
            ),
          ),
          Align(alignment: Alignment.bottomCenter, child: _sheet(showTrust)),
        ],
      ),
    );
  }

  Widget _sheet(bool showTrust) {
    const steps = ['assigned', 'en_route', 'arrived', 'completed'];
    final idx = steps.indexOf(_b.status);
    return BottomSheetCard(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(_b.statusLabel, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
              ),
              if (_eta != null && _b.status != 'arrived') Text('$_eta min', style: const TextStyle(fontSize: 18)),
            ],
          ),
          if (_message != null) ...[
            const SizedBox(height: 4),
            Text(_message!, style: const TextStyle(color: Colors.black54)),
          ],
          const SizedBox(height: 12),
          if (idx >= 0)
            Row(
              children: List.generate(
                steps.length,
                (i) => Expanded(
                  child: Container(
                    height: 4,
                    margin: const EdgeInsets.symmetric(horizontal: 2),
                    color: i <= idx ? ChotaColors.ink : ChotaColors.chip,
                  ),
                ),
              ),
            ),
          if (_b.driverName != null) ...[
            const SizedBox(height: 12),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const CircleAvatar(
                backgroundColor: ChotaColors.chip,
                child: Icon(Icons.person, color: Colors.black),
              ),
              title: Text(_b.driverName!, style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text('${_b.driverPlate ?? ''}  ·  ${_b.quantityLitres ~/ 1000}k litres'),
              trailing: showTrust && _b.driverTrust != null
                  ? Chip(
                      avatar: const Icon(Icons.verified, size: 16, color: ChotaColors.ok),
                      label: Text('Trust ${_b.driverTrust!.round()}'),
                    )
                  : null,
            ),
          ],
          const SizedBox(height: 4),
          Text(
            'KES ${_b.priceKes}${_b.surge > 1 ? '  (busy-hour ${_b.surge}x)' : ''}',
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 12),
          if (_b.status == 'no_driver')
            FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Try again'))
          else if (_b.canCancel)
            OutlinedButton(
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              onPressed: _cancel,
              child: const Text('Cancel order'),
            ),
        ],
      ),
    );
  }
}
