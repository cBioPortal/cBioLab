// A plot axis's title as the portal writes it (PLT-DT-19; cbioportal-frontend cd8c6df
// PlotsTabUtils.tsx getAxisLabel): a profile axis is named "GENE: <what it reads>" from the study's
// own description of the profile.
// Case table: rows T1–T6; T7–T10 run live in scripts/check-plot-stats.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { axisLabel } from "../lib/plot.ts";

// T1–T4 (a profile axis's portal title) are asserted in test/plot-profile.test.ts, and a directly written
// alteration axis's title in test/clinical-titles.test.ts (A1–A5).
test("T6 a clinical axis with no display name known is titled by its attribute id", () => {
  assert.equal(axisLabel({ source: "clinical", attribute: "MUTATION_COUNT" }), "MUTATION_COUNT");
});
