#!/usr/bin/env bash
# QuantumShield Test Suite Runner (Bash)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

echo "=========================================================="
echo "  QuantumShield - Test & Validation Suite                  "
echo "=========================================================="

echo -e "\n[1/2] Running Backend Pytest Suite..."
cd "$BACKEND_DIR"
python -m pytest tests/ -v --tb=short

echo -e "\n[2/2] Validating Frontend Production Build..."
cd "$FRONTEND_DIR"
npm run build

echo -e "\n=========================================================="
echo "  All QuantumShield Test Suites Passed Successfully!      "
echo "=========================================================="
