#!/usr/bin/env bash
#
# server-backend.sh -- builds and runs the Central Server Module's four
# backend services (identity-service, command-api, mqtt-ingestion,
# realtime-service) for local development. See README.md for what each
# service does and the full list of environment variables.
#
# Usage:
#   ./server-backend.sh [start|stop|status]   (default: start)
#
# `start` brings up Postgres + Redis via docker-compose if Docker is
# available (falling back, with a warning, to each service's own isolated
# in-process PGlite/pub-sub otherwise -- see README.md's "shared database
# across processes" note), builds the shared packages and each service, then
# launches all four as detached background processes with logs under
# ./logs and PID files under ./.pids so `stop`/`status` can manage them.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT_DIR/logs"
PID_DIR="$ROOT_DIR/.pids"
SERVICES=(identity-service command-api mqtt-ingestion realtime-service)
ACTION="${1:-start}"

mkdir -p "$LOG_DIR" "$PID_DIR"

command_exists() { command -v "$1" >/dev/null 2>&1; }

is_running() {
  local pid_file="$PID_DIR/$1.pid"
  [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

service_port() {
  case "$1" in
    identity-service) echo "${IDENTITY_PORT:-3001}" ;;
    command-api) echo "${COMMAND_API_PORT:-3000}" ;;
    realtime-service) echo "${REALTIME_PORT:-3002}" ;;
    mqtt-ingestion) echo "(mqtt on ${MQTT_PORT:-1883}, no HTTP)" ;;
  esac
}

status() {
  for svc in "${SERVICES[@]}"; do
    if is_running "$svc"; then
      echo "  [running] $svc (pid $(cat "$PID_DIR/$svc.pid")) -- $(service_port "$svc")"
    else
      echo "  [stopped] $svc"
    fi
  done
}

stop() {
  echo "==> Stopping backend services..."
  for svc in "${SERVICES[@]}"; do
    local pid_file="$PID_DIR/$svc.pid"
    if [ -f "$pid_file" ]; then
      local pid
      pid="$(cat "$pid_file")"
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        echo "    stopped $svc (pid $pid)"
      fi
      rm -f "$pid_file"
    fi
  done
}

start() {
  # ---- 1. Postgres + Redis, if Docker is available ----
  if [ -z "${DATABASE_URL:-}" ] || [ -z "${REDIS_URL:-}" ]; then
    if command_exists docker && docker compose version >/dev/null 2>&1; then
      echo "==> Starting Postgres + Redis via docker compose..."
      (cd "$ROOT_DIR" && docker compose up -d postgres redis)
      export DATABASE_URL="${DATABASE_URL:-postgres://election:election@localhost:5432/election}"
      export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
    else
      echo "==> Docker not available: each service will fall back to its own"
      echo "    isolated in-process PGlite database and in-process pub/sub."
      echo "    Services will NOT share data or realtime events with each"
      echo "    other this way -- see README.md. Install Docker and re-run"
      echo "    to fix this, or set DATABASE_URL/REDIS_URL yourself."
    fi
  fi

  export IDENTITY_JWKS_URL="${IDENTITY_JWKS_URL:-http://localhost:${IDENTITY_PORT:-3001}/.well-known/jwks.json}"
  export MQTT_PORT="${MQTT_PORT:-1883}"
  export MQTT_BROKER_URL="${MQTT_BROKER_URL:-mqtt://localhost:${MQTT_PORT}}"
  export MQTT_SERVICE_USERNAME="${MQTT_SERVICE_USERNAME:-command-api}"
  export MQTT_SERVICE_PASSWORD="${MQTT_SERVICE_PASSWORD:-}"
  export INTERNAL_SHARED_SECRET="${INTERNAL_SHARED_SECRET:-}"

  # ---- 2. Build the shared packages (services resolve them via dist/) ----
  echo "==> Building shared packages..."
  for p in auth db mqtt-broker pubsub queue shared-types; do
    npm run build --workspace="packages/$p" --silent
  done

  # ---- 3. Build and launch each service, directly invoking node (not
  #         `npm start`) so the captured PID is the real process, not an
  #         npm wrapper -- that's what makes `stop` reliable. ----
  for svc in "${SERVICES[@]}"; do
    if is_running "$svc"; then
      echo "==> $svc is already running (pid $(cat "$PID_DIR/$svc.pid")) -- skipping"
      continue
    fi

    echo "==> Building $svc..."
    npm run build --workspace="services/$svc" --silent

    echo "==> Starting $svc..."
    (
      cd "$ROOT_DIR/services/$svc"
      case "$svc" in
        identity-service) export PORT="${IDENTITY_PORT:-3001}" ;;
        command-api) export PORT="${COMMAND_API_PORT:-3000}" ;;
        realtime-service) export PORT="${REALTIME_PORT:-3002}" ;;
      esac
      exec node dist/main.js
    ) >"$LOG_DIR/$svc.log" 2>&1 &
    echo $! >"$PID_DIR/$svc.pid"
  done

  sleep 1
  echo
  echo "==> Backend services started:"
  status
  echo
  echo "Logs: $LOG_DIR/*.log"
  echo "Stop with: ./server-backend.sh stop"
}

case "$ACTION" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *)
    echo "Usage: $0 [start|stop|status]"
    exit 1
    ;;
esac
