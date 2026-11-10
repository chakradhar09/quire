import { test } from "node:test";
import assert from "node:assert/strict";
import { windowCommand } from "./scripts.ts";

test("windowCommand quotes the script path for PowerShell, apostrophes included", () => {
  const c = windowCommand(String.raw`C:\Users\O'Neil\AppData\Local\Quire\app\scripts\uninstall.ps1`, " -Pause");
  assert.ok(c.startsWith(String.raw`try { & 'C:\Users\O''Neil\AppData\Local\Quire\app\scripts\uninstall.ps1' -Pause }`));
});
