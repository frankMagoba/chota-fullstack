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

Needs Docker, Node 20+ and Flutter 3.35+.

```bash
make demo        # one command: DB + API + truck simulator + Flutter in Chrome
# WITH_WEB=1 make demo   # also starts the ops dashboard on :3001
make stop        # stop API / simulator / web (leaves Docker DB running)
```

Or split across terminals:

```bash
make api         # Postgres + Redis in Docker, then migrate, seed and run the API on :4000
make simulate    # second terminal: trucks drive around Lang'ata/Karen
make app         # third terminal: the Flutter app in Chrome (needs the API up)
make web         # optional: ops dashboard on :3001
```

Sign in on the app with the prefilled demo number (`+254711000001`). The ops dashboard uses `+254700000001`. OTP is stubbed for the demo. If login fails with a connection error, the API is not running — use `make demo` or start `make api` first. `make up-docker` runs the API in a container instead.

If ports 5432 or 6379 are taken by a local Postgres or Redis, use `PG_PORT=5433 REDIS_PORT=6380 make db` and set `DATABASE_URL`/`REDIS_URL` in `backend/.env` to match.

## Running on an 8 GB M1

The default commands are already the lean path. In numbers:

- Postgres runs a multi-arch PostGIS image (native arm64) with `shared_buffers=128MB`, capped at 512 MB. Redis is capped at 128 MB with persistence off.
- Running the API with node directly takes about 80 MB, less than a third container would.
- By default the simulator moves 6 trucks every 3 seconds.
- Run the Flutter app once, in Chrome or as a macOS window. Skip the Android emulator and iOS simulator if you can; each one costs 2 GB or more.
- Leave the Next.js dashboard off unless you're showing it.

Lean start:

```bash
make demo
```

Close Docker Desktop's other containers first, and set Docker Desktop's memory limit to 2 GB (Settings > Resources). That's plenty for this stack.

### Tests

```bash
make test              # lint, typecheck, unit and concurrency tests against real Postgres/Redis
make race              # 25 simultaneous bookings against the running API
cd mobile && flutter analyze && flutter test
```

### Running the app on a phone

Android emulator: `flutter run` (it uses `10.0.2.2:4000`). Real device on the same Wi-Fi: `flutter run --dart-define=API_URL=http://<your-laptop-ip>:4000`.

### Useful endpoints

`GET /health` is liveness and `GET /ready` checks Postgres and Redis. `GET /metrics` serves Prometheus metrics: a latency histogram, error counts, uptime, bookings by outcome, dispatch time and open sockets. The WebSocket lives at `/ws?token=...`.

Config lives in `backend/.env.example`. No secrets are committed.
