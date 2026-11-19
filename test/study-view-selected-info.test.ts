// The Study View's selection line as cbioportal.org writes it (StudyResultsSummary, STV-AB-1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { portalSelectedInfo } from "../lib/chart/format.ts";

test("STV-AB-1: \"N patients | M samples\", \"Selected: \" only while the charts are filtered", () => {
  const cases: [number, number, boolean, string][] = [
    [594, 594, false, "594 patients | 594 samples"],                // seen: coadread
    [23, 61, false, "23 patients | 61 samples"],                    // seen: lgg
    [0, 0, true, "Selected: 0 patients | 0 samples"],               // seen: emptied by a filter
    [1678, 2000, true, "Selected: 1,678 patients | 2,000 samples"], // toLocaleString
  ];
  for (const [p, s, f, want] of cases) assert.equal(portalSelectedInfo(p, s, f), want);
});
