import { test } from "node:test";
import assert from "node:assert/strict";
import { scrollFor, thumb, tick } from "./scrollbar.ts";

test("thumb size is the visible share of the track, never below the minimum, and hidden when nothing scrolls", () => {
  assert.deepEqual(thumb(0, 500, 1000, 500), { top: 0, height: 250, visible: true });
  assert.deepEqual(thumb(500, 500, 1000, 500), { top: 250, height: 250, visible: true });
  assert.equal(thumb(0, 500, 500, 500).visible, false);
  assert.equal(thumb(0, 100, 100000, 400).height, 28);
});

test("scrollFor inverts thumb: dragging to a thumb position gives the matching scrollTop, clamped", () => {
  assert.equal(scrollFor(250, 500, 1000, 500), 500);
  assert.equal(scrollFor(125, 500, 1000, 500), 250);
  assert.equal(scrollFor(-40, 500, 1000, 500), 0);
  assert.equal(scrollFor(900, 500, 1000, 500), 500);
  const t = thumb(321, 500, 1400, 500);
  assert.ok(Math.abs(scrollFor(t.top, 500, 1400, 500) - 321) < 1e-9);
});

test("tick places a passage on the track by its position in the document, with a minimum height", () => {
  assert.deepEqual(tick(500, 100, 1000, 500), { top: 250, height: 50 });
  assert.equal(tick(10, 1, 100000, 400).height, 3);
  const last = tick(999, 40, 1000, 500);
  assert.ok(last.top + last.height <= 500);
});
