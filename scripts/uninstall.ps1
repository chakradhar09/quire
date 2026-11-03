<#
.SYNOPSIS
  Removes Quire from Windows: stops it, deletes the app, its Start menu and desktop shortcuts and its entry in
  Settings > Apps.

.DESCRIPTION
  From the Start menu (Quire > Uninstall Quire), Settings > Apps > Quire > Uninstall, or in PowerShell:
    irm https://raw.githubusercontent.com/chakradhar09/quire/main/scripts/uninstall.ps1 | iex

  It first asks whether to keep your drafts, reports and settings (app\data); kept, they move to
  Documents\Quire data <date>. Git, Node.js and Python stay installed: other programs may use them, and
  Settings > Apps removes them if you want.

.PARAMETER Dir      The install to remove (default: the one this script is in, else %LOCALAPPDATA%\Quire).
.PARAMETER KeepData Keep your drafts, reports and settings without asking.
.PARAMETER DeleteData Delete them without asking.
.PARAMETER Yes      Don't ask anything (your data is kept unless -DeleteData).
.PARAMETER Pause    Wait for Enter before closing (the Start menu and Settings > Apps run it in a new window).
#>
param([string]$Dir, [switch]$KeepData, [switch]$DeleteData, [switch]$Yes, [switch]$Pause)
$ErrorActionPreference = "Stop"

function Say($text) { Write-Host "==> $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  ! $text" -ForegroundColor Yellow }
function Ask($question, $default) {
  if ($Yes) { return $default }
  $answer = Read-Host "$question"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $default } else { return $answer.Trim() }
}
function Done { if ($Pause) { Read-Host "Press Enter to close" | Out-Null } }
# Deletes a folder: Remove-Item, then rd, which copes better with long node_modules paths.
function Remove-Folder($path) {
  if (-not (Test-Path $path)) { return $true }
  try { Remove-Item -Recurse -Force $path } catch { try { cmd /c rd /s /q "`"$path`"" 2>$null } catch { } }
  return -not (Test-Path $path)
}

# Every exit below is a return: run as `irm ... | iex`, exit would close the PowerShell window.
if (-not $Dir) {
  # Run from an install's scripts folder, that install; piped from irm, the default folder.
  $Dir = Join-Path $env:LOCALAPPDATA "Quire"
  if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot "quire.ps1"))) { $Dir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent }
}
$App = Join-Path $Dir "app"
if (-not (Test-Path (Join-Path $App "scripts\quire.ps1")) -or -not (Test-Path (Join-Path $App ".git"))) {
  Warn "There is no Quire install in $Dir. (Installed elsewhere? Run it with -Dir and that folder.)"
  Done; return
}

Say "This removes Quire from $Dir"
if (-not $Yes -and (Ask "  Remove Quire? [y/N]" "n") -notmatch "^[yY]") { Write-Host "Nothing was removed."; Done; return }
$data = Join-Path $App "data"
$keep = -not $DeleteData
if ((Test-Path $data) -and -not $KeepData -and -not $DeleteData) {
  $keep = (Ask "  Keep your drafts, reports and settings (they move to your Documents folder)? [Y/n]" "y") -notmatch "^[nN]"
}

Say "Stopping Quire"
try { & (Join-Path $App "scripts\quire.ps1") -Stop | Out-Null } catch { }
# Windows can't delete a folder a process is in: the Start menu shortcut starts this one in the app folder.
Set-Location $env:TEMP; [Environment]::CurrentDirectory = $env:TEMP

if ($keep -and (Test-Path $data)) {
  $docs = [Environment]::GetFolderPath("MyDocuments")
  $dest = Join-Path $docs ("Quire data " + (Get-Date -Format "yyyy-MM-dd"))
  for ($n = 2; Test-Path $dest; $n++) { $dest = Join-Path $docs ("Quire data " + (Get-Date -Format "yyyy-MM-dd") + " ($n)") }
  # The AI-writing model (about 575 MB) and the logs aren't yours: the installer downloads the model again.
  Remove-Folder (Join-Path $data "calibration\classifier\model") | Out-Null
  foreach ($d in "calibration\classifier", "calibration") { $p = Join-Path $data $d; if ((Test-Path $p) -and -not (Get-ChildItem $p -Force)) { Remove-Item $p } }
  foreach ($f in "web.pid", "worker.pid", "web.log", "worker.log") { Remove-Item (Join-Path $data $f) -ErrorAction SilentlyContinue }
  # Copied, not moved: Documents is often on another drive, or in OneDrive, where a folder can't be moved to.
  Copy-Item -Recurse $data $dest
  Say "Your drafts, reports and settings are in $dest"
  Write-Host "    To use them again: install Quire, use Stop Quire, put that folder in place of $data,"
  Write-Host "    and run the installer once more (it downloads the AI-writing model again)."
}

# The shortcuts and the Settings > Apps entry, but only the ones that belong to this install.
$shell = New-Object -ComObject WScript.Shell
$menu = Join-Path ([Environment]::GetFolderPath("Programs")) "Quire"
$desktop = Join-Path ([Environment]::GetFolderPath("Desktop")) "Quire.lnk"
$links = @($desktop) + @("Quire.lnk", "Stop Quire.lnk", "Update Quire.lnk", "Uninstall Quire.lnk" | ForEach-Object { Join-Path $menu $_ })
foreach ($l in $links) {
  if ((Test-Path $l) -and $shell.CreateShortcut($l).Arguments -like "*$App\scripts\*") { Remove-Item $l }
}
if ((Test-Path $menu) -and -not (Get-ChildItem $menu -Force)) { Remove-Item $menu }
$key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Quire"
if ((Test-Path $key) -and (Get-ItemProperty $key).InstallLocation -eq $Dir) { Remove-Item $key -Recurse }

Say "Deleting the app"
if (-not (Remove-Folder $App)) {
  Warn "Some files in $App are still in use. Restart Windows, then delete that folder."
  Done; return
}
if (-not (Get-ChildItem $Dir -Force)) { Remove-Item $Dir } else { Warn "$Dir still has other files in it; they were left alone." }
Say "Quire is removed."
Done
