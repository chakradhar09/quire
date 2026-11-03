import { test } from "node:test";
import assert from "node:assert/strict";
import type { Draft } from "./db.ts";
import { groupPapers, shortTitle, suggestPaper, titleStem, versionChange } from "./papers.ts";

const scored = (id: number, sim: number | null, ai: number | null, over: Partial<Draft> = {}): Draft => ({
  ...draft(id, null, "2026-10-31T10:00"),
  reportStatus: sim === null ? "queued" : "done", score: sim, aiStatus: ai === null ? "queued" : "done", aiScore: ai, ...over,
});

const draft = (id: number, parentId: number | null, createdAt: string, title = `Draft ${id}`): Draft => ({
  id, parentId, title, createdAt, status: "ready", rejectReason: null, reportId: null, reportStatus: null,
  score: null, aiStatus: null, aiScore: null, aiReason: null, waiting: false,
});

test("groupPapers follows parent links to one paper per chain, versions oldest first, newest paper first", () => {
  const papers = groupPapers([
    draft(3, 2, "2026-10-31T10:00", "Essay v3"),
    draft(1, null, "2026-10-29T10:00", "Essay v1"),
    draft(4, null, "2026-10-30T10:00", "Notes"),
    draft(2, 1, "2026-10-30T09:00", "Essay v2"),
  ]);
  assert.deepEqual(papers.map((p) => [p.id, p.title, p.versions.map((v) => v.id)]), [
    [1, "Essay v3", [1, 2, 3]],
    [4, "Notes", [4]],
  ]);
});

test("groupPapers treats a draft whose parent was deleted as the start of its own paper", () => {
  assert.deepEqual(groupPapers([draft(5, 99, "2026-10-31T10:00")]).map((p) => p.id), [5]);
});

test("titleStem drops version words and subtitles; suggestPaper matches on it", () => {
  assert.equal(titleStem("Research_Paper_v3_IEEE"), "research paper");
  assert.equal(titleStem("URBAN HEAT ISLANDS: A CITY SURVEY"), "urban heat islands");
  const papers = [{ id: 1, title: "Research_Paper_Draft_v2" }, { id: 7, title: "Coral reefs" }];
  assert.equal(suggestPaper("Research_Paper_IEEE_Format", papers), 1);
  assert.equal(suggestPaper("Something else", papers), undefined);
  assert.equal(suggestPaper("v2 final", papers), undefined);
});

test("versionChange gives from and to for each finished score that moved", () => {
  assert.deepEqual(versionChange(scored(1, 0, 72), scored(2, 3, 96)), { similarity: [0, 3], ai: [72, 96] });
  assert.deepEqual(versionChange(scored(1, 3.4, 72), scored(2, 3.2, 40)), { ai: [72, 40] }, "rounded scores that match are not a change");
});

test("versionChange ignores a score that is not finished on either side", () => {
  assert.deepEqual(versionChange(scored(1, 5, null), scored(2, null, 40)), {});
  assert.deepEqual(versionChange(scored(1, 5, 20), scored(2, 5, 20, { aiStatus: "unavailable", aiScore: null })), {});
  assert.deepEqual(versionChange(scored(1, 5, 20, { aiStatus: "error" }), scored(2, 5, 60)), {}, "a failed earlier check is not a baseline");
});

test("shortTitle keeps a short title, cuts a long one at a word with an ellipsis, and never exceeds the limit", () => {
  assert.equal(shortTitle("Coral reefs", 40), "Coral reefs");
  const cut = shortTitle("Urban Heat Islands and Street Trees: A Survey of Ten Indian Cities", 40);
  assert.equal(cut, "Urban Heat Islands and Street Trees: A…");
  assert.ok(cut.length <= 40);
  // One long unbroken word is cut mid-word rather than left whole.
  const word = shortTitle("Physics_Unit_3_Quantum_Mechanics_Notes", 20);
  assert.equal(word.length, 20);
  assert.ok(word.endsWith("…"));
  assert.equal(shortTitle("  padded  ", 40), "padded");
});
