import { test } from "node:test";
import assert from "node:assert/strict";
import { browsePapers, hideVersions, type PaperKeys } from "./browse.ts";

test("hideVersions takes deleted versions out; a paper with none left goes, and a changed one loses its change line", () => {
  const card = (id: number, versions: number[]) => ({ id, versions: versions.map((v) => ({ id: v })), change: { ai: [10, 20] } });
  const cards = [card(1, [1, 4]), card(2, [2]), card(3, [3])];
  assert.equal(hideVersions(cards, new Set()), cards);
  assert.deepEqual(hideVersions(cards, new Set([4, 2])), [{ id: 1, versions: [{ id: 1 }], change: null }, cards[2]]);
});

const p = (id: number, keys: Partial<PaperKeys>) => ({ id, keys: { title: "", titles: [], ids: [id], newest: id, ai: null, similarity: null, ...keys } });
const papers = [
  p(1, { title: "Lab_Report_1_SoilErosion", titles: ["Lab_Report_1_SoilErosion"], ai: 68, similarity: 0, newest: 10 }),
  p(2, { title: "Urban Heat Islands", titles: ["Urban Heat Islands", "URBAN HEAT ISLANDS v1"], ai: 100, similarity: 1, newest: 30 }),
  p(3, { title: "Research_Paper_IEEE_Format", titles: ["Research_Paper_IEEE_Format"], ai: null, similarity: 4, newest: 20 }),
];

test("search matches every word in any version's title, case and underscores ignored", () => {
  assert.deepEqual(browsePapers(papers, "soil erosion", "newest").map((x) => x.id), [1]);
  assert.deepEqual(browsePapers(papers, "islands V1", "newest").map((x) => x.id), [2]);
  assert.deepEqual(browsePapers(papers, "nothing like this", "newest"), []);
  // CamelCase inside a file name counts as separate words, so a query can stop at a word boundary.
  assert.deepEqual(browsePapers(papers, "report 1 soil", "newest").map((x) => x.id), [1]);
});

test("search also finds an entry number, with or without the zeros", () => {
  assert.deepEqual(browsePapers(papers, "No. 003", "newest").map((x) => x.id), [3]);
  assert.deepEqual(browsePapers(papers, "3", "newest").map((x) => x.id), [3]);
});

test("sorts: newest first, highest AI or similarity first with unknown last, title A to Z", () => {
  assert.deepEqual(browsePapers(papers, "", "newest").map((x) => x.id), [2, 3, 1]);
  assert.deepEqual(browsePapers(papers, "", "ai").map((x) => x.id), [2, 1, 3]);
  assert.deepEqual(browsePapers(papers, "", "similarity").map((x) => x.id), [3, 2, 1]);
  assert.deepEqual(browsePapers(papers, "", "title").map((x) => x.id), [1, 3, 2]);
});
