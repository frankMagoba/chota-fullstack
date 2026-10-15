#!/usr/bin/env bash
# One-command demo: Postgres + Redis, API, truck simulator, Flutter (Chrome).
# Optional: WITH_WEB=1 make demo  → also starts the ops dashboard on :3001
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RUN_DIR="$ROOT/.demo"
mkdir -p "$RUN_DIR"

# Flutter is often installed but not on PATH.
for candidate in "$HOME/development/flutter/bin" /opt/homebrew/bin "$HOME/flutter/bin"; do
  if [[ -x "$candidate/flutter" ]]; then
    export PATH="$candidate:$PATH"
    break
  fi
done

if ! command -v flutter >/dev/null 2>&1; then
  echo "Flutter not found. Install it or add it to PATH." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required (Postgres + Redis)." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Open Docker Desktop and retry." >&2
  exit 1
fi

[[ -f backend/.env ]] || cp backend/.env.example backend/.env
[[ -f web/.env ]] || cp web/.env.example web/.env

API_PID_FILE="$RUN_DIR/api.pid"
SIM_PID_FILE="$RUN_DIR/simulate.pid"
WEB_PID_FILE="$RUN_DIR/web.pid"

stop_bg() {
  for f in "$API_PID_FILE" "$SIM_PID_FILE" "$WEB_PID_FILE"; do
    if [[ -f "$f" ]]; then
      pid="$(cat "$f" 2>/dev/null || true)"
      if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
        # Kill the process group started with setsid/bash so npm children die too.
        kill "$pid" 2>/dev/null || true
        pkill -P "$pid" 2>/dev/null || true
      fi
      rm -f "$f"
    fi
  done
}

trap 'echo; echo "Stopping API / simulator…"; stop_bg' EXIT INT TERM

# Fresh start of previous demo processes we own.
stop_bg

echo "→ Postgres + Redis"
make db

echo "→ API on :4000 (migrate + seed)"
(
  cd backend
  npm install --no-audit --no-fund >/dev/null
  npm run migrate
  npm run seed
  npm run dev
) >"$RUN_DIR/api.log" 2>&1 &
echo $! >"$API_PID_FILE"

echo -n "  waiting for /ready"
for _ in $(seq 1 60); do
  if curl -sf http://127.0.0.1:4000/ready >/dev/null 2>&1; then
    echo " ok"
    break
  fi
  echo -n "."
  sleep 1
done
if ! curl -sf http://127.0.0.1:4000/ready >/dev/null 2>&1; then
  echo
  echo "API failed to become ready. Last log lines:" >&2
  tail -n 40 "$RUN_DIR/api.log" >&2 || true
  exit 1
fi

echo "→ Truck simulator (6 drivers)"
(
  cd backend
  SIM_DRIVERS="${SIM_DRIVERS:-6}" SIM_TICK_MS="${SIM_TICK_MS:-3000}" npm run simulate
) >"$RUN_DIR/simulate.log" 2>&1 &
echo $! >"$SIM_PID_FILE"

if [[ "${WITH_WEB:-0}" == "1" ]]; then
  echo "→ Ops dashboard on :3001"
  (
    cd web
    npm install --no-audit --no-fund >/dev/null
    npm run dev -- -p 3001
  ) >"$RUN_DIR/web.log" 2>&1 &
  echo $! >"$WEB_PID_FILE"
fi

echo
echo "Stack ready:"
echo "  API        http://localhost:4000"
echo "  App login  +254711000001  (OTP stubbed)"
if [[ "${WITH_WEB:-0}" == "1" ]]; then
  echo "  Ops        http://localhost:3001  (+254700000001)"
fi
echo "  Logs       $RUN_DIR/*.log"
echo "  Stop       Ctrl+C  (or: make stop)"
echo
echo "→ Flutter app in Chrome"
cd mobile
flutter pub get
exec flutter run -d chrome
