import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

import 'config.dart';
import 'models.dart';

class ApiException implements Exception {
  ApiException(this.status, this.code, this.message);
  final int status;
  final String code;
  final String message;
  @override
  String toString() => message;
}

class Api {
  Api({http.Client? client}) : _http = client ?? http.Client();
  final http.Client _http;
  String? token;

  Map<String, String> get _headers => {
    'content-type': 'application/json',
    if (token != null) 'authorization': 'Bearer $token',
  };

  Future<Map<String, dynamic>> _send(String method, String path, {Object? body, Map<String, String>? headers}) async {
    final req = http.Request(method, Uri.parse('${AppConfig.apiUrl}$path'))..headers.addAll({..._headers, ...?headers});
    if (body != null) req.body = jsonEncode(body);
    final res = await http.Response.fromStream(await _http.send(req).timeout(const Duration(seconds: 15)));
    final data = res.body.isEmpty ? <String, dynamic>{} : jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) {
      throw ApiException(
        res.statusCode,
        data['error'] as String? ?? 'ERROR',
        data['message'] as String? ?? 'Request failed',
      );
    }
    return data;
  }

  Future<Map<String, dynamic>> login(String phone, String name, String? inviteCode) => _send(
    'POST',
    '/auth/login',
    body: {'phone': phone, 'name': name, if (inviteCode != null && inviteCode.isNotEmpty) 'inviteCode': inviteCode},
  );

  Future<(UserProfile, Assignments)> me() async {
    final d = await _send('GET', '/me');
    return (
      UserProfile.fromJson(d['user'] as Map<String, dynamic>),
      Assignments.fromJson(d['assignments'] as Map<String, dynamic>),
    );
  }

  Future<void> redeemInvite(String code) => _send('POST', '/me/invite', body: {'code': code});

  Future<List<NearbyTruck>> nearby(ServiceType s, LatLng at) async {
    final d = await _send('GET', '/drivers/nearby?service=${s.api}&lat=${at.latitude}&lng=${at.longitude}');
    return (d['drivers'] as List)
        .cast<Map<String, dynamic>>()
        .map(
          (j) => NearbyTruck(
            id: j['driverId'] as String,
            position: LatLng((j['lat'] as num).toDouble(), (j['lng'] as num).toDouble()),
            etaMinutes: j['etaMinutes'] as int?,
          ),
        )
        .toList();
  }

  /// [idempotencyKey] is generated once per "Request" tap and reused on retry,
  /// so a flaky network can't create two bookings.
  Future<Booking> createBooking({
    required ServiceType service,
    required int litres,
    required LatLng at,
    required String address,
    required String idempotencyKey,
  }) async {
    final d = await _send(
      'POST',
      '/bookings',
      headers: {'idempotency-key': idempotencyKey},
      body: {
        'service': service.api,
        'quantityLitres': litres,
        'lat': at.latitude,
        'lng': at.longitude,
        'address': address,
      },
    );
    return Booking.fromJson(d['booking'] as Map<String, dynamic>);
  }

  Future<Booking> booking(String id) async =>
      Booking.fromJson((await _send('GET', '/bookings/$id'))['booking'] as Map<String, dynamic>);

  Future<List<Booking>> myBookings() async => ((await _send('GET', '/bookings'))['bookings'] as List)
      .cast<Map<String, dynamic>>()
      .map(Booking.fromJson)
      .toList();

  Future<Booking> cancel(String id) async =>
      Booking.fromJson((await _send('POST', '/bookings/$id/cancel'))['booking'] as Map<String, dynamic>);

  Future<void> rate(String id, int stars, String? comment) => _send(
    'POST',
    '/bookings/$id/rating',
    body: {'stars': stars, if (comment != null && comment.isNotEmpty) 'comment': comment},
  );

  Future<String> statusMessage(String id, {String lang = 'en'}) async =>
      (await _send('GET', '/bookings/$id/message?lang=$lang'))['text'] as String;

  Future<List<Map<String, dynamic>>> referrals() async =>
      ((await _send('GET', '/referrals/me'))['referrals'] as List).cast<Map<String, dynamic>>();

  /// Fire-and-forget product analytics. Never let tracking break a screen.
  Future<void> track(String name, [Map<String, Object?> props = const {}]) async {
    try {
      await _send('POST', '/events', body: {'name': name, 'props': props});
    } catch (_) {}
  }
}
