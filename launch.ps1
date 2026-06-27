# dating-chad launcher
# Starts the backend (if not running) and opens Badoo in Chrome for Testing
# with the extension loaded. Regular Chrome 137+ blocks --load-extension, so we
# use Google's Chrome for Testing build (downloaded into .cft/).

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$cft = Join-Path $root ".cft\chrome-win64\chrome.exe"
$ext = Join-Path $root "extension"
$prof = Join-Path $root ".cft-profile"
$py = Join-Path $root ".venv\Scripts\python.exe"

# 1. Backend: start it if port 8000 isn't already serving.
$serving = $false
try { Invoke-RestMethod "http://127.0.0.1:8000/api/health" -TimeoutSec 3 | Out-Null; $serving = $true } catch {}
if (-not $serving) {
  $stuck = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
  if ($stuck) {
    Write-Host "Port 8000 stuck — restarting backend..."
    Stop-Process -Id $stuck.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
  Write-Host "Starting backend..."
  Start-Process $py -ArgumentList "-m uvicorn app.main:app --host 127.0.0.1 --port 8000" -WorkingDirectory $root -WindowStyle Minimized
  Start-Sleep -Seconds 4
} else {
  Write-Host "Backend already running."
}

# 2. Browser: Chrome for Testing with the extension loaded.
if (-not (Test-Path $cft)) {
  Write-Error "Chrome for Testing not found at $cft. Re-run the setup to download it."
  exit 1
}
New-Item -ItemType Directory -Force -Path $prof | Out-Null
Remove-Item "$prof\SingletonLock","$prof\SingletonCookie","$prof\SingletonSocket" -Force -ErrorAction SilentlyContinue

$argline = "--user-data-dir=`"$prof`" --load-extension=`"$ext`" --no-first-run --no-default-browser-check https://badoo.com"
Start-Process $cft -ArgumentList $argline
Write-Host "Launched Chrome for Testing with dating-chad. Log into Badoo and open a chat."
