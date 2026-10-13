import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/api.dart';
import 'core/app_state.dart';
import 'core/theme.dart';
import 'screens/home_map_screen.dart';
import 'screens/sign_in_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(ChangeNotifierProvider(create: (_) => AppState(Api()), child: const ChotaApp()));
}

class ChotaApp extends StatelessWidget {
  const ChotaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(title: 'Chota', debugShowCheckedModeBanner: false, theme: chotaTheme(), home: const _Gate());
  }
}

/// Splash while we try the saved token, then home or sign-in.
class _Gate extends StatefulWidget {
  const _Gate();
  @override
  State<_Gate> createState() => _GateState();
}

class _GateState extends State<_Gate> {
  late final Future<void> _restore = context.read<AppState>().restore();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder(
      future: _restore,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Scaffold(
            body: Center(child: Image(image: AssetImage('assets/images/splash.png'), width: 160)),
          );
        }
        return Consumer<AppState>(
          builder: (context, s, _) => s.signedIn ? const HomeMapScreen() : const SignInScreen(),
        );
      },
    );
  }
}
