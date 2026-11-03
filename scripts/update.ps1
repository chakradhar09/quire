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
function Run($exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE) { throw "$exe $($arguments -join ' ') failed (exit $LASTEXITCODE)" }
}

git -C $App fetch --quiet --tags
if ($LASTEXITCODE) { if (-not $Quiet) { Write-Host "Could not reach the update server; try again later." }; exit 0 }
$latest = git -C $App tag --list "v*" --sort=-v:refname | Select-Object -First 1
# The release this copy is on: its tag, or else the version in package.json (a copy between releases).
$current = git -C $App describe --tags --exact-match 2>$null
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
Say "Quire is now $latest"
if ($wasRunning -and -not $Quiet) { & (Join-Path $PSScriptRoot "quire.ps1") }
