# QuantumShield Development Server Launcher (PowerShell)
# Starts FastAPI backend (port 8001) and Vite frontend (port 5173)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  QuantumShield - Hybrid Post-Quantum Messaging Platform   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$BackendDir = Join-Path $ProjectRoot "backend"
$FrontendDir = Join-Path $ProjectRoot "frontend"

# Check if Backend is already running on 8001
$BackendListening = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue
if ($BackendListening) {
    Write-Host "`n[1/2] Backend is ALREADY running on http://localhost:8001" -ForegroundColor Yellow
} else {
    Write-Host "`n[1/2] Starting FastAPI Backend on http://localhost:8001..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$BackendDir'; uvicorn app.main:app --reload --host 0.0.0.0 --port 8001"
}

# Check if Frontend is already running on 5173
$FrontendListening = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
if ($FrontendListening) {
    Write-Host "[2/2] Frontend is ALREADY running on http://localhost:5173" -ForegroundColor Yellow
} else {
    Write-Host "[2/2] Starting Vite Frontend on http://localhost:5173..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$FrontendDir'; npm run dev"
}

Write-Host "`nQuantumShield is active and ready:" -ForegroundColor Cyan
Write-Host "  👉 Frontend Web App:  http://localhost:5173" -ForegroundColor Green
Write-Host "  👉 Backend API Docs:  http://localhost:8001/docs" -ForegroundColor White
Write-Host "  👉 Backend Health:    http://localhost:8001/health" -ForegroundColor White
