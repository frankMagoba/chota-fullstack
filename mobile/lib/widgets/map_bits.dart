import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../core/models.dart';
import '../core/theme.dart';

/// OpenStreetMap tiles: no API key needed for the demo. Swapping to Google
/// Maps (what the 2021 app used) is a widget change, not an architecture one.
TileLayer osmTiles() => TileLayer(
  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  userAgentPackageName: 'com.chota.chota_customer',
);

Marker truckMarker(LatLng at, ServiceType s, {bool highlight = false}) => Marker(
  point: at,
  width: highlight ? 46 : 36,
  height: highlight ? 46 : 36,
  child: Container(
    decoration: BoxDecoration(
      color: s == ServiceType.water ? ChotaColors.water : ChotaColors.sewage,
      shape: BoxShape.circle,
      border: Border.all(color: Colors.white, width: 2),
      boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 4)],
    ),
    child: const Icon(Icons.local_shipping, color: Colors.white, size: 18),
  ),
);

Marker pinMarker(LatLng at) => Marker(
  point: at,
  width: 40,
  height: 40,
  alignment: Alignment.topCenter,
  child: const Icon(Icons.location_pin, color: Colors.black, size: 40),
);

Marker meMarker(LatLng at) => Marker(
  point: at,
  width: 18,
  height: 18,
  child: Container(
    decoration: BoxDecoration(
      color: ChotaColors.water,
      shape: BoxShape.circle,
      border: Border.all(color: Colors.white, width: 3),
    ),
  ),
);

class RoundIconButton extends StatelessWidget {
  const RoundIconButton({super.key, required this.icon, required this.onPressed});
  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return CircleAvatar(
      backgroundColor: Colors.white,
      child: IconButton(
        icon: Icon(icon, color: Colors.black),
        onPressed: onPressed,
      ),
    );
  }
}
