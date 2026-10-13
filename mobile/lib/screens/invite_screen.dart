import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../core/app_state.dart';
import '../core/theme.dart';

/// Invite-driven growth: share your code, or enter a friend's before your
/// first order. Rewards pay out on the friend's first *completed* order.
class InviteScreen extends StatefulWidget {
  const InviteScreen({super.key});
  @override
  State<InviteScreen> createState() => _InviteScreenState();
}

class _InviteScreenState extends State<InviteScreen> {
  final _code = TextEditingController();
  List<Map<String, dynamic>> _referrals = [];
  String? _note;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final app = context.read<AppState>();
    try {
      final r = await app.api.referrals();
      await app.refresh();
      if (mounted) setState(() => _referrals = r);
    } catch (_) {}
  }

  Future<void> _share(String code) async {
    final app = context.read<AppState>();
    app.api.track('invite_shared', {'channel': 'system_share'});
    final text =
        'I order water and exhauster trucks on Chota. Use my code $code on sign-up '
        'and we both get KES 200 off after your first delivery.';
    try {
      await SharePlus.instance.share(ShareParams(text: text));
    } catch (_) {
      await Clipboard.setData(ClipboardData(text: text));
      if (mounted) setState(() => _note = 'Invite copied to clipboard');
    }
  }

  Future<void> _redeem() async {
    final app = context.read<AppState>();
    try {
      await app.api.redeemInvite(_code.text.trim());
      setState(() => _note = 'Code applied. You both get KES 200 after your first completed order.');
      await app.refresh();
    } catch (e) {
      setState(() => _note = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final user = app.user!;
    final rewardsOn = app.assignments.on('referral_rewards');
    return Scaffold(
      appBar: AppBar(title: const Text('Invite friends')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            rewardsOn ? 'Give KES 200, get KES 200' : 'Invite your neighbours',
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          Text(
            rewardsOn
                ? 'Your friend signs up with your code. When their first delivery is completed, you both get KES 200 credit.'
                : 'Share your code so friends can find trucks near them.',
            style: const TextStyle(color: Colors.black54),
          ),
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.symmetric(vertical: 20),
            decoration: BoxDecoration(color: ChotaColors.chip, borderRadius: BorderRadius.circular(12)),
            child: Column(
              children: [
                const Text('Your code', style: TextStyle(color: Colors.black54)),
                SelectableText(
                  user.inviteCode,
                  style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w700, letterSpacing: 3),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: () => _share(user.inviteCode),
            icon: const Icon(Icons.share),
            label: const Text('Share invite'),
          ),
          const SizedBox(height: 8),
          Text('Credit: KES ${user.creditKes}  ·  ${user.invitesSent} invited  ·  ${user.invitesRewarded} rewarded'),
          const Divider(height: 40),
          const Text('Got a code from a friend?', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _code,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(hintText: 'Invite code'),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton(onPressed: _redeem, child: const Text('Apply')),
            ],
          ),
          if (_note != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_note!)),
          if (_referrals.isNotEmpty) ...[
            const Divider(height: 40),
            const Text('Your invites', style: TextStyle(fontWeight: FontWeight.w600)),
            ..._referrals.map(
              (r) => ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(r['name'] as String),
                trailing: Text(r['status'] == 'rewarded' ? '+KES ${r['rewardKes']}' : 'Waiting for first order'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
