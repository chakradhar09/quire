import { test } from "node:test";
import assert from "node:assert/strict";
import { IDLE_MS, TICK_MS, idleTooLong } from "./alive.ts";

test("idleTooLong waits IDLE_MS after the last check-in", () => {
  const clock = { seen: 0, tick: 0 };
  for (let now = TICK_MS; now <= IDLE_MS; now += TICK_MS) assert.equal(idleTooLong(clock, now), false);
  assert.equal(idleTooLong(clock, IDLE_MS + TICK_MS), true);
});

test("idleTooLong starts the wait again after the PC slept", () => {
  const clock = { seen: 0, tick: 0 };
  assert.equal(idleTooLong(clock, 60 * 60_000), false); // an hour between ticks: asleep, not idle
  assert.equal(idleTooLong(clock, 60 * 60_000 + TICK_MS), false);
});
