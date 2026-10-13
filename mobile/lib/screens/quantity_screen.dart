import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';

import '../core/api.dart';
import '../core/app_state.dart';
import '../core/models.dart';
import '../core/theme.dart';

/// Quantity + address, then request. From the 2021 SpecifyQuantity screen.
class QuantityScreen extends StatefulWidget {
  const QuantityScreen({super.key, required this.service, required this.pickup});
  final ServiceType service;
  final LatLng pickup;

  @override
  State<QuantityScreen> createState() => _QuantityScreenState();
}

class _QuantityScreenState extends State<QuantityScreen> {
  late final List<int> _options = widget.service == ServiceType.water
      ? const [2000, 5000, 10000, 18000]
      : const [5000, 10000, 18000];
  late int _litres = _options[1];
  final _address = TextEditingController();
  bool _busy = false;
  String? _error;

  // One key per order attempt. Reused if the request is retried, so a double
  // tap or a timeout-then-retry can't create two bookings.
  String _idempotencyKey = const Uuid().v4();

  // Mirrors backend pricing.ts for the estimate. The server's price is final.
  int get _estimate =>
      widget.service == ServiceType.water ? (500 + 0.4 * _litres).round() : (1500 + 0.6 * _litres).round();

  Future<void> _request() async {
    final app = context.read<AppState>();
    setState(() {
      _busy = true;
      _error = null;
    });
    app.api.track('booking_requested', {'service': widget.service.api, 'litres': _litres});
    try {
      final b = await app.api.createBooking(
        service: widget.service,
        litres: _litres,
        at: widget.pickup,
        address: _address.text.trim().isEmpty ? 'Pinned location' : _address.text.trim(),
        idempotencyKey: _idempotencyKey,
      );
      if (mounted) Navigator.of(context).pop(b);
    } on ApiException catch (e) {
      // A definite rejection: next attempt is a new order.
      if (e.status < 500) _idempotencyKey = const Uuid().v4();
      setState(() => _error = e.message);
    } catch (e) {
      // Network error: keep the same key so the retry is safe.
      setState(() => _error = 'Network problem. Tap again to retry; you will not be charged twice.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = context.watch<AppState>().assignments;
    // A/B test on the button copy. Holdout users always see control.
    final cta = a.variant('request_button_copy') == 'get_water_now' && widget.service == ServiceType.water
        ? 'Get water now'
        : 'Request ${widget.service == ServiceType.water ? 'truck' : 'exhauster'}';

    return Scaffold(
      appBar: AppBar(title: Text(widget.service.label)),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const Text('How much do you need?', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600)),
          const SizedBox(height: 16),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: _options
                .map(
                  (l) => ChoiceChip(
                    label: Text('${(l / 1000).toStringAsFixed(0)}k litres'),
                    selected: l == _litres,
                    showCheckmark: false,
                    selectedColor: ChotaColors.ink,
                    labelStyle: TextStyle(color: l == _litres ? Colors.white : Colors.black),
                    onSelected: (_) {
                      setState(() => _litres = l);
                      context.read<AppState>().api.track('quantity_selected', {'litres': l});
                    },
                  ),
                )
                .toList(),
          ),
          const SizedBox(height: 24),
          TextField(
            controller: _address,
            decoration: const InputDecoration(
              labelText: 'Gate / landmark',
              hintText: 'e.g. Blue gate opposite Galleria',
              prefixIcon: Icon(Icons.location_on_outlined),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Pin: ${widget.pickup.latitude.toStringAsFixed(5)}, ${widget.pickup.longitude.toStringAsFixed(5)}',
            style: const TextStyle(color: Colors.black45, fontSize: 12),
          ),
          const SizedBox(height: 24),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: ChotaColors.chip, borderRadius: BorderRadius.circular(12)),
            child: Row(
              children: [
                const Expanded(child: Text('Estimated price')),
                Text('KES $_estimate', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              ],
            ),
          ),
          if (a.on('surge_pricing'))
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text(
                'Busy hours can add up to 1.5x. You will see the final price before the truck leaves.',
                style: TextStyle(color: Colors.black54, fontSize: 12),
              ),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
            ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _busy ? null : _request,
            child: _busy
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : Text(cta),
          ),
        ],
      ),
    );
  }
}
