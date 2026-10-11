// /verification describes every checked statistic from lib/verification.ts; this keeps that list
// complete and pointing at real tests and fixtures, so the page cannot claim a check that is not run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { VERIFIED } from "../lib/method.ts";
import { STAT_CHECKS, COXNET_CHECK } from "../lib/verification.ts";

test("every method in VERIFIED is described on the page exactly once", () => {
  const listed = STAT_CHECKS.flatMap((c) => c.keys);
  for (const k of Object.keys(VERIFIED)) assert.equal(listed.filter((x) => x === k).length, 1, k);
  assert.equal(listed.length, Object.keys(VERIFIED).length, "nothing listed that VERIFIED does not hold");
});

test("every row names a golden test that exists and reads the fixture it names", () => {
  for (const c of [...STAT_CHECKS, COXNET_CHECK]) {
    assert.ok(existsSync(c.test), c.test);
    assert.match(readFileSync(c.test, "utf8"), new RegExp("fixtures/golden/" + c.fixture + "\\.json"), c.test + " reads " + c.fixture);
    const fixture = JSON.parse(readFileSync("test/fixtures/golden/" + c.fixture + ".json", "utf8"));
    for (const k of c.caseKeys) assert.ok(Array.isArray(fixture[k]) && fixture[k].length > 0, c.fixture + "." + k + " holds cases");
  }
});
