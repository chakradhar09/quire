import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workerRunning } from "./worker.ts";

test("workerRunning reads data/worker.pid and checks that the process is alive", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quire-worker-"));
  assert.equal(workerRunning(dir), false); // no file
  fs.writeFileSync(path.join(dir, "worker.pid"), String(process.pid));
  assert.equal(workerRunning(dir), true);
  fs.writeFileSync(path.join(dir, "worker.pid"), "2147483646"); // a crash left a pid no process has
  assert.equal(workerRunning(dir), false);
  fs.writeFileSync(path.join(dir, "worker.pid"), "not a pid");
  assert.equal(workerRunning(dir), false);
  // Left from before a crash or a reboot: a live pid no longer counts once the worker stopped touching the file.
  fs.writeFileSync(path.join(dir, "worker.pid"), String(process.pid));
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(path.join(dir, "worker.pid"), old, old);
  assert.equal(workerRunning(dir), false);
  fs.rmSync(dir, { recursive: true });
});
