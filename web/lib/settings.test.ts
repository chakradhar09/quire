import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { braveKeyError, maskedKey, readSettings, writeSettings } from "./settings.ts";

test("settings default to nothing set, and saving one setting keeps the others", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quire-settings-"));
  assert.deepEqual(readSettings(dir), { autoUpdate: false, braveApiKey: "" });
  writeSettings({ braveApiKey: "  BSAabcdefghijklmnop1234 " }, dir);
  writeSettings({ autoUpdate: true }, dir);
  assert.deepEqual(readSettings(dir), { autoUpdate: true, braveApiKey: "BSAabcdefghijklmnop1234" });
  fs.writeFileSync(path.join(dir, "settings.json"), "{ not json");
  assert.deepEqual(readSettings(dir), { autoUpdate: false, braveApiKey: "" });
  fs.rmSync(dir, { recursive: true });
});

test("a Brave key is one word of letters and digits; the page only ever shows its last four", () => {
  assert.equal(braveKeyError("BSAabcdefghijklmnop1234"), null);
  assert.match(braveKeyError("") ?? "", /Paste a key/);
  assert.match(braveKeyError("BRAVE_API_KEY=BSAabc def") ?? "", /doesn't look like/);
  assert.equal(maskedKey("BSAabcdefghijklmnop1234"), "••••••••1234");
  assert.equal(maskedKey(""), "");
});
