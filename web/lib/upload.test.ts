import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_UPLOAD_BYTES, allowedOrigin, checkUpload, extensionOf, fileName, paperFromField, shortFileName, titleError, titleFromFile } from "./upload.ts";

test("checkUpload accepts the five formats in any case", () => {
  for (const name of ["a.docx", "b.PDF", "c.rtf", "d.odt", "e.Txt"]) assert.equal(checkUpload(name, 10), null, name);
});

test("checkUpload refuses other types, empty files and files over 50 MB", () => {
  assert.match(checkUpload("essay.pages", 10) ?? "", /essay\.pages is not a file type Quire can read/);
  assert.match(checkUpload("essay", 10) ?? "", /not a file type/);
  assert.match(checkUpload("essay.docx", 0) ?? "", /essay\.docx is empty/);
  assert.equal(checkUpload("essay.docx", MAX_UPLOAD_BYTES), null);
  assert.match(checkUpload("essay.docx", MAX_UPLOAD_BYTES + 1) ?? "", /over 50 MB/);
});

test("titleError wants 1 to 300 characters after trimming", () => {
  assert.equal(titleError("  Coral essay "), null);
  assert.equal(titleError("   "), "Give the draft a title.");
  assert.equal(titleError("x".repeat(301)), "Keep the title to 300 characters or fewer.");
});

test("allowedOrigin only lets Quire's own pages post", () => {
  assert.ok(allowedOrigin("http://127.0.0.1:3000"));
  assert.ok(allowedOrigin("http://localhost:3000"));
  assert.ok(!allowedOrigin("http://evil.test"));
  assert.ok(!allowedOrigin("http://127.0.0.1:3000.evil.test"));
  assert.ok(!allowedOrigin("null"), "sandboxed iframes and some redirects send Origin: null");
  assert.ok(!allowedOrigin(null), "a missing Origin is refused too");
});

test("fileName keeps only the last part of a path, from either kind of slash", () => {
  assert.equal(fileName("../../evil.docx"), "evil.docx");
  assert.equal(fileName("C:\\Users\\me\\Essay draft.docx"), "Essay draft.docx");
  assert.equal(fileName("  notes.txt "), "notes.txt");
});

test("extensionOf and titleFromFile", () => {
  assert.equal(extensionOf("Draft.Final.DOCX"), ".docx");
  assert.equal(extensionOf("README"), "");
  assert.equal(titleFromFile("Coral reef essay, draft 2.docx"), "Coral reef essay, draft 2");
  assert.equal(titleFromFile(`${"x".repeat(400)}.pdf`).length, 300);
});

test("titleFromFile turns a machine-style file name into words", () => {
  assert.equal(titleFromFile("Lab_Report_2_SoilErosionSurvey.docx"), "Lab Report 2 Soil Erosion Survey");
  assert.equal(titleFromFile("coral-reef-essay__v3.pdf"), "coral reef essay v3");
  // A name that already has spaces is the writer's own: hyphens, McNames and IEEE stay.
  assert.equal(titleFromFile("Self-driving cars, McDonald v2.docx"), "Self-driving cars, McDonald v2");
  assert.equal(titleFromFile("IEEE_paper.pdf"), "IEEE paper");
});

test("paperFromField reads a paper id from a form field; anything else starts a new paper", () => {
  assert.equal(paperFromField("12"), 12);
  assert.equal(paperFromField(" 7 "), 7);
  for (const v of ["", "new", "0", "-3", "1.5", "12abc", "1e3", null, undefined, new File([], "x")]) {
    assert.equal(paperFromField(v), undefined, String(v));
  }
});

test("shortFileName keeps a short name, and cuts the middle of a long one so the extension stays", () => {
  assert.equal(shortFileName("essay.docx", 30), "essay.docx");
  const cut = shortFileName("Lab_Report_2_SoilErosion_final_version.pdf", 30);
  assert.equal(cut.length, 30);
  assert.ok(cut.endsWith(".pdf"));
  assert.ok(cut.startsWith("Lab_Report"));
  assert.ok(cut.includes("…"));
  assert.equal(shortFileName("a-very-long-name-without-extension-at-all-really", 20).length, 20);
});
