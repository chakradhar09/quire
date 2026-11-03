<#
  CI, after scripts\install.ps1, in Windows PowerShell 5.1: opens Quire, uploads a draft, checks that the worker
  starts without a console window (pythonw.exe) and reads it, stops Quire, checks that the app and the worker are
  gone, then uninstalls. Usage: smoke.ps1 INSTALL_DIR
#>
param([Parameter(Mandatory)][string]$Dir)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$App = Join-Path $Dir "app"
$Data = Join-Path $App "data"
$Url = "http://127.0.0.1:3000"
$env:QUIRE_NO_BROWSER = "1"
function Fail($text) { Write-Host "::error::$text"; exit 1 }

Write-Host "::group::Open Quire"
& (Join-Path $App "scripts\quire.ps1")
Invoke-WebRequest $Url -UseBasicParsing | Out-Null
Write-Host "::endgroup::"

Write-Host "::group::Upload a draft"
$draft = Join-Path $env:RUNNER_TEMP "draft.txt"
Set-Content $draft "A short draft with a few sentences of plain prose in it.`nEnough for the worker to read and queue."
& curl.exe -fsS -o NUL -H "Origin: $Url" -F "title=CI" -F "file=@$draft" "$Url/api/upload"
if ($LASTEXITCODE) { Fail "Uploading the draft failed" }
Invoke-WebRequest "$Url/drafts" -UseBasicParsing | Out-Null  # a page with drafts queued starts the worker
$log = Join-Path $Data "worker.log"
for ($i = 0; $i -lt 60; $i++) {
  if ((Test-Path $log) -and (Select-String -Path $log -Pattern "extract \(document 1\): done" -Quiet)) { break }
  Start-Sleep -Seconds 1
}
if (Test-Path $log) { Get-Content $log }
if (-not (Select-String -Path $log -Pattern "extract \(document 1\): done" -Quiet)) { Fail "The worker didn't read the draft" }
$worker = Get-Process -Id ([int](Get-Content (Join-Path $Data "worker.pid") -Raw).Trim())
Write-Host "worker: $($worker.ProcessName) ($($worker.Path))"
# Uploading opened a blank terminal when the worker ran as python.exe: it must be pythonw.exe, with no console.
if ($worker.ProcessName -ne "pythonw") { Fail "The worker runs as $($worker.ProcessName).exe, which opens a console window" }
$console = Get-CimInstance Win32_Process -Filter "Name = 'conhost.exe' AND ParentProcessId = $($worker.Id)"
if ($console) { Fail "The worker has a console window (conhost.exe $($console.ProcessId))" }
Write-Host "::endgroup::"

Write-Host "::group::Stop Quire"
& (Join-Path $App "scripts\quire.ps1") -Stop
for ($i = 0; $i -lt 20 -and (Get-Process -Id $worker.Id -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Seconds 1 }
if (Get-Process -Id $worker.Id -ErrorAction SilentlyContinue) { Fail "The worker is still running after Stop" }
$answers = $true
try { Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 3 | Out-Null } catch { $answers = $false }
if ($answers) { Fail "The app still answers after Stop" }
Write-Host "::endgroup::"

Write-Host "::group::Uninstall"
& (Join-Path $App "scripts\uninstall.ps1") -Yes -DeleteData
if (Test-Path $Dir) { Fail "$Dir is still there after uninstalling" }
if (Test-Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Quire") { Fail "Settings > Apps still lists Quire" }
Write-Host "::endgroup::"
