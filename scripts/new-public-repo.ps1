<#
.SYNOPSIS
  Makes a fresh copy of this repository for publishing: the committed files of HEAD, one commit, no history.
.DESCRIPTION
  The earlier history (and the author email in every earlier commit) stays in this repository. The copy's single
  commit is authored with the name and email you give, such as your GitHub no-reply address
  (<id>+<user>@users.noreply.github.com, under GitHub Settings -> Emails). Nothing is pushed; see RELEASING.md.
.EXAMPLE
  scripts\new-public-repo.ps1 -Dest ..\quire-public -Name "Your Name" -Email "12345+you@users.noreply.github.com"
#>
param(
  [Parameter(Mandatory)][string]$Dest,
  [Parameter(Mandatory)][string]$Name,
  [Parameter(Mandatory)][string]$Email
)
$ErrorActionPreference = "Stop"
$Repo = Split-Path $PSScriptRoot -Parent
if (git -C $Repo status --porcelain --untracked-files=no) { throw "Commit or stash your changes first: the copy is made from the last commit." }
if ((Test-Path $Dest) -and (Get-ChildItem $Dest -Force | Select-Object -First 1)) { throw "$Dest is not empty." }

New-Item -ItemType Directory -Force $Dest | Out-Null
$Dest = (Resolve-Path $Dest).Path
$archive = Join-Path $env:TEMP "quire-public.zip"
git -C $Repo archive --format=zip -o $archive HEAD
if ($LASTEXITCODE) { throw "git archive failed" }
Expand-Archive $archive -DestinationPath $Dest
Remove-Item $archive

git -C $Dest init --quiet --initial-branch=main
git -C $Dest add --all
git -C $Dest -c user.name="$Name" -c user.email="$Email" commit --quiet -m "Quire 0.1.0"
if ($LASTEXITCODE) { throw "git commit failed" }
git -C $Dest log --format="%h %an <%ae> %s"
Write-Host "Made $Dest with one commit. Next: create the GitHub repository and push (RELEASING.md)."
