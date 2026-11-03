<#
.SYNOPSIS
  Updates Quire to its latest release. Your drafts, reports and settings (app\data) are kept.
.DESCRIPTION
  Fetches release tags, and when one is newer than this copy: stops Quire, switches to it, reinstalls the
  worker's packages and the app's, rebuilds, and starts Quire again if it was running. -Quiet prints only
  what changed (the launcher uses it for automatic updates).
#>
param([switch]$Quiet, [switch]$Force)
$ErrorActionPreference = "Stop"
$App = Split-Path $PSScriptRoot -Parent
function Say($text) { Write-Host "==> $text" -ForegroundColor Green }
# Runs a program only to see what it prints (Windows PowerShell 5.1 makes its stderr fatal under "Stop").
function Probe($exe, [string[]]$arguments) { $ErrorActionPreference = "Continue"; & $exe @arguments 2>$null }
function Run($exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE) { throw "$exe $($arguments -join ' ') failed (exit $LASTEXITCODE)" }
}

# --force: a release tag moved to a fixed commit (0.1.0's was) would otherwise fail the fetch.
git -C $App fetch --quiet --tags --force
if ($LASTEXITCODE) { if (-not $Quiet) { Write-Host "Could not reach the update server; try again later." }; exit 0 }
$latest = git -C $App tag --list "v*" --sort=-v:refname | Select-Object -First 1
# The release this copy is on: its tag, or else the version in package.json (a copy between releases).
$current = Probe git @("-C", $App, "describe", "--tags", "--exact-match", "--match", "v*")
if (-not $current) { $current = "v" + (Get-Content (Join-Path $App "web\package.json") -Raw | ConvertFrom-Json).version }
if (-not $latest -or ((-not $Force) -and ([version]($latest.TrimStart("v").Split("-")[0]) -le [version]($current.TrimStart("v").Split("-")[0])))) {
  if (-not $Quiet) { Write-Host "Quire $current is the latest release." }
  exit 0
}

Say "Updating Quire $current to $latest"
$wasRunning = Test-Path (Join-Path $App "data\web.pid")
& (Join-Path $PSScriptRoot "quire.ps1") -Stop | Out-Null
Run git @("-C", $App, "checkout", "--quiet", $latest)
# ponytail: PyTorch itself is not reinstalled here; a release that moves it says to run the installer again.
Run (Join-Path $App "worker\.venv\Scripts\python.exe") @("-m", "pip", "install", "--quiet", "-r", (Join-Path $App "worker\requirements.txt"))
Push-Location (Join-Path $App "web")
try { Run npm @("ci", "--no-audit", "--no-fund", "--loglevel=error"); Run npm @("run", "build") } finally { Pop-Location }
# The version Settings > Apps shows.
$key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Quire"
if (Test-Path $key) { Set-ItemProperty $key DisplayVersion $latest.TrimStart("v") }
Say "Quire is now $latest"
if ($wasRunning -and -not $Quiet) { & (Join-Path $PSScriptRoot "quire.ps1") }
