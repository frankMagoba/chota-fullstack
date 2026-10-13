import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/app_state.dart';
import '../core/models.dart';
import '../core/theme.dart';

class OrdersScreen extends StatelessWidget {
  const OrdersScreen({super.key, required this.onOpen});
  final Future<void> Function(Booking) onOpen;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My orders')),
      body: FutureBuilder<List<Booking>>(
        future: context.read<AppState>().api.myBookings(),
        builder: (context, snap) {
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final list = snap.data!;
          if (list.isEmpty) return const Center(child: Text('No orders yet'));
          return ListView.separated(
            itemCount: list.length,
            separatorBuilder: (_, _) => const Divider(height: 1),
            itemBuilder: (context, i) {
              final b = list[i];
              return ListTile(
                leading: CircleAvatar(
                  backgroundColor: ChotaColors.chip,
                  child: Icon(
                    Icons.local_shipping,
                    color: b.service == ServiceType.water ? ChotaColors.water : ChotaColors.sewage,
                  ),
                ),
                title: Text('${b.service.label} · ${b.quantityLitres ~/ 1000}k litres'),
                subtitle: Text('${b.statusLabel} · ${b.address}'),
                trailing: Text('KES ${b.priceKes}'),
                onTap: b.isActive
                    ? () {
                        Navigator.pop(context);
                        onOpen(b);
                      }
                    : null,
              );
            },
          );
        },
      ),
    );
  }
}
