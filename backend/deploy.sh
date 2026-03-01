#!/bin/bash
# Deployment script for Citadel (Linux/macOS)
# Usage: ./deploy.sh [--skip-build] [--force]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
PID_FILE="$SCRIPT_DIR/citadel.pid"

SKIP_BUILD=false
FORCE=false
for arg in "$@"; do
  case $arg in
    --skip-build) SKIP_BUILD=true ;;
    --force) FORCE=true ;;
  esac
done

echo "=== Citadel Deployment ==="

# ─── Stop previous Citadel process (PM2 or PID file) ─────
if command -v pm2 &>/dev/null && pm2 list 2>/dev/null | grep -q "citadel"; then
  echo "Stopping Citadel via PM2..."
  pm2 stop citadel || true
  pm2 delete citadel || true
elif [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Stopping Citadel (PID $PID)..."
    kill "$PID"
    sleep 2
    # Force-kill if still running
    kill -0 "$PID" 2>/dev/null && kill -9 "$PID" || true
  fi
  rm -f "$PID_FILE"
else
  echo "No running instance found — fresh start."
fi

# ─── Pull latest code ──────────────────────────────────────
if [ "$FORCE" = false ]; then
  echo "Pulling latest code..."
  git pull
fi

# ─── Install backend dependencies ──────────────────────────
echo "Installing backend dependencies..."
npm install --production

# ─── Build frontend ────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  FRONTEND_DIR="$SCRIPT_DIR/../web/frontend"
  if [ -f "$FRONTEND_DIR/package.json" ]; then
    echo "Building frontend..."
    cd "$FRONTEND_DIR"
    npm install
    npm run build
    cd "$SCRIPT_DIR"
  fi
else
  echo "Skipping frontend build (--skip-build)"
fi

# ─── Start server ──────────────────────────────────────────
if command -v pm2 &>/dev/null; then
  echo "Starting Citadel with PM2..."
  pm2 start server.js --name citadel --cwd "$SCRIPT_DIR" -i 1
  pm2 save
  pm2 status citadel
else
  echo "Starting Citadel (background)..."
  nohup node server.js > "$SCRIPT_DIR/../logs/citadel.log" 2>&1 &
  echo $! > "$PID_FILE"
  echo "Citadel started (PID $(cat $PID_FILE))"
  echo "Logs: $SCRIPT_DIR/../logs/citadel.log"
fi
