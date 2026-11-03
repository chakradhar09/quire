<#
.SYNOPSIS
  Installs Quire on Windows: the app, its Python worker, the AI-writing model, and Start menu shortcuts.

.DESCRIPTION
  One line, in PowerShell:
    irm https://raw.githubusercontent.com/chakradhar09/quire/main/scripts/install.ps1 | iex

  It needs Git, Node.js 22.13 or later and Python 3.11 or 3.12, and says how to get any that are missing.
  Everything goes into one folder (default %LOCALAPPDATA%\Quire): the code in app\, your drafts and the
  database in app\data\. Run it again to repair an install; use "Update Quire" to update and "Uninstall Quire"
  (or Settings > Apps) to remove it.

.PARAMETER Dir         Where to install (default %LOCALAPPDATA%\Quire).
.PARAMETER Source      Git URL or local folder to install from (default the GitHub repository).
.PARAMETER BraveKey    Brave Search API key for the similarity check (asked for when omitted; it can also be added
                       later on Quire's Settings page).
.PARAMETER Cpu         Install the CPU build of PyTorch even when an NVIDIA GPU is present.
.PARAMETER NoModel     Skip downloading the AI-writing classifier.
.PARAMETER NoShortcuts Skip the Start menu and desktop shortcuts.
.PARAMETER Yes         Answer every question with its default (for scripted installs).
#>
param(
  [string]$Dir = (Join-Path $env:LOCALAPPDATA "Quire"),
  [string]$Source = "https://github.com/chakradhar09/quire.git",
  [string]$BraveKey,
  [switch]$Cpu,
  [switch]$NoModel,
  [switch]$NoShortcuts,
  [switch]$Yes
)
$ErrorActionPreference = "Stop"

# Kept in step with web/lib/updates.ts (REPO) and MODEL.md.
$Repo = "chakradhar09/quire"
$TorchVersion = "2.14.1"
$ModelUrl = "https://github.com/$Repo/releases/download/model-v5/quire-classifier-v5.zip"
$ModelEnv = @{ AI_DETECTOR = "classifier"; AI_CLASSIFIER_THRESHOLD = "0.2028"; AI_CLASSIFIER_FALSE_POSITIVE_RATE = "0.01"; AI_CLASSIFIER_DETECTION_RATE = "0.7556" }

function Say($text) { Write-Host "==> $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  ! $text" -ForegroundColor Yellow }
function Run($exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE) { throw "$exe $($arguments -join ' ') failed (exit $LASTEXITCODE)" }
}
# Runs a program only to see what it prints; its errors are discarded. Windows PowerShell 5.1 turns a program's
# stderr into an error that $ErrorActionPreference = "Stop" makes fatal (py -3.12 with no 3.12, git describe).
function Probe($exe, [string[]]$arguments) { $ErrorActionPreference = "Continue"; & $exe @arguments 2>$null }
function Ask($question, $default) {
  if ($Yes) { return $default }
  $answer = Read-Host "$question"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $default } else { return $answer.Trim() }
}
# Files the app parses (settings.json) or the worker reads (.env) are written as UTF-8 without a BOM:
# Windows PowerShell's -Encoding utf8 would add one, and JSON.parse rejects it.
function Write-Plain($path, $text) { [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $false)) }
function Version($text) { if ($text -match '(\d+)\.(\d+)(\.(\d+))?') { [version]"$($Matches[1]).$($Matches[2]).$([int]$Matches[4])" } }

