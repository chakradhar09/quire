<#
.SYNOPSIS
  Installs Quire on Windows: the app, its Python worker, the AI-writing model, and Start menu shortcuts.

.DESCRIPTION
  One line, in PowerShell:
    irm https://raw.githubusercontent.com/chakradhar09/quire/main/scripts/install.ps1 | iex

  It needs Git, Node.js 22.13 or later and Python 3.11 or 3.12, and says how to get any that are missing.
  Everything goes into one folder (default %LOCALAPPDATA%\Quire): the code in app\, your drafts and the
  database in app\data\. Run it again to repair an install. Update and uninstall it from Quire's Settings page
  (Settings > Apps can uninstall it too).

.PARAMETER Dir         Where to install (default %LOCALAPPDATA%\Quire).
.PARAMETER Source      Git URL or local folder to install from (default the GitHub repository).
.PARAMETER Ref         A branch, tag or commit to install instead of the newest release (for testing).
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
  [string]$Ref,
  [string]$BraveKey,
  [switch]$Cpu,
  [switch]$NoModel,
  [switch]$NoShortcuts,
  [switch]$Yes
)
$ErrorActionPreference = "Stop"
# Next.js reports anonymous usage to Vercel by default; Quire sends nothing but its searches and update check.
$env:NEXT_TELEMETRY_DISABLED = "1"
# Windows PowerShell 5.1 redraws its progress bar so often that it makes Invoke-WebRequest and Expand-Archive
# many times slower on big files.
$ProgressPreference = "SilentlyContinue"

# Kept in step with web/lib/updates.ts (REPO) and MODEL.md.
$Repo = "chakradhar09/quire"
$TorchVersion = "2.14.1"
$ModelUrl = "https://github.com/$Repo/releases/download/model-v5/quire-classifier-v5.zip"
$ModelEnv = @{ AI_DETECTOR = "classifier"; AI_CLASSIFIER_THRESHOLD = "0.2028"; AI_CLASSIFIER_FALSE_POSITIVE_RATE = "0.01"; AI_CLASSIFIER_DETECTION_RATE = "0.7556" }

function Say($text) { Write-Host "==> $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  ! $text" -ForegroundColor Yellow }
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
# uv (astral.sh) installs Python packages several at a time, far faster than pip. It lives in $Dir\uv; pip is
# the fallback when it can't be downloaded. uv's installer runs in its own PowerShell: on an error it calls exit,
# which would close this window.
function Get-Uv {
  $ErrorActionPreference = "Continue"
  $uv = Join-Path $Dir "uv\uv.exe"
  if (-not (Test-Path $uv)) {
    $env:UV_UNMANAGED_INSTALL = Join-Path $Dir "uv"
    try { & (Get-Command powershell).Source -NoProfile -ExecutionPolicy Bypass -Command '$ProgressPreference = ''SilentlyContinue''; irm https://astral.sh/uv/install.ps1 | iex' | Out-Null } catch { }
    Remove-Item Env:UV_UNMANAGED_INSTALL -ErrorAction SilentlyContinue
  }
  if (Test-Path $uv) { return $uv }
}
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
      # Not Run: a package that fails is reported by the check below. Its stderr mustn't stop the script.
      Utf8 { $ErrorActionPreference = "Continue"; winget install --id $id --exact --silent --accept-package-agreements --accept-source-agreements 2>&1 | ForEach-Object { Write-Host "$_" } }
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

