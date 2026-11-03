import { test } from "node:test";
import assert from "node:assert/strict";
import { buildItems, decide, keyOf, progress, step } from "./resolve.ts";

const m = (id: number, start: number, end: number, over: object = {}) =>
  ({ id, start, end, rank: 1, hidden: null, excluded: false, ...over });

test("buildItems lists counted matches and AI passages in document order, a match first when they start together", () => {
  const items = buildItems({
    matches: [m(1, 50, 60), m(2, 10, 20)],
    ai: [{ start: 10, end: 40 }, { start: 70, end: 90 }],
    resolutions: [],
  });
  assert.deepEqual(items.map((i) => [i.kind, i.start]), [["match", 10], ["ai", 10], ["match", 50], ["ai", 70]]);
  assert.ok(items.every((i) => i.state === "open"));
});

test("buildItems takes each item's state from its saved resolution, matched by kind and exact range", () => {
  const items = buildItems({
    matches: [m(1, 10, 20), m(2, 30, 40)],
    ai: [{ start: 10, end: 20 }],
    resolutions: [
      { kind: "match", start: 10, end: 20, state: "cited" },
      { kind: "ai", start: 10, end: 20, state: "kept" },
      { kind: "match", start: 30, end: 41, state: "rewritten" }, // the range moved after a rescore: no longer applies
    ],
  });
  assert.deepEqual(items.map((i) => i.state), ["cited", "kept", "open"]);
});

test("buildItems shows an excluded match as excluded, leaves out uncounted ones, and keeps one item per range", () => {
  const items = buildItems({
    matches: [
      m(1, 10, 20, { excluded: true, hidden: "excluded" }),
      m(2, 30, 40, { rank: null }),
      m(3, 50, 60, { hidden: "quoted" }),
      m(4, 70, 80), m(5, 70, 80, { rank: 2 }),
    ],
    ai: [],
    resolutions: [{ kind: "match", start: 10, end: 20, state: "cited" }],
  });
  assert.deepEqual(items.map((i) => [i.start, i.state, i.matchId]), [[10, "excluded", 1], [70, "open", 4]]);
});

test("progress counts every decided item, excluded included", () => {
  const items = buildItems({
    matches: [m(1, 0, 5), m(2, 10, 15, { excluded: true }), m(3, 20, 25)], ai: [{ start: 30, end: 35 }],
    resolutions: [{ kind: "match", start: 0, end: 5, state: "rewritten" }],
  });
  assert.deepEqual(progress(items), { done: 2, total: 4 });
  assert.deepEqual(progress([]), { done: 0, total: 0 });
});

test("step moves to the neighbouring item and stops at the ends", () => {
  const items = buildItems({ matches: [m(1, 0, 5), m(2, 10, 15)], ai: [], resolutions: [] });
  const [a, b] = items.map((i) => i.key);
  assert.equal(step(items, undefined, 1), a);
  assert.equal(step(items, a, 1), b);
  assert.equal(step(items, b, 1), b);
  assert.equal(step(items, b, -1), a);
  assert.equal(step(items, a, -1), a);
  assert.equal(step([], undefined, 1), undefined);
});

test("decide maps a key to a decision for the kind of item; z undoes; others do nothing", () => {
  assert.deepEqual(["c", "r", "e", "p", "z", "x"].map((k) => decide(k, "match")), ["cited", "rewritten", "excluded", undefined, null, undefined]);
  assert.deepEqual(["c", "r", "e", "p", "z"].map((k) => decide(k, "ai")), [undefined, "rewritten", undefined, "kept", null]);
  assert.equal(decide("C", "match"), "cited");
  assert.equal(keyOf("ai", 3, 9), "ai:3:9");
});
