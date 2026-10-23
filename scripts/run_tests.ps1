# QuantumShield Test Suite Runner (PowerShell)
# Runs backend pytest suite and verifies frontend build

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  QuantumShield - Test & Validation Suite                  " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$BackendDir = Join-Path $ProjectRoot "backend"
$FrontendDir = Join-Path $ProjectRoot "frontend"

Write-Host "`n[1/2] Running Backend Pytest Suite..." -ForegroundColor Yellow
Push-Location $BackendDir
python -m pytest tests/ -v --tb=short
$BackendExitCode = $LASTEXITCODE
Pop-Location

if ($BackendExitCode -ne 0) {
    Write-Host "`n[FAIL] Backend tests failed with exit code $BackendExitCode" -ForegroundColor Red
    exit 1
} else {
    Write-Host "`n[PASS] All backend unit & integration tests passed!" -ForegroundColor Green
}

Write-Host "`n[2/2] Validating Frontend Production Build..." -ForegroundColor Yellow
Push-Location $FrontendDir
npm run build
$FrontendExitCode = $LASTEXITCODE
Pop-Location

if ($FrontendExitCode -ne 0) {
    Write-Host "`n[FAIL] Frontend build failed with exit code $FrontendExitCode" -ForegroundColor Red
    exit 1
} else {
    Write-Host "`n[PASS] Frontend production bundle built cleanly!" -ForegroundColor Green
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "  All QuantumShield Test Suites Passed Successfully!      " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
