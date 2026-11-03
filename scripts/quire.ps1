<#
.SYNOPSIS
  Opens Quire: starts the app in the background (if it isn't running) and opens it in your browser.
.DESCRIPTION
  With "autoUpdate": true in data\settings.json it first installs a newer release, if there is one.
  The worker starts by itself when there is something to check. -Stop stops the app and the worker.
#>
param([switch]$Stop)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # Windows PowerShell 5.1's progress bar slows Invoke-WebRequest
# Next.js reports anonymous usage to Vercel by default; Quire sends nothing but its searches and update check.
$env:NEXT_TELEMETRY_DISABLED = "1"
$App = Split-Path $PSScriptRoot -Parent
$Data = Join-Path $App "data"
$Url = "http://127.0.0.1:3000"
$PidFile = Join-Path $Data "web.pid"

# A pid file is trusted only while it is current: after a crash or a reboot the number in it may belong to another
# program by now, which -Stop must not kill. The app's counts while the app answers (or in its first minute, while
# it starts), the worker's while the worker keeps touching it (every 15 s, worker\main.py).
function Running($file, $freshFor, $url) {
  if (-not (Test-Path $file)) { return $null }
  $id = 0
  if (-not [int]::TryParse("$(Get-Content $file -Raw)".Trim(), [ref]$id)) { return $null }
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if (-not $p) { return $null }
  if (((Get-Date) - (Get-Item $file).LastWriteTime).TotalSeconds -lt $freshFor) { return $p }
  if ($url) {
    try { Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 3 | Out-Null; return $p } catch { if ($_.Exception.Response) { return $p } }
  }
  return $null
}
function App-Running { Running $PidFile 60 $Url }

if ($Stop) {
  foreach ($file in @($PidFile, (Join-Path $Data "worker.pid"))) {
    $p = if ($file -eq $PidFile) { App-Running } else { Running $file 120 }
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
if ((Test-Path $settings) -and ((Get-Content $settings -Raw) -match '"autoUpdate"\s*:\s*true') -and -not (App-Running)) {
  # A failed update must not keep Quire from opening; the next start tries again.
  try { & (Join-Path $PSScriptRoot "update.ps1") -Quiet } catch { Write-Host "Could not update Quire: $($_.Exception.Message)" }
}

if (-not (App-Running)) {
  $log = Join-Path $Data "web.log"
  # The database: created on the first start, and brought up to date after an update. The app only reads it,
  # and the worker that would also do this starts only once there is work in it.
  try { & (Join-Path $App "worker\.venv\Scripts\python.exe") (Join-Path $App "db\migrate.py") *> $null } catch { }
  $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run start > `"$log`" 2>&1" `
    -WorkingDirectory (Join-Path $App "web") -WindowStyle Hidden -PassThru
  Set-Content -Path $PidFile -Value $p.Id -NoNewline
  # Wait for it to answer (a first start takes a few seconds).
  for ($i = 0; $i -lt 60; $i++) {
    try { Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Seconds 1 }
  }
}
Start-Process $Url
