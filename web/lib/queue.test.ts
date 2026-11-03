import { test } from "node:test";
import assert from "node:assert/strict";
import { currentStep, queueSteps, unfinished } from "./queue.ts";
import type { Draft } from "./db.ts";

const draft = (over: Partial<Draft>): Draft => ({
  id: 1, parentId: null, title: "Essay", createdAt: "2026-11-02T10:00:00Z", status: "ready", rejectReason: null,
  reportId: 1, reportStatus: "done", score: 0, aiStatus: "done", aiScore: 10, aiReason: null, waiting: false, ...over,
});

test("unfinished: being read, or either check still running; done and rejected drafts are not", () => {
  assert.equal(unfinished(draft({ status: "extracting" })), true);
  assert.equal(unfinished(draft({ reportStatus: "processing" })), true);
  assert.equal(unfinished(draft({ aiStatus: "queued" })), true);
  assert.equal(unfinished(draft({})), false);
  assert.equal(unfinished(draft({ reportStatus: "error" })), false);
});

test("queueSteps: reading, then searching and estimating, each with its state", () => {
  assert.deepEqual(queueSteps(draft({ status: "extracting" })).map((s) => s.state), ["active", "pending", "pending"]);
  assert.deepEqual(queueSteps(draft({ reportStatus: "processing", aiStatus: "unavailable" })).map((s) => s.state), ["done", "active", "skipped"]);
  assert.deepEqual(queueSteps(draft({ reportStatus: "error", aiStatus: "processing" })).map((s) => s.state), ["done", "failed", "active"]);
});

test("currentStep names the step running now, or says it is waiting for the worker", () => {
  assert.equal(currentStep(draft({ status: "extracting" })), "Reading the file");
  assert.equal(currentStep(draft({ reportStatus: "processing" })), "Searching the web for matching passages");
  assert.equal(currentStep(draft({ status: "extracting", waiting: true })), "Waiting for the worker");
});
