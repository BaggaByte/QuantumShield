# QuantumShield Development Server Launcher (PowerShell)
# Starts FastAPI backend (port 8000) and Vite frontend (port 5173)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  QuantumShield - Hybrid Post-Quantum Messaging Platform   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$BackendDir = Join-Path $ProjectRoot "backend"
$FrontendDir = Join-Path $ProjectRoot "frontend"

Write-Host "`n[1/2] Starting FastAPI Backend on http://localhost:8000..." -ForegroundColor Green
$BackendProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$BackendDir'; uvicorn app.main:app --reload --host 0.0.0.0 --port 8000" -PassThru

Write-Host "[2/2] Starting Vite Frontend on http://localhost:5173..." -ForegroundColor Green
$FrontendProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$FrontendDir'; npm run dev" -PassThru

Write-Host "`nQuantumShield is running!" -ForegroundColor Cyan
Write-Host "  Backend API:  http://localhost:8000" -ForegroundColor White
Write-Host "  API Docs:     http://localhost:8000/docs" -ForegroundColor White
Write-Host "  Frontend Web: http://localhost:5173" -ForegroundColor White
Write-Host "`nPress Ctrl+C or close the terminal windows to stop." -ForegroundColor Yellow
