#!/usr/bin/env bash
#
# server-frontend.sh -- builds and runs the campaign HQ dashboard
# (apps/command-dashboard, a Next.js app). See README.md for the full
# picture; this only runs the frontend -- start the backend with
# ./server-backend.sh first, or the dashboard has nothing to talk to.
#
# Usage:
#   ./server-frontend.sh [start|stop|status] [--prod]
#
# Default mode is the Next.js dev server (hot reload, no build step).
# Pass --prod to `start` for a production-style run (`next build` then
# `next start`) instead.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT_DIR/apps/command-dashboard"
LOG_DIR="$ROOT_DIR/logs"
PID_DIR="$ROOT_DIR/.pids"
PID_FILE="$PID_DIR/command-dashboard.pid"
LOG_FILE="$LOG_DIR/command-dashboard.log"

mkdir -p "$LOG_DIR" "$PID_DIR"

ACTION="${1:-start}"
MODE="dev"
[ "${2:-}" = "--prod" ] && MODE="prod"

export NEXT_PUBLIC_IDENTITY_URL="${NEXT_PUBLIC_IDENTITY_URL:-http://localhost:3001}"
export NEXT_PUBLIC_COMMAND_API_URL="${NEXT_PUBLIC_COMMAND_API_URL:-http://localhost:3000}"
export NEXT_PUBLIC_REALTIME_URL="${NEXT_PUBLIC_REALTIME_URL:-http://localhost:3002}"
export PORT="${PORT:-3005}"

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

status() {
  if is_running; then
    echo "  [running] command-dashboard (pid $(cat "$PID_FILE")) -- http://localhost:${PORT}"
  else
    echo "  [stopped] command-dashboard"
  fi
}

stop() {
  if is_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    kill "$pid" 2>/dev/null || true
    echo "==> Stopped command-dashboard (pid $pid)"
  else
    echo "command-dashboard is not running"
  fi
  rm -f "$PID_FILE"
}

start() {
  if is_running; then
    echo "==> command-dashboard is already running (pid $(cat "$PID_FILE"))"
    status
    exit 0
  fi

  echo "==> Installing dashboard dependencies (if needed)..."
  ( cd "$APP_DIR" && npm install --silent )

  # Directly invoke next's own CLI script via `node` (NOT `npm run dev`,
  # `npm start`, or `npx`) so the captured PID is the actual server process.
  # This matters: both `npm run dev` and `npx next` fork an extra child
  # process on this platform, so killing the PID `$!` captures leaves the
  # real Next.js server running and `stop` silently does nothing -- verified
  # the hard way while writing this script. A direct `node <next-cli.js>`
  # invocation has no such wrapper.
  # npm workspaces hoist node_modules to the repo root, not into
  # apps/command-dashboard itself, hence the $ROOT_DIR path below.
  local next_bin="$ROOT_DIR/node_modules/next/dist/bin/next"
  cd "$APP_DIR"
  if [ "$MODE" = "prod" ]; then
    echo "==> Building command-dashboard for a production-style run..."
    npm run build
    echo "==> Starting command-dashboard (production mode) on :$PORT..."
    node "$next_bin" start -p "$PORT" >"$LOG_FILE" 2>&1 &
  else
    echo "==> Starting command-dashboard (dev mode) on :$PORT..."
    node "$next_bin" dev -p "$PORT" >"$LOG_FILE" 2>&1 &
  fi
  echo $! >"$PID_FILE"
  cd "$ROOT_DIR"

  sleep 1
  echo
  echo "==> command-dashboard starting at http://localhost:${PORT}"
  echo "Log: $LOG_FILE"
  echo "Stop with: ./server-frontend.sh stop"
}

case "$ACTION" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *)
    echo "Usage: $0 [start|stop|status] [--prod]"
    exit 1
    ;;
esac