# ---------------------------------------------------------------- What it needs
# Python 3.11 or 3.12: the OCR package has no build for 3.13 or later yet. The Python launcher asked for those
# versions first, then python on PATH; kept as the executable and the arguments that pick the version.
function Good-Python($v) { $v = Version "$v"; return $v -and $v -ge [version]"3.11.0" -and $v -lt [version]"3.13.0" }
# What is missing, as winget package ids; also finds the Python to use ($pyExe, $pyArgs).
function Find-Missing {
  $found = @()
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { $found += "Git.Git" }
  # winget's Node.js goes to Program Files; take it even when this window's PATH doesn't have it yet.
  if (-not (Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path "$env:ProgramFiles\nodejs\node.exe")) { $env:Path = "$env:ProgramFiles\nodejs;$env:Path" }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node -or (Version (node --version)) -lt [version]"22.13.0") { $found += "OpenJS.NodeJS.LTS" }
  $script:pyExe = $null; $script:pyArgs = @()
  # Last, the folders python.org's installer (and winget) use, in case the new Python is not on PATH.
  $installed = foreach ($root in @("$env:LOCALAPPDATA\Programs\Python", $env:ProgramFiles)) {
    foreach ($name in "Python312", "Python311") { @{ Exe = "$root\$name\python.exe"; Args = @() } }
  }
  foreach ($candidate in @(@{ Exe = "py"; Args = @("-3.12") }, @{ Exe = "py"; Args = @("-3.11") }, @{ Exe = "python"; Args = @() }) + $installed) {
    if (Get-Command $candidate.Exe -ErrorAction SilentlyContinue) {
      $v = Probe $candidate.Exe @($candidate.Args + "--version")
      if ($LASTEXITCODE -eq 0 -and (Good-Python $v)) { $script:pyExe = $candidate.Exe; $script:pyArgs = $candidate.Args; break }
    }
  }
  if (-not $script:pyExe) { $found += "Python.Python.3.12" }
  return , $found
}

Say "Checking for Git, Node.js and Python"
$missing = Find-Missing
if ($missing.Count -and (Get-Command winget -ErrorAction SilentlyContinue)) {
  Warn "Quire needs: $($missing -join ', ')."
  if ((Ask "  Install them now with winget? [Y/n]" "y") -match "^[yY]") {
    foreach ($id in $missing) {
      Say "Installing $id"
      winget install --id $id --exact --silent --accept-package-agreements --accept-source-agreements
    }
    # winget changed PATH for new windows; take it into this one too.
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    $missing = Find-Missing
  }
}
if ($missing.Count) {
  # return, not exit: run as `irm ... | iex`, exit would close the PowerShell window before anyone reads this.
  Warn "Quire still needs: $($missing -join ', ')."
  Warn "Install them with:  winget install $($missing -join ' ')"
  Warn "(or from git-scm.com, nodejs.org and python.org), then open a new PowerShell window and run the installer again."
  return
}

# ---------------------------------------------------------------- The code
$App = Join-Path $Dir "app"
New-Item -ItemType Directory -Force $Dir | Out-Null
if (Test-Path (Join-Path $App ".git")) {
  Say "Quire is already in $App; repairing it in place"
  # A copy on a release moves to the newest one, so a release that can't install is repaired by the next
  # (a copy between releases, a developer's, is left where it is). Your drafts (app\data) are not in Git.
  $current = Probe git @("-C", $App, "describe", "--tags", "--exact-match", "--match", "v*")
  if ($current -and $current -match '^v\d') {
    Probe git @("-C", $App, "fetch", "--quiet", "--tags") | Out-Null
    $tag = git -C $App tag --list "v*" --sort=-v:refname | Select-Object -First 1
    if ($tag -and $tag -ne $current -and (Version $tag) -gt (Version $current)) {
      Probe git @("-C", $App, "checkout", "--quiet", $tag) | Out-Null
      if ($LASTEXITCODE) { Warn "Could not move to $tag; repairing $current instead." } else { Say "Moved from release $current to $tag" }
    }
  }
} else {
  Say "Downloading Quire into $App"
  Run git @("clone", "--quiet", $Source, $App)
  $tag = git -C $App tag --list "v*" --sort=-v:refname | Select-Object -First 1
  if ($tag) { Run git @("-C", $App, "checkout", "--quiet", $tag); Say "Using release $tag" }
}

