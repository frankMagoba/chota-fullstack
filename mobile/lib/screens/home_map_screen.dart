import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../core/app_state.dart';
import '../core/models.dart';
import '../core/theme.dart';
import '../widgets/map_bits.dart';
import 'invite_screen.dart';
import 'orders_screen.dart';
import 'quantity_screen.dart';
import 'tracking_screen.dart';

/// Home: map with your location and live trucks for the chosen service.
/// Rebuilt from the 2021 ChooseService screen (same layout: menu button top
/// left, white sheet asking "Which service would you like?").
class HomeMapScreen extends StatefulWidget {
  const HomeMapScreen({super.key});
  @override
  State<HomeMapScreen> createState() => _HomeMapScreenState();
}

class _HomeMapScreenState extends State<HomeMapScreen> {
  // Same default centre the 2021 app used (Lang'ata, Nairobi).
  static const _fallback = LatLng(-1.363370, 36.745024);

  final _map = MapController();
  LatLng _me = _fallback;
  LatLng _pickup = _fallback;
  ServiceType _service = ServiceType.water;
  final Map<String, NearbyTruck> _trucks = {};
  StreamSubscription<Map<String, dynamic>>? _sub;
  Booking? _active;
  bool _locating = true;

  AppState get _app => context.read<AppState>();

  @override
  void initState() {
    super.initState();
    _sub = _app.realtime?.messages.listen(_onMessage);
    _locate();
    _checkActive();
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _locate() async {
    try {
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        throw Exception('no permission');
      }
      final p = await Geolocator.getCurrentPosition().timeout(const Duration(seconds: 8));
      final here = LatLng(p.latitude, p.longitude);
      // Demo trucks are seeded in Nairobi. If we're far away, stay on Nairobi so the map isn't empty.
      if (const Distance().as(LengthUnit.Kilometer, here, _fallback) < 60) {
        _me = here;
        _pickup = here;
      }
    } catch (_) {
      // Fall back to the default centre.
    }
    if (!mounted) return;
    setState(() => _locating = false);
    _map.move(_pickup, 13);
    _loadTrucks();
  }

  Future<void> _checkActive() async {
    try {
      final list = await _app.api.myBookings();
      final active = list.where((b) => b.isActive).toList();
      if (mounted) setState(() => _active = active.isEmpty ? null : active.first);
    } catch (_) {}
  }

  Future<void> _loadTrucks() async {
    _app.realtime?.subscribe('nearby', {
      'type': 'subscribe_nearby',
      'lat': _pickup.latitude,
      'lng': _pickup.longitude,
      'service': _service.api,
    });
    try {
      final list = await _app.api.nearby(_service, _pickup);
      if (!mounted) return;
      setState(() {
        _trucks
          ..clear()
          ..addEntries(list.map((t) => MapEntry(t.id, t)));
      });
    } catch (_) {}
  }

  void _onMessage(Map<String, dynamic> m) {
    if (m['type'] != 'driver_location' && m['type'] != 'availability') return;
    if (m['service'] != _service.api) return;
    final id = m['driverId'] as String;
    setState(() {
      if (m['status'] != 'available') {
        _trucks.remove(id);
      } else if (m['lat'] != null) {
        final at = LatLng((m['lat'] as num).toDouble(), (m['lng'] as num).toDouble());
        _trucks.update(
          id,
          (t) => t..position = at,
          ifAbsent: () => NearbyTruck(id: id, position: at),
        );
      }
    });
  }

  void _pickService(ServiceType s) {
    setState(() {
      _service = s;
      _trucks.clear();
    });
    _app.api.track('service_selected', {'service': s.api});
    _loadTrucks();
  }

  Future<void> _continue() async {
    final booking = await Navigator.of(context).push<Booking>(
      MaterialPageRoute(
        builder: (_) => QuantityScreen(service: _service, pickup: _pickup),
      ),
    );
    if (booking != null && mounted) _openTracking(booking);
  }

