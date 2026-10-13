import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import 'config.dart';

/// One WebSocket per signed-in session. Reconnects with backoff and replays
/// the current subscriptions after reconnecting, so screens just listen to
/// [messages] and don't care about the socket's life.
class Realtime {
  Realtime(this.token);
  final String token;

  final _out = StreamController<Map<String, dynamic>>.broadcast();
  final Map<String, Map<String, Object?>> _subs = {};
  WebSocketChannel? _ch;
  Timer? _retry;
  Timer? _ping;
  int _attempt = 0;
  bool _closed = false;

  Stream<Map<String, dynamic>> get messages => _out.stream;

  void connect() {
    if (_closed) return;
    final ch = WebSocketChannel.connect(Uri.parse('${AppConfig.wsUrl}/ws?token=$token'));
    _ch = ch;
    ch.ready.then(
      (_) {
        _attempt = 0;
        for (final s in _subs.values) {
          ch.sink.add(jsonEncode(s));
        }
        _ping?.cancel();
        _ping = Timer.periodic(const Duration(seconds: 25), (_) => ch.sink.add('{"type":"ping"}'));
      },
      onError: (Object _) {
        _scheduleReconnect();
      },
    );
    ch.stream.listen(
      (raw) => _out.add(jsonDecode(raw as String) as Map<String, dynamic>),
      onDone: _scheduleReconnect,
      onError: (Object _) => _scheduleReconnect(),
    );
  }

  void _scheduleReconnect() {
    _ping?.cancel();
    if (_closed || (_retry?.isActive ?? false)) return;
    final delay = Duration(milliseconds: (500 * (1 << _attempt.clamp(0, 5))));
    _attempt++;
    _retry = Timer(delay, connect);
  }

  void subscribe(String key, Map<String, Object?> msg) {
    _subs[key] = msg;
    _ch?.sink.add(jsonEncode(msg));
  }

  void close() {
    _closed = true;
    _retry?.cancel();
    _ping?.cancel();
    _ch?.sink.close();
    _out.close();
  }
}
