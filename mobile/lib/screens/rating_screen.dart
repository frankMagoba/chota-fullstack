import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/app_state.dart';
import '../core/models.dart';

/// Ratings feed the driver's trust score (see backend services/trust.ts).
class RatingScreen extends StatefulWidget {
  const RatingScreen({super.key, required this.booking});
  final Booking booking;
  @override
  State<RatingScreen> createState() => _RatingScreenState();
}

class _RatingScreenState extends State<RatingScreen> {
  int _stars = 0;
  final _comment = TextEditingController();
  bool _busy = false;

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      await context.read<AppState>().api.rate(widget.booking.id, _stars, _comment.text.trim());
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Job done')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            'How was ${widget.booking.driverName ?? 'your driver'}?',
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(
              5,
              (i) => IconButton(
                iconSize: 44,
                icon: Icon(i < _stars ? Icons.star_rounded : Icons.star_outline_rounded, color: Colors.amber[700]),
                onPressed: () => setState(() => _stars = i + 1),
              ),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _comment,
            maxLines: 3,
            decoration: const InputDecoration(hintText: 'Anything we should know? (optional)'),
          ),
          const SizedBox(height: 24),
          FilledButton(onPressed: _stars == 0 || _busy ? null : _submit, child: const Text('Submit rating')),
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Skip')),
        ],
      ),
    );
  }
}
