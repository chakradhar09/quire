// Stopping Quire. Every open page checks in (POST /api/alive, components/keep-alive.tsx); once none has for
// IDLE_MS the app stops by itself, and the worker follows after its own five idle minutes. The Settings page's
// Stop button stops both at once. Only a production build stops by itself: `npm run dev` keeps running.
import fs from "node:fs";
import path from "node:path";
import { dataDirectory } from "./db.ts";
import { workerRunning } from "./worker.ts";

export const TICK_MS = 30_000;
export const IDLE_MS = 3 * 60_000;

export type Clock = { seen: number; tick: number };

// Called every TICK_MS: true when no page has checked in for idleMs. A gap between ticks much longer than
// TICK_MS means the PC slept, and its pages slept with it, so the wait starts again.
export function idleTooLong(clock: Clock, now: number, idleMs = IDLE_MS, tickMs = TICK_MS) {
  if (now - clock.tick > 2 * tickMs) clock.seen = now;
  clock.tick = now;
  return now - clock.seen > idleMs;
}

const g = globalThis as { quireAlive?: Clock };

// A page is open. The first check-in starts the idle watch.
export function pageSeen() {
  const now = Date.now();
  if (!g.quireAlive) {
    g.quireAlive = { seen: now, tick: now };
    if (process.env.NODE_ENV === "production") {
      setInterval(() => { if (idleTooLong(g.quireAlive!, Date.now())) stopQuire({ worker: false }); }, TICK_MS).unref();
    }
  }
  g.quireAlive.seen = now;
}

// Stops this server, and with worker: true the worker too (a check it was running is queued again on the next
// start). The exit waits a moment so the reply to the Stop button gets out first.
export function stopQuire({ worker }: { worker: boolean }, dataDir = dataDirectory()) {
  // Only a worker whose pid file is current: after a crash or a reboot the id in a stale one may be another
  // program's by now (lib/worker.ts).
  if (worker && workerRunning(dataDir)) {
    try {
      process.kill(Number(fs.readFileSync(path.join(dataDir, "worker.pid"), "utf8")));
      fs.rmSync(path.join(dataDir, "worker.pid"), { force: true });
    } catch {
      // no worker running
    }
  }
  setTimeout(() => process.exit(0), 300);
}