  Future<void> _openTracking(Booking b) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => TrackingScreen(initial: b)));
    if (!mounted) return;
    _checkActive();
    _loadTrucks();
    _app.refresh();
  }

  @override
  Widget build(BuildContext context) {
    final nearest = _trucks.values
        .map((t) => const Distance().as(LengthUnit.Meter, t.position, _pickup))
        .fold<double?>(null, (a, b) => a == null || b < a ? b : a);
    final etaMin = nearest == null ? null : (3 + nearest / 1000 / 25 * 60).round();

    return Scaffold(
      drawer: _drawer(),
      body: Stack(
        children: [
          FlutterMap(
            mapController: _map,
            options: MapOptions(
              initialCenter: _pickup,
              initialZoom: 13,
              onTap: (_, at) {
                setState(() => _pickup = at);
                _loadTrucks();
              },
            ),
            children: [
              osmTiles(),
              MarkerLayer(
                markers: [
                  meMarker(_me),
                  ..._trucks.values.map((t) => truckMarker(t.position, _service)),
                  pinMarker(_pickup),
                ],
              ),
            ],
          ),
          Positioned(
            top: 0,
            left: 16,
            right: 16,
            child: SafeArea(
              child: Row(
                children: [
                  Builder(
                    builder: (c) => RoundIconButton(icon: Icons.menu, onPressed: () => Scaffold.of(c).openDrawer()),
                  ),
                  const Spacer(),
                  RoundIconButton(
                    icon: Icons.my_location,
                    onPressed: () {
                      setState(() => _pickup = _me);
                      _map.move(_me, 15);
                      _loadTrucks();
                    },
                  ),
                ],
              ),
            ),
          ),
          if (_active != null)
            Positioned(
              top: 70,
              left: 16,
              right: 16,
              child: SafeArea(
                child: Material(
                  color: ChotaColors.ink,
                  borderRadius: BorderRadius.circular(12),
                  child: ListTile(
                    textColor: Colors.white,
                    iconColor: Colors.white,
                    leading: const Icon(Icons.local_shipping),
                    title: Text('${_active!.service.label}: ${_active!.statusLabel}'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => _openTracking(_active!),
                  ),
                ),
              ),
            ),
          Align(alignment: Alignment.bottomCenter, child: _sheet(etaMin)),
        ],
      ),
    );
  }

  Widget _sheet(int? etaMin) {
    return BottomSheetCard(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('Which service would you like?', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600)),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: ServiceType.values.map(_serviceButton).toList(),
          ),
          const SizedBox(height: 12),
          Text(
            _locating
                ? 'Finding your location...'
                : _trucks.isEmpty
                ? 'No ${_service.label.toLowerCase()} trucks free near the pin right now'
                : '${_trucks.length} trucks nearby, closest about $etaMin min away',
            style: const TextStyle(color: Colors.black54),
          ),
          const SizedBox(height: 4),
          const Text('Tap the map to move the delivery pin', style: TextStyle(color: Colors.black38, fontSize: 12)),
          const SizedBox(height: 16),
          FilledButton(onPressed: _locating ? null : _continue, child: Text('Order ${_service.label.toLowerCase()}')),
        ],
      ),
    );
  }

  Widget _serviceButton(ServiceType s) {
    final selected = s == _service;
    return GestureDetector(
      onTap: () => _pickService(s),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(3),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: selected ? ChotaColors.ink : Colors.transparent, width: 2),
            ),
            child: CircleAvatar(
              radius: 28,
              backgroundColor: ChotaColors.chip,
              child: SvgPicture.asset(s.icon, width: 30),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            '${s.label}\nservices',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 14, fontWeight: selected ? FontWeight.w700 : FontWeight.w500),
          ),
        ],
      ),
    );
  }

  Widget _drawer() {
    final user = context.watch<AppState>().user;
    return Drawer(
      child: ListView(
        children: [
          DrawerHeader(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                const CircleAvatar(
                  radius: 26,
                  backgroundColor: ChotaColors.chip,
                  child: Icon(Icons.person, color: Colors.black),
                ),
                const SizedBox(height: 10),
                Text(user?.name ?? '', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                Text(user?.phone ?? '', style: const TextStyle(color: Colors.black54)),
              ],
            ),
          ),
          ListTile(
            leading: const Icon(Icons.receipt_long),
            title: const Text('My orders'),
            onTap: () {
              Navigator.pop(context);
              Navigator.push(context, MaterialPageRoute(builder: (_) => OrdersScreen(onOpen: _openTracking)));
            },
          ),
          ListTile(
            leading: const Icon(Icons.card_giftcard),
            title: const Text('Invite friends'),
            subtitle: user == null || user.creditKes == 0 ? null : Text('KES ${user.creditKes} credit'),
            onTap: () {
              Navigator.pop(context);
              Navigator.push(context, MaterialPageRoute(builder: (_) => const InviteScreen()));
            },
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.logout),
            title: const Text('Sign out'),
            onTap: () => context.read<AppState>().signOut(),
          ),
        ],
      ),
    );
  }
}
