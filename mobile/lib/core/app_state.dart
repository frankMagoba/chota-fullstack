import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'models.dart';
import 'realtime.dart';

class AppState extends ChangeNotifier {
  AppState(this.api);
  final Api api;

  UserProfile? user;
  Assignments assignments = Assignments.empty();
  Realtime? realtime;

  bool get signedIn => user != null;

  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('token');
    if (token == null) return;
    api.token = token;
    try {
      await refresh();
      _startRealtime(token);
    } catch (_) {
      api.token = null;
      await prefs.remove('token');
    }
  }

  Future<void> signIn(String phone, String name, String? invite) async {
    final d = await api.login(phone, name, invite);
    final token = d['token'] as String;
    api.token = token;
    (await SharedPreferences.getInstance()).setString('token', token);
    await refresh();
    _startRealtime(token);
    api.track('app_opened', {'firstSession': d['created']});
  }

  Future<void> refresh() async {
    final (u, a) = await api.me();
    user = u;
    assignments = a;
    notifyListeners();
  }

  Future<void> signOut() async {
    realtime?.close();
    realtime = null;
    user = null;
    api.token = null;
    (await SharedPreferences.getInstance()).remove('token');
    notifyListeners();
  }

  void _startRealtime(String token) {
    realtime?.close();
    realtime = Realtime(token)..connect();
  }
}
