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
# Next.js reports anonymous usage to Vercel by default; Quire sends nothing but its searches and update check.
$env:NEXT_TELEMETRY_DISABLED = "1"
$App = Split-Path $PSScriptRoot -Parent
function Say($text) { Write-Host "==> $text" -ForegroundColor Green }
# Runs a program only to see what it prints (Windows PowerShell 5.1 makes its stderr fatal under "Stop").
function Probe($exe, [string[]]$arguments) { $ErrorActionPreference = "Continue"; & $exe @arguments 2>$null }
# Runs a program and stops if it fails, judged by its exit code alone. Windows PowerShell 5.1 can turn every line
# a program writes to stderr into an error, which "Stop" makes fatal and which it prints as one: uv, git and npm
# report progress there. So stderr is merged in and shown as plain text.
function Run($exe, [string[]]$arguments) {
  $ErrorActionPreference = "Continue"
  Utf8 { & $exe @arguments 2>&1 | ForEach-Object { Write-Host "$_" } }
  if ($LASTEXITCODE) { throw "$exe $($arguments -join ' ') failed (exit $LASTEXITCODE)" }
}
# Runs a block with programs' output read as UTF-8, which is what npm, uv and git write. Otherwise Windows
# PowerShell reads it in the console's old code page (437), and the box-drawing tree that next build prints comes
# out as runs of Greek and accented letters. The window's own setting is put back afterwards.
function Utf8([scriptblock]$block) {
  $before = [Console]::OutputEncoding
  try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch { }
  try { & $block } finally { try { [Console]::OutputEncoding = $before } catch { } }
}

# --force: a release tag moved to a fixed commit (0.1.0's was) would otherwise fail the fetch.
Probe git @("-C", $App, "fetch", "--quiet", "--tags", "--force") | Out-Null
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
# With uv when the installer left one (much faster), else pip.
$venvPy = Join-Path $App "worker\.venv\Scripts\python.exe"
$uv = Join-Path (Split-Path $App -Parent) "uv\uv.exe"
if (Test-Path $uv) { Run $uv @("pip", "install", "--quiet", "--python", $venvPy, "-r", (Join-Path $App "worker\requirements.txt")) } else {
  Run $venvPy @("-m", "pip", "install", "--quiet", "-r", (Join-Path $App "worker\requirements.txt"))
}
Push-Location (Join-Path $App "web")
# Build it, then remove the packages used only for building (TypeScript, Tailwind, eslint: about 330).
try { Run npm @("ci", "--no-audit", "--no-fund", "--loglevel=error"); Run npm @("run", "build"); Run npm @("prune", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error") } finally { Pop-Location }
# The version Settings > Apps shows.
$key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Quire"
if (Test-Path $key) { Set-ItemProperty $key DisplayVersion $latest.TrimStart("v") }
Say "Quire is now $latest"
if ($wasRunning -and -not $Quiet) { & (Join-Path $PSScriptRoot "quire.ps1") }
