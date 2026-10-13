# Chota

On-demand water delivery and exhauster (sewage) trucks for Nairobi. You see trucks near you on a map, pick a service and quantity, drop a pin, and a truck is assigned and tracked live to your gate.

This is a portfolio rebuild. I wrote the original Flutter customer app in January 2021; it was frontend only, with mocked screens. In October 2026 I modernised the app (null safety, current Flutter, live data) and built the backend, ops dashboard and docs around it. The design and the reasoning are in [docs/DESIGN.md](docs/DESIGN.md).

It's a sanitized example, safe to share on screen. There's no real customer or driver data: the names, phone numbers and trucks come from the seed script. No production config or secrets are in the repo either. Local settings go in `.env` files, which git ignores, and `.env.example` shows the keys.

| Folder | What it is |
|---|---|
| `mobile/` | Flutter customer app (Android, iOS, web) |
| `backend/` | Node.js + TypeScript (Fastify), PostgreSQL/PostGIS, Redis |
| `web/` | Next.js ops dashboard: live bookings, trucks, flags, experiments |
| `docs/` | `DESIGN.md` (technical plan), `DEMO_SCRIPT.md` (walkthrough) |

## Quick start

Needs Docker. Node 20+ for the scripts, Flutter 3.35+ for the app.

```bash
make up          # postgres, redis, API on :4000 (runs migrations + seed)
make simulate    # in a second terminal: 12 trucks drive around Lang'ata/Karen
make app         # in a third: the Flutter app in Chrome
make web         # optional: ops dashboard on :3001
```

Sign in on the app with the prefilled demo number (`+254711000001`). The ops dashboard uses `+254700000001`. OTP is stubbed for the demo.

If port 5432 is already taken by a local Postgres: `PG_PORT=5433 make up` (the API talks to Postgres inside Docker, so only the tests care; run them with `TEST_DATABASE_URL=postgres://chota:chota@localhost:5433/chota_test`).

### Tests

```bash
make up && make test   # unit tests + concurrency tests against real Postgres/Redis
make race              # 25 simultaneous bookings against the running API
cd mobile && flutter analyze && flutter test
```

### Running the app on a phone

Android emulator: `flutter run` (it uses `10.0.2.2:4000`). Real device on the same Wi-Fi: `flutter run --dart-define=API_URL=http://<your-laptop-ip>:4000`.

### Useful endpoints

`GET /health` is liveness and `GET /ready` checks Postgres and Redis. `GET /metrics` serves Prometheus metrics: a latency histogram, error counts, uptime, bookings by outcome, dispatch time and open sockets. The WebSocket lives at `/ws?token=...`.

Config lives in `backend/.env.example`. No secrets are committed.
