import { test } from "node:test";
import assert from "node:assert/strict";
import { newer } from "./updates.ts";

test("newer compares release tags with this copy's version", () => {
  assert.equal(newer("v0.2.0", "0.1.0"), true);
  assert.equal(newer("v1.10.0", "1.9.2"), true, "numbers, not text");
  assert.equal(newer("0.1.0", "0.1.0"), false);
  assert.equal(newer("v0.1.0", "0.2.0"), false);
  assert.equal(newer("1.0.0", "1.0.0-beta"), true, "a release beats its pre-release");
  assert.equal(newer("1.0.0-beta", "1.0.0"), false);
  assert.equal(newer("1.1", "1.0.9"), true, "missing parts count as 0");
});