# ---------------------------------------------------------------- The worker (Python)
Say "Setting up the worker's Python environment (this downloads PyTorch, a few hundred MB to 2.5 GB)"
$venv = Join-Path $App "worker\.venv"
$py = Join-Path $venv "Scripts\python.exe"
if ((Test-Path $py) -and -not (Good-Python (& $py --version))) { Remove-Item -Recurse -Force $venv }  # made with another Python
if (-not (Test-Path $py)) { Run $pyExe @($pyArgs + @("-m", "venv", $venv)) }
Run $py @("-m", "pip", "install", "--quiet", "--upgrade", "pip")
$gpu = (-not $Cpu) -and (Get-Command nvidia-smi -ErrorAction SilentlyContinue)
$index = if ($gpu) { "https://download.pytorch.org/whl/cu130" } else { "https://download.pytorch.org/whl/cpu" }
Say ("PyTorch {0} for {1}" -f $TorchVersion, $(if ($gpu) { "your NVIDIA GPU" } else { "the CPU" }))
Run $py @("-m", "pip", "install", "--quiet", "torch==$TorchVersion", "--index-url", $index)
Run $py @("-m", "pip", "install", "--quiet", "-r", (Join-Path $App "worker\requirements.txt"))

# ---------------------------------------------------------------- The app (Node)
Say "Building the app"
Push-Location (Join-Path $App "web")
try { Run npm @("ci", "--no-audit", "--no-fund", "--loglevel=error"); Run npm @("run", "build") } finally { Pop-Location }

# ---------------------------------------------------------------- Settings
$envFile = Join-Path $App "worker\.env"
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $App "worker\.env.example") $envFile }
$lines = [System.Collections.Generic.List[string]](Get-Content $envFile)
function Set-Env($key, $value) {
  $i = $lines.FindIndex([Predicate[string]]{ param($l) $l -match "^$key=" })
  if ($i -ge 0) { $lines[$i] = "$key=$value" } else { $lines.Add("$key=$value") }
}

# ---------------------------------------------------------------- The AI-writing model
if (-not $NoModel) {
  $modelDir = Join-Path $App "data\calibration\classifier\model"
  if (Test-Path (Join-Path $modelDir "model.safetensors")) {
    Say "The AI-writing model is already there"
  } else {
    Say "Downloading the AI-writing model (about 575 MB)"
    $zip = Join-Path $env:TEMP "quire-classifier.zip"
    try {
      Invoke-WebRequest $ModelUrl -OutFile $zip -UseBasicParsing
      New-Item -ItemType Directory -Force $modelDir | Out-Null
      Expand-Archive $zip -DestinationPath $modelDir -Force
      Remove-Item $zip
    } catch {
      Warn "Could not download the model ($($_.Exception.Message))."
      Warn "Run the installer again later. Until then the AI estimate uses Binoculars, which downloads two"
      Warn "1.5B-parameter models (about 6 GB) the first time a draft is checked."
    }
  }
  if (Test-Path (Join-Path $modelDir "model.safetensors")) { foreach ($k in $ModelEnv.Keys) { Set-Env $k $ModelEnv[$k] } }
}
Write-Plain $envFile (($lines -join "`n") + "`n")

# Your settings (data\settings.json, the same file the Settings page edits): the Brave key and auto-update.
$settings = Join-Path $App "data\settings.json"
$saved = @{ autoUpdate = $false; braveApiKey = "" }
if (Test-Path $settings) {
  try { $old = Get-Content $settings -Raw | ConvertFrom-Json; $saved.autoUpdate = [bool]$old.autoUpdate; if ($old.braveApiKey) { $saved.braveApiKey = [string]$old.braveApiKey } } catch { }
} else {
  $saved.autoUpdate = (Ask "  Install new versions automatically when Quire starts? [y/N]" "n") -match "^[yY]"
}
if (-not $BraveKey -and -not $saved.braveApiKey) {
  Write-Host "  The similarity check searches the web with your own Brave Search API key. How to get one: README, Getting a Brave Search API key."
  $BraveKey = Ask "  Paste your key, or press Enter to add it later on Quire's Settings page" ""
}
if ($BraveKey) { $saved.braveApiKey = $BraveKey.Trim() }
New-Item -ItemType Directory -Force (Split-Path $settings) | Out-Null
Write-Plain $settings ((ConvertTo-Json ([ordered]@{ autoUpdate = [bool]$saved.autoUpdate; braveApiKey = $saved.braveApiKey })) + "`n")