# ---------------------------------------------------------------- The AI-writing model, in the background
# It downloads while the rest installs, into $Dir\download until it is unpacked. With curl.exe (part of Windows 10
# and 11) a download that was cut off carries on where it stopped (-C -) the next time.
$modelDir = Join-Path $App "data\calibration\classifier\model"
$download = Join-Path $Dir "download"
$modelZip = Join-Path $download ($ModelUrl -split "/")[-1]
$modelPart = "$modelZip.part"
$modelJob = $null
if (-not $NoModel -and -not (Test-Path (Join-Path $modelDir "model.safetensors")) -and -not (Test-Path $modelZip)) {
  New-Item -ItemType Directory -Force $download | Out-Null
  # A download left running by an installer window that was closed would write into the same file.
  try { Get-CimInstance Win32_Process -Filter "Name = 'curl.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($modelPart) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force } } catch { }
  Say "Downloading the AI-writing model (about 575 MB) in the background"
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    $modelJob = Start-Process $curl.Source -WindowStyle Hidden -PassThru -ArgumentList "-fsSL --retry 3 -C - -o `"$modelPart`" `"$ModelUrl`""
    $null = $modelJob.Handle  # without this, Windows PowerShell can't read the exit code once it ends
  } else {
    Remove-Item $modelPart -ErrorAction SilentlyContinue
    $modelJob = Start-Job -ArgumentList $ModelUrl, $modelPart -ScriptBlock {
      param($url, $out)
      $ProgressPreference = "SilentlyContinue"
      Invoke-WebRequest $url -OutFile $out -UseBasicParsing
    }
  }
}
if (Test-Path (Join-Path $App ".git")) {
  Say "Quire is already in $App; repairing it in place"
  # A copy on a release moves to the newest one, so a release that can't install is repaired by the next, or by
  # its tag moved to a fixed commit (--force takes a moved tag). A copy between releases, a
  # developer's, is left where it is. Your drafts (app\data) are not in Git.
  $current = Probe git @("-C", $App, "describe", "--tags", "--exact-match", "--match", "v*")
  if ($current -and $current -match '^v\d') {
    Probe git @("-C", $App, "fetch", "--quiet", "--tags", "--force") | Out-Null
    $tag = git -C $App tag --list "v*" --sort=-v:refname | Select-Object -First 1
    $moved = $tag -and (Probe git @("-C", $App, "rev-parse", "$tag^{commit}")) -ne (Probe git @("-C", $App, "rev-parse", "HEAD"))
    if ($moved -and (Version $tag) -ge (Version $current)) {
      Probe git @("-C", $App, "checkout", "--quiet", $tag) | Out-Null
      if ($LASTEXITCODE) { Warn "Could not move to $tag; repairing $current instead." } else { Say "Moved from release $current to the current $tag" }
    }
  }
} else {
  Say "Downloading Quire into $App"
  Run git @("clone", "--quiet", $Source, $App)
  $tag = git -C $App tag --list "v*" --sort=-v:refname | Select-Object -First 1
  if ($tag) { Run git @("-C", $App, "checkout", "--quiet", $tag); Say "Using release $tag" }
}

if ($Ref) {
  Probe git @("-C", $App, "fetch", "--quiet", "origin", $Ref) | Out-Null
  Probe git @("-C", $App, "checkout", "--quiet", $Ref) | Out-Null
  if ($LASTEXITCODE) { Run git @("-C", $App, "checkout", "--quiet", "FETCH_HEAD") }
  Say "Using $Ref"
}

# ---------------------------------------------------------------- The worker (Python)
Say "Setting up the worker's Python environment (this downloads PyTorch, a few hundred MB to 2.5 GB)"
$venv = Join-Path $App "worker\.venv"
$py = Join-Path $venv "Scripts\python.exe"
if ((Test-Path $py) -and -not (Good-Python (& $py --version))) { Remove-Item -Recurse -Force $venv }  # made with another Python
if (-not (Test-Path $py)) { Run $pyExe @($pyArgs + @("-m", "venv", $venv)) }
$uv = Get-Uv
if (-not $uv) { Warn "Could not download uv; installing with pip instead, which is slower."; Run $py @("-m", "pip", "install", "--quiet", "--upgrade", "pip") }
function Pip-Install([string[]]$arguments) {
  if ($uv) { Run $uv (@("pip", "install", "--python", $py) + $arguments) } else { Run $py (@("-m", "pip", "install", "--quiet") + $arguments) }
}
$gpu = (-not $Cpu) -and (Get-Command nvidia-smi -ErrorAction SilentlyContinue)
$index = if ($gpu) { "https://download.pytorch.org/whl/cu130" } else { "https://download.pytorch.org/whl/cpu" }
Say ("PyTorch {0} for {1}" -f $TorchVersion, $(if ($gpu) { "your NVIDIA GPU" } else { "the CPU" }))
Pip-Install @("torch==$TorchVersion", "--index-url", $index)
Pip-Install @("-r", (Join-Path $App "worker\requirements.txt"))

