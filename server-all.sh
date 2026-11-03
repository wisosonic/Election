#!/usr/bin/env bash
#
# server-all.sh -- runs both modules together: the four Central Server
# Module backend services (server-backend.sh) and the HQ dashboard
# (server-frontend.sh). Thin wrapper -- all the real logic lives in those
# two scripts; see README.md for what each service does and every
# environment variable.
#
# Usage:
#   ./server-all.sh [start|stop|status] [--prod]
#
# `--prod` (only meaningful with `start`) is forwarded to server-frontend.sh
# for a production-style dashboard run (`next build` + `next start`) instead
# of the default dev server.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTION="${1:-start}"
FRONTEND_FLAG="${2:-}"

case "$ACTION" in
  start)
    echo "===> Starting backend..."
    "$ROOT_DIR/server-backend.sh" start
    echo
    echo "===> Starting frontend..."
    "$ROOT_DIR/server-frontend.sh" start $FRONTEND_FLAG
    echo
    echo "===> Everything started. Combined status:"
    "$ROOT_DIR/server-backend.sh" status
    "$ROOT_DIR/server-frontend.sh" status
    echo
    echo "HQ Dashboard: http://localhost:${PORT:-3005}"
    echo "Stop everything with: ./server-all.sh stop"
    ;;
  stop)
    echo "===> Stopping frontend..."
    "$ROOT_DIR/server-frontend.sh" stop
    echo
    echo "===> Stopping backend..."
    "$ROOT_DIR/server-backend.sh" stop
    ;;
  status)
    echo "Backend:"
    "$ROOT_DIR/server-backend.sh" status
    echo "Frontend:"
    "$ROOT_DIR/server-frontend.sh" status
    ;;
  *)
    echo "Usage: $0 [start|stop|status] [--prod]"
    exit 1
    ;;
esac
