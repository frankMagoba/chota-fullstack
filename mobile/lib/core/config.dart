import 'package:flutter/foundation.dart';

/// API base URL. Override with:
///   flutter run --dart-define=API_URL=http://192.168.1.20:4000
/// Android emulators reach the host machine on 10.0.2.2.
class AppConfig {
  static const _fromEnv = String.fromEnvironment('API_URL');

  static String get apiUrl {
    if (_fromEnv.isNotEmpty) return _fromEnv;
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      return 'http://10.0.2.2:4000';
    }
    return 'http://localhost:4000';
  }

  static String get wsUrl => apiUrl.replaceFirst(RegExp('^http'), 'ws');
}
