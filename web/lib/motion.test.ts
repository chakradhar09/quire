import { test } from "node:test";
import assert from "node:assert/strict";
import { chain, enter, transit } from "./motion.ts";

test("chain: each step starts when the one before reaches its link point", () => {
  assert.deepEqual(chain([{ dur: 600, link: 0.5 }, { dur: 400, link: 0.25 }, { dur: 200 }]).map((s) => s.at), [0, 300, 400]);
});

test("chain: a step without a link waits for the one before to finish, and start offsets everything", () => {
  assert.deepEqual(chain([{ dur: 300 }, { dur: 100 }], 50).map((s) => s.at), [50, 350]);
});

test("chain: a hold is a rest after the link point, before the next step", () => {
  assert.deepEqual(chain([{ dur: 400, link: 0.5, hold: 150 }, { dur: 100 }]).map((s) => s.at), [0, 350]);
});

test("enter and transit carry the timing into CSS", () => {
  const s = { at: 120, dur: 500, ease: "enter" as const };
  assert.deepEqual(enter(s), { "--at": "120ms", "--dur": "500ms", "--ease": "var(--motion-enter)" });
  assert.deepEqual(transit(s), { transitionDelay: "120ms", transitionDuration: "500ms", transitionTimingFunction: "var(--motion-enter)" });
});
