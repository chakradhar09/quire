import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_BADGE_CLASS, AI_TEXT_CLASS, aiBand, band, paragraphs, segments } from "./report.ts";

test("band edges", () => {
  assert.deepEqual([0, 1, 24, 25, 49, 50, 74, 75, 100].map(band),
    ["none", "low", "low", "mid", "mid", "high", "high", "max", "max"]);
});

test("band follows the whole number shown: 0.4 reads 0% and is uncoloured, 24.6 reads 25% and is mid", () => {
  assert.deepEqual([0.4, 0.5, 24.4, 24.6].map(band), ["none", "low", "low", "mid"]);
});

test("aiBand edges: under 50 quiet, 50 to 79 mid, 80 and up high", () => {
  assert.deepEqual([0, 49, 50, 79, 80, 96, 100].map(aiBand), ["low", "low", "mid", "mid", "high", "high", "high"]);
});

test("aiBand follows the whole number shown: 79.6 reads 80% and is high", () => {
  assert.deepEqual([49.4, 49.6, 79.4, 79.6].map(aiBand), ["low", "mid", "mid", "high"]);
});

test("a score is the same colour as a list badge and as the report header number", () => {
  // The badge pairs background and text; the header number uses only the text colour of that pair.
  for (const b of ["mid", "high"] as const) assert.ok(AI_BADGE_CLASS[b].split(" ").includes(AI_TEXT_CLASS[b]), b);
  assert.equal(AI_TEXT_CLASS.low, "text-ai-solid");
});

test("segments: overlap goes to the best rank, gaps stay plain, neighbours merge", () => {
  const a = { id: "a", start: 2, end: 8, rank: 2 };
  const b = { id: "b", start: 5, end: 12, rank: 1 };
  const c = { id: "c", start: 12, end: 14, rank: 1 };
  const got = segments(20, [a, b, c]).map((s) => [s.start, s.end, s.span?.id ?? null]);
  assert.deepEqual(got, [
    [0, 2, null],
    [2, 5, "a"],
    [5, 12, "b"],
    [12, 14, "c"],
    [14, 20, null],
  ]);
});

test("segments: spans outside the text are clamped", () => {
  const got = segments(5, [{ id: "x", start: -3, end: 99, rank: 1 }]);
  assert.deepEqual(got.map((s) => [s.start, s.end]), [[0, 5]]);
});

test("paragraphs skip blank lines and keep offsets", () => {
  const text = "one\n\ntwo two\n";
  assert.deepEqual(paragraphs(text), [[0, 3], [5, 12]]);
  assert.equal(text.slice(5, 12), "two two");
});