# ---------------------------------------------------------------- Shortcuts
if (-not $NoShortcuts) {
  Say "Adding Quire to the Start menu and desktop"
  $shell = New-Object -ComObject WScript.Shell
  $menu = Join-Path ([Environment]::GetFolderPath("Programs")) "Quire"
  New-Item -ItemType Directory -Force $menu | Out-Null
  $ps = (Get-Command powershell).Source
  $icon = Join-Path $App "scripts\quire.ico"
  $links = @(
    @{ Path = (Join-Path $menu "Quire.lnk"); Script = "quire.ps1"; Args = ""; Note = "Open Quire" },
    @{ Path = (Join-Path $menu "Stop Quire.lnk"); Script = "quire.ps1"; Args = " -Stop"; Note = "Stop Quire running in the background" },
    @{ Path = (Join-Path $menu "Update Quire.lnk"); Script = "update.ps1"; Args = ""; Note = "Install the latest release of Quire" },
    @{ Path = (Join-Path $menu "Uninstall Quire.lnk"); Script = "uninstall.ps1"; Args = " -Pause"; Note = "Remove Quire from this PC" },
    @{ Path = (Join-Path ([Environment]::GetFolderPath("Desktop")) "Quire.lnk"); Script = "quire.ps1"; Args = ""; Note = "Open Quire" }
  )
  foreach ($l in $links) {
    $s = $shell.CreateShortcut($l.Path)
    $s.TargetPath = $ps
    $hidden = if ($l.Script -eq "quire.ps1") { "-WindowStyle Hidden " } else { "" }
    $s.Arguments = "-NoProfile -ExecutionPolicy Bypass $hidden-File `"$(Join-Path $App "scripts\$($l.Script)")`"$($l.Args)"
    $s.WorkingDirectory = $App
    $s.IconLocation = $icon
    $s.Description = $l.Note
    $s.Save()
  }
}

# ---------------------------------------------------------------- Settings > Apps
# Listed there for this user only (no admin rights); its Uninstall button runs scripts\uninstall.ps1.
$key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Quire"
if (-not (Test-Path $key)) { New-Item $key -Force | Out-Null }
$entry = [ordered]@{
  DisplayName = "Quire"
  DisplayVersion = (Get-Content (Join-Path $App "web\package.json") -Raw | ConvertFrom-Json).version
  Publisher = "Quire (open source)"
  DisplayIcon = (Join-Path $App "scripts\quire.ico")
  InstallLocation = $Dir
  URLInfoAbout = "https://github.com/$Repo"
  UninstallString = "`"$((Get-Command powershell).Source)`" -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $App 'scripts\uninstall.ps1')`" -Pause"
}
foreach ($k in $entry.Keys) { Set-ItemProperty $key $k $entry[$k] }
foreach ($k in "NoModify", "NoRepair") { Set-ItemProperty $key $k 1 -Type DWord }

Say "Quire is installed. Open it from the Start menu, or run: $(Join-Path $App 'scripts\quire.ps1')"
Write-Host "  To remove it: Uninstall Quire in the Start menu, or Settings > Apps."
if (-not $Yes -and (Ask "  Open Quire now? [Y/n]" "y") -match "^[yY]") { & (Join-Path $App "scripts\quire.ps1") }
