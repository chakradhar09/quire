<#
.SYNOPSIS
  Opens Quire: starts the app in the background (if it isn't running) and opens it in your browser.
.DESCRIPTION
  With "autoUpdate": true in data\settings.json it first installs a newer release, if there is one.
  The worker starts by itself when there is something to check. -Stop stops the app and the worker.
#>
param([switch]$Stop)
$ErrorActionPreference = "Stop"
$App = Split-Path $PSScriptRoot -Parent
$Data = Join-Path $App "data"
$Url = "http://127.0.0.1:3000"
$PidFile = Join-Path $Data "web.pid"

function Running($file) {
  if (-not (Test-Path $file)) { return $null }
  $id = [int](Get-Content $file -Raw)
  return Get-Process -Id $id -ErrorAction SilentlyContinue
}

if ($Stop) {
  foreach ($file in @($PidFile, (Join-Path $Data "worker.pid"))) {
    $p = Running $file
    # The app runs as npm, which starts node: stop the whole tree.
    # taskkill reports children that already ended on stderr, which Windows PowerShell 5.1 would make fatal.
    if ($p) { & { $ErrorActionPreference = "Continue"; taskkill /PID $p.Id /T /F 2>&1 | Out-Null } }
    Remove-Item $file -ErrorAction SilentlyContinue
  }
  Write-Host "Quire stopped."
  exit 0
}

New-Item -ItemType Directory -Force $Data | Out-Null
$settings = Join-Path $Data "settings.json"
if ((Test-Path $settings) -and ((Get-Content $settings -Raw) -match '"autoUpdate"\s*:\s*true') -and -not (Running $PidFile)) {
  & (Join-Path $PSScriptRoot "update.ps1") -Quiet
}

if (-not (Running $PidFile)) {
  $log = Join-Path $Data "web.log"
  $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run start > `"$log`" 2>&1" `
    -WorkingDirectory (Join-Path $App "web") -WindowStyle Hidden -PassThru
  Set-Content -Path $PidFile -Value $p.Id -NoNewline
  # Wait for it to answer (a first start takes a few seconds).
  for ($i = 0; $i -lt 60; $i++) {
    try { Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Seconds 1 }
  }
}
Start-Process $Url
