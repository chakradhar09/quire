// Running Quire's own update and uninstall scripts (scripts/) from the Settings page. Both stop this server, so the
// script is started detached and outlives it. On Windows it opens in a window of its own, where it shows its progress
// and asks its questions; elsewhere the updater runs in the background with its output in data/update.log, and
// uninstalling stays a terminal command (uninstall.sh asks its questions there).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const scriptsInWindow = process.platform === "win32";

// The scripts live beside web/, outside the app's own files: not something the build should trace.
const root = () => path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");

// PowerShell source that runs a script and, if it fails, keeps the window open on the error.
export function windowCommand(file: string, args = "") {
  const quoted = `'${file.replaceAll("'", "''")}'`;
  return `try { & ${quoted}${args} } catch { Write-Host $_ -ForegroundColor Red; Read-Host 'Press Enter to close' | Out-Null }`;
}

export function runScript(name: "update" | "uninstall") {
  const dir = path.join(root(), "scripts");
  if (scriptsInWindow) {
    const command = windowCommand(path.join(dir, `${name}.ps1`), name === "uninstall" ? " -Pause" : "");
    // `start` gives it a console window of its own (a detached PowerShell gets none and quits at once).
    // -EncodedCommand is plain base64, so nothing in the install path needs quoting for cmd.
    const encoded = Buffer.from(command, "utf16le").toString("base64");
    spawn("cmd.exe", [`/d /c start "Quire" powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`],
      // Started outside the install: Windows can't delete a folder a process is in.
      { cwd: os.tmpdir(), detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true }).unref();
    return;
  }
  if (name !== "update") throw new Error("Run quire-uninstall in a terminal.");
  const log = fs.openSync(path.join(root(), "data", "update.log"), "w");
  spawn("bash", [path.join(dir, "update.sh")], { cwd: os.tmpdir(), detached: true, stdio: ["ignore", log, log] }).unref();
  fs.closeSync(log);
}
