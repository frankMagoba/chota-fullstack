#!/usr/bin/env bash
# Stop background demo processes started by scripts/start-demo.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$ROOT/.demo"

stop_pidfile() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  local pid
  pid="$(cat "$f" 2>/dev/null || true)"
  if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    pkill -P "$pid" 2>/dev/null || true
    sleep 0.3
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$f"
}

stop_pidfile "$RUN_DIR/api.pid"
stop_pidfile "$RUN_DIR/simulate.pid"
stop_pidfile "$RUN_DIR/web.pid"

# Also clear stray demo listeners if pid files were lost.
for port in 4000 3001; do
  pids="$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    # Only kill node/tsx listeners that look like this project.
    for pid in $pids; do
      cmd="$(ps -p "$pid" -o args= 2>/dev/null || true)"
      if echo "$cmd" | grep -Eq 'tsx|next|chota|server\.ts'; then
        kill "$pid" 2>/dev/null || true
      fi
    done
  fi
done

echo "Demo processes stopped. Docker Postgres/Redis left running (make down to stop them)."
