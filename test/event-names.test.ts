// A clinical value's fold and its kept spelling (lib/event-names.ts), as cbioportal.org's study view
// merges values case-insensitively and keeps the greatest spelling (STS-STM-1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { clinicalValueFold, keptSpelling } from "../lib/event-names.ts";

test("STS-STM-1: a clinical value folds as the SQL folds it, and keeps the portal's spelling, the greatest", () => {
  assert.equal(clinicalValueFold("  FeMale "), "female");
  const cases: [string[], string][] = [[["TRUE", "true"], "true"], [["Active", "active"], "active"], [["Unknown", "unknown", "UNKNOWN"], "unknown"],
    [["Not Stated", "Not stated"], "Not stated"], [["CSF", "csf"], "csf"], [["Female", "FEMALE"], "Female"]];
  for (const [spellings, want] of cases) assert.equal(spellings.slice(1).reduce(keptSpelling, spellings[0]), want, spellings.join(" / "));
});
