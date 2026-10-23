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
    kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

echo -e "\n[1/2] Starting FastAPI Backend on http://localhost:8000..."
(cd "$BACKEND_DIR" && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000) &
BACKEND_PID=$!

echo "[2/2] Starting Vite Frontend on http://localhost:5173..."
(cd "$FRONTEND_DIR" && npm run dev) &
FRONTEND_PID=$!

echo -e "\nQuantumShield is running!"
echo "  Backend API:  http://localhost:8000"
echo "  API Docs:     http://localhost:8000/docs"
echo "  Frontend Web: http://localhost:5173"
echo -e "\nPress Ctrl+C to stop both servers."

wait
