// Starting the worker on demand. While data/worker.pid names a live process the worker is running (it writes the
// file itself and removes it when it stops); otherwise this starts one in the background, which exits after five
// minutes with nothing queued. Server only.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dataDirectory } from "./db.ts";

const IDLE_EXIT_SECONDS = 300;
// The worker touches data/worker.pid every 15 s (worker/main.py). A file older than this is left over from a worker
// that died, in a crash or a reboot, and the process id in it may belong to another program by now: Windows hands
// ids out again quickly. Trusting it would leave drafts queued forever.
const STALE_MS = 120_000;

export function workerRunning(dataDir = dataDirectory()) {
  try {
    const file = path.join(dataDir, "worker.pid");
    if (Date.now() - fs.statSync(file).mtimeMs > STALE_MS) return false;
    const pid = Number(fs.readFileSync(file, "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0); // throws when no such process
    return true;
  } catch {
    return false;
  }
}

// The worker's Python: QUIRE_PYTHON, or worker/.venv next to web/. On Windows pythonw.exe, which has no console:
// python.exe started detached opens a console window of its own, and Node's windowsHide doesn't hide it then, so
// a blank terminal appeared whenever a draft was uploaded.
function python(root: string) {
  if (process.env.QUIRE_PYTHON) return process.env.QUIRE_PYTHON;
  const venv = path.join(root, "worker", ".venv");
  if (process.platform !== "win32") return path.join(venv, "bin", "python");
  const windowless = path.join(venv, "Scripts", "pythonw.exe");
  return fs.existsSync(/*turbopackIgnore: true*/ windowless) ? windowless : path.join(venv, "Scripts", "python.exe");
}

// True when it started one. Never throws: without a worker the header shows the queue as stalled.
export function ensureWorker(dataDir = dataDirectory()) {
  if (workerRunning(dataDir)) return false;
  // The worker lives beside web/, outside the app's own files: not something the build should trace.
  const root = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
  const py = python(root);
  if (!fs.existsSync(/*turbopackIgnore: true*/ py)) return false;
  try {
    const log = fs.openSync(path.join(dataDir, "worker.log"), "a");
    const child = spawn(/*turbopackIgnore: true*/ py, ["main.py", "--idle-exit", String(IDLE_EXIT_SECONDS)], {
      cwd: path.join(root, "worker"), detached: true, stdio: ["ignore", log, log], windowsHide: true,
    });
    child.unref();
    fs.closeSync(log);
    // Claimed at once, so a second request in the next moment doesn't start a second worker.
    if (child.pid) fs.writeFileSync(path.join(dataDir, "worker.pid"), String(child.pid));
    return true;
  } catch {
    return false;
  }
}
