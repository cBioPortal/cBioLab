// lint/number-format-baseline.json: the files that still format numbers by hand, each with how many
// calls it may keep (eslint.config.mjs, local/number-format). The rule lowers a file's allowance as
// its calls go; this keeps the list itself honest about files that moved or were deleted.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const baseline = JSON.parse(fs.readFileSync(new URL("../lint/number-format-baseline.json", import.meta.url), "utf8")) as Record<string, number>;

test("every file the number-format baseline lists exists, with a positive allowance", () => {
  for (const [file, n] of Object.entries(baseline)) {
    assert.ok(fs.existsSync(new URL("../" + file, import.meta.url)), file + " is listed in lint/number-format-baseline.json but no longer exists: remove its entry");
    assert.ok(Number.isInteger(n) && n > 0, file + "'s allowance is " + n + ": a file with none left has no entry");
  }
});

test("the baseline lists no file the rule never reads, and none that defines the formats", () => {
  for (const file of Object.keys(baseline)) {
    assert.match(file, /^(lib\/.*\.ts|app\/.*\.tsx?|mcp\/.*\.ts)$/, file + " is outside the rule's files");
    assert.notEqual(file, "lib/chart/format.ts");
  }
});
