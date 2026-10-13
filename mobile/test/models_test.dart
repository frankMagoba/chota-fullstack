import 'package:chota_customer/core/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Booking parses the API shape', () {
    final b = Booking.fromJson({
      'id': 'b1',
      'status': 'en_route',
      'service': 'sewage',
      'quantityLitres': 10000,
      'lat': -1.36,
      'lng': 36.75,
      'address': 'Langata',
      'priceKes': 7500,
      'surge': 1.25,
      'version': 2,
      'driverName': 'Juma',
      'driverLat': -1.35,
      'driverLng': 36.76,
      'driverTrust': 81.5,
      'createdAt': '2026-10-13T19:00:00Z',
    });
    expect(b.service, ServiceType.sewage);
    expect(b.statusLabel, 'On the way');
    expect(b.isActive, isTrue);
    expect(b.driverLocation!.latitude, -1.35);
  });

  test('holdout users see control', () {
    final a = Assignments.fromJson({'holdout': true, 'flags': {}, 'experiments': {}});
    expect(a.variant('request_button_copy'), 'control');
    expect(a.on('surge_pricing'), isFalse);
  });
}