# ---------------------------------------------------------------- The app (Node)
Say "Building the app"
Push-Location (Join-Path $App "web")
# Build it, then remove the packages used only for building (TypeScript, Tailwind, eslint: about 330).
try { Run npm @("ci", "--no-audit", "--no-fund", "--loglevel=error"); Run npm @("run", "build"); Run npm @("prune", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error") } finally { Pop-Location }
# The database, before the app's first start: the app only reads it (0.1.1's launcher doesn't create it).
Run $py @((Join-Path $App "db\migrate.py"))

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
  if (Test-Path (Join-Path $modelDir "model.safetensors")) {
    Say "The AI-writing model is already there"
  } else {
    if ($modelJob -is [System.Diagnostics.Process]) {
      if (-not $modelJob.HasExited) {
        Say "Waiting for the AI-writing model to finish downloading"
        while (-not $modelJob.HasExited) {
          $mb = if (Test-Path $modelPart) { [int]((Get-Item $modelPart).Length / 1MB) } else { 0 }
          Write-Host -NoNewline "`r    $mb MB of about 575 "
          Start-Sleep -Seconds 2
        }
        Write-Host ""
      }
      if ($modelJob.ExitCode -eq 0 -and (Test-Path $modelPart)) { Move-Item -Force $modelPart $modelZip }
    } elseif ($modelJob) {
      if ($modelJob.State -eq "Running") { Say "Waiting for the AI-writing model to finish downloading" }
      Wait-Job $modelJob | Out-Null
      if ($modelJob.State -eq "Completed" -and (Test-Path $modelPart)) { Move-Item -Force $modelPart $modelZip }
      Remove-Job $modelJob
    }
    # A .part can be whole: resuming a finished download, the server answers that there's nothing left to send.
    $zip = if (Test-Path $modelZip) { $modelZip } elseif (Test-Path $modelPart) { $modelPart } else { $null }
    if ($zip) {
      Say "Unpacking the AI-writing model"
      try {
        if (Test-Path $modelDir) { Remove-Item -Recurse -Force $modelDir }
        New-Item -ItemType Directory -Force (Split-Path $modelDir) | Out-Null
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory($zip, $modelDir)  # much faster than Expand-Archive
        Remove-Item -Recurse -Force $download
      } catch {
        if (Test-Path $modelDir) { Remove-Item -Recurse -Force $modelDir }
        if ($zip -eq $modelZip) { Remove-Item $modelZip }  # a .part is kept, to carry on from
        Warn "The model download didn't finish, or is damaged."
      }
    } else {
      Warn "Could not download the model."
    }
    if (-not (Test-Path (Join-Path $modelDir "model.safetensors"))) {
      Warn "Run the installer again later; it carries on where the download stopped. Until then the AI estimate uses"
      Warn "Binoculars, which downloads two 1.5B-parameter models (about 6 GB) the first time a draft is checked."
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
    @{ Path = (Join-Path ([Environment]::GetFolderPath("Desktop")) "Quire.lnk"); Script = "quire.ps1"; Args = ""; Note = "Open Quire" }
  )
  # Updating and uninstalling are on Quire's Settings page; earlier installs also had shortcuts for them.
  foreach ($old in "Stop Quire.lnk", "Update Quire.lnk", "Uninstall Quire.lnk") { Remove-Item (Join-Path $menu $old) -ErrorAction SilentlyContinue }
  foreach ($l in $links | Where-Object { Test-Path (Join-Path $App "scripts\$($_.Script)") }) {
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
# Listed there for this user only (no admin rights); its Uninstall button runs scripts\uninstall.ps1, which
# 0.1.0 didn't have.
$key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Quire"
if (Test-Path (Join-Path $App "scripts\uninstall.ps1")) {
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
}

Say "Quire is installed. Open it from the Start menu, or run: $(Join-Path $App 'scripts\quire.ps1')"
if (Test-Path $key) { Write-Host "  To update or remove it: Quire's Settings page, or Settings > Apps to remove it." }
if (-not $Yes -and (Ask "  Open Quire now? [Y/n]" "y") -match "^[yY]") { & (Join-Path $App "scripts\quire.ps1") }
