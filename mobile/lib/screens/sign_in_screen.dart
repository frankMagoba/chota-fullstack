import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/app_state.dart';

/// The 2021 app had phone + SMS OTP. OTP is stubbed in this rebuild (the
/// backend accepts the phone number directly); the invite code field is new.
class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key});
  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final _phone = TextEditingController(text: '+254711000001');
  final _name = TextEditingController(text: 'Franklin');
  final _invite = TextEditingController();
  bool _showInvite = false;
  bool _busy = false;
  String? _error;

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<AppState>().signIn(_phone.text.trim(), _name.text.trim(), _invite.text.trim());
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const SizedBox(height: 16),
            Image.asset('assets/images/welcome.png', height: 220),
            const SizedBox(height: 24),
            const Text(
              'Water and exhauster trucks, on demand',
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700, height: 1.2),
            ),
            const SizedBox(height: 8),
            const Text(
              'See trucks near you, book one, and track it to your gate.',
              style: TextStyle(fontSize: 15, color: Colors.black54),
            ),
            const SizedBox(height: 24),
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Phone number'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _name,
              decoration: const InputDecoration(labelText: 'Your name'),
            ),
            const SizedBox(height: 12),
            if (_showInvite)
              TextField(
                controller: _invite,
                textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(labelText: 'Invite code (optional)', hintText: 'e.g. CHDEMO21'),
              )
            else
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: () => setState(() => _showInvite = true),
                  child: const Text('Have an invite code?'),
                ),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(_error!, style: const TextStyle(color: Colors.red)),
              ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Continue'),
            ),
          ],
        ),
      ),
    );
  }
}
