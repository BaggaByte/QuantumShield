#!/usr/bin/env bash
# QuantumShield Development Server Launcher (Bash)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

echo "=========================================================="
echo "  QuantumShield - Hybrid Post-Quantum Messaging Platform   "
echo "=========================================================="

cleanup() {
    echo -e "\nStopping servers..."
    [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
    [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

if lsof -Pi :8001 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo -e "\n[1/2] Backend is ALREADY running on http://localhost:8001"
else
    echo -e "\n[1/2] Starting FastAPI Backend on http://localhost:8001..."
    (cd "$BACKEND_DIR" && uvicorn app.main:app --reload --host 0.0.0.0 --port 8001) &
    BACKEND_PID=$!
fi

if lsof -Pi :5173 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "[2/2] Frontend is ALREADY running on http://localhost:5173"
else
    echo "[2/2] Starting Vite Frontend on http://localhost:5173..."
    (cd "$FRONTEND_DIR" && npm run dev) &
    FRONTEND_PID=$!
fi

echo -e "\nQuantumShield is active and ready:"
echo "  👉 Frontend Web App:  http://localhost:5173"
echo "  👉 Backend API Docs:  http://localhost:8001/docs"
echo "  👉 Backend Health:    http://localhost:8001/health"

wait
