import 'package:latlong2/latlong.dart';

enum ServiceType {
  water('water', 'Clean water', 'assets/images/truck.svg'),
  sewage('sewage', 'Exhauster', 'assets/images/exhaust.svg');

  const ServiceType(this.api, this.label, this.icon);
  final String api;
  final String label;
  final String icon;

  static ServiceType parse(String s) => s == 'sewage' ? sewage : water;
}

double _d(dynamic v) => (v as num).toDouble();
double? _dn(dynamic v) => v == null ? null : (v as num).toDouble();

class UserProfile {
  UserProfile.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      name = j['name'] as String,
      phone = j['phone'] as String,
      inviteCode = j['inviteCode'] as String,
      trustScore = _d(j['trustScore']),
      creditKes = j['creditKes'] as int,
      invitesSent = j['invitesSent'] as int,
      invitesRewarded = j['invitesRewarded'] as int;

  final String id;
  final String name;
  final String phone;
  final String inviteCode;
  final double trustScore;
  final int creditKes;
  final int invitesSent;
  final int invitesRewarded;
}

class Assignments {
  Assignments.fromJson(Map<String, dynamic> j)
    : holdout = j['holdout'] as bool,
      flags = Map<String, bool>.from(j['flags'] as Map),
      experiments = Map<String, String>.from(j['experiments'] as Map);
  Assignments.empty() : holdout = false, flags = const {}, experiments = const {};

  final bool holdout;
  final Map<String, bool> flags;
  final Map<String, String> experiments;

  bool on(String key) => flags[key] ?? false;
  String variant(String key) => experiments[key] ?? 'control';
}

class NearbyTruck {
  NearbyTruck({required this.id, required this.position, this.etaMinutes});
  final String id;
  LatLng position;
  final int? etaMinutes;
}

class Booking {
  Booking.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      status = j['status'] as String,
      service = ServiceType.parse(j['service'] as String),
      quantityLitres = j['quantityLitres'] as int,
      pickup = LatLng(_d(j['lat']), _d(j['lng'])),
      address = j['address'] as String,
      priceKes = j['priceKes'] as int,
      surge = _d(j['surge']),
      version = j['version'] as int,
      driverName = j['driverName'] as String?,
      driverPhone = j['driverPhone'] as String?,
      driverPlate = j['driverPlate'] as String?,
      driverTrust = _dn(j['driverTrust']),
      driverLocation = j['driverLat'] == null ? null : LatLng(_d(j['driverLat']), _d(j['driverLng'])),
      etaMinutes = j['etaMinutes'] as int?,
      createdAt = DateTime.parse(j['createdAt'] as String);

  final String id;
  final String status;
  final ServiceType service;
  final int quantityLitres;
  final LatLng pickup;
  final String address;
  final int priceKes;
  final double surge;
  final int version;
  final String? driverName;
  final String? driverPhone;
  final String? driverPlate;
  final double? driverTrust;
  final LatLng? driverLocation;
  final int? etaMinutes;
  final DateTime createdAt;

  bool get isActive => const ['requested', 'assigned', 'en_route', 'arrived'].contains(status);
  bool get canCancel => const ['requested', 'assigned', 'en_route', 'no_driver'].contains(status);

  String get statusLabel => switch (status) {
    'assigned' => 'Driver assigned',
    'en_route' => 'On the way',
    'arrived' => 'Arrived',
    'completed' => 'Completed',
    'cancelled' => 'Cancelled',
    'no_driver' => 'No truck available',
    _ => 'Finding a truck',
  };
}
