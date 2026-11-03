import { test } from "node:test";
import assert from "node:assert/strict";
import { pasteStatus, titleFromText, wordCount } from "./intake.ts";

test("wordCount counts runs of letters or digits, not punctuation or spacing", () => {
  assert.equal(wordCount("  Coral reefs — cover   less than 1% of the floor.\n\nYet "), 10);
  assert.equal(wordCount(""), 0);
});

test("pasteStatus: empty, too short, ready, and too large", () => {
  assert.deepEqual(pasteStatus(""), { words: 0, ready: false, note: "Paste your draft, or drop a file on the sheet" });
  assert.deepEqual(pasteStatus("one two three"), { words: 3, ready: false, note: "3 words · at least 20 needed" });
  const enough = "word ".repeat(20);
  assert.deepEqual(pasteStatus(enough), { words: 20, ready: true, note: "20 words · ready" });
  const huge = "a".repeat(2 * 1024 * 1024 + 1);
  assert.equal(pasteStatus(huge).ready, false);
  assert.match(pasteStatus(huge).note, /over 2 MB/i);
});

test("pasteStatus groups thousands so a long paper reads easily", () => {
  assert.equal(pasteStatus("word ".repeat(12345)).note, "12,345 words · ready");
});

test("titleFromText takes the first line with words in it, cut at a word under 80 characters", () => {
  assert.equal(titleFromText("\n\n  # Urban Heat Islands  \nBody text"), "Urban Heat Islands");
  const long = "Coral reefs cover less than one percent of the ocean floor yet they support a quarter of all marine species";
  const t = titleFromText(long);
  assert.ok(t.length <= 80 && long.startsWith(t.replace(/…$/, "")) && t.endsWith("…"), t);
  assert.equal(titleFromText("   \n  "), "");
});
