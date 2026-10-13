# Chota customer app

Flutter app for ordering water and exhauster trucks. Rebuilt from my 2021 app on Flutter 3.35 with null safety, live data and the original look.

```bash
flutter pub get
flutter run -d chrome                                    # API on localhost:4000
flutter run --dart-define=API_URL=http://192.168.1.20:4000   # real phone on the same Wi-Fi
flutter analyze && flutter test
```

Maps use OpenStreetMap tiles, so no API key is needed. Code layout: `lib/core` (API client, WebSocket client, state, models, theme), `lib/screens`, `lib/widgets`.
