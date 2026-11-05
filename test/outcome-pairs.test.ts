// The outcomes a survival or incidence card offers from an upload (app/lab/outcome-pairs.ts): a
// <X>_TIME or <X>_MONTHS column beside a status column of the same prefix and dataset.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COMPETING_STATUS, SURVIVAL_STATUS, endpointName, endpointText, pairValue, parsePairValue, uploadedOutcomePairs
} from "../app/lab/outcome-pairs.ts";

const attrs = ["OS_MONTHS", "OS_STATUS", "custom:bm/ICPFS_TIME", "custom:bm/ICPFS_EVENT", "custom:bm/ICPFS_EVENTCR",
  "custom:bm/ICPFS_EVENT_CAUSE_SPECIFIC", "custom:bm/LMD_TIME", "custom:bm/LMD_EVENTCR", "custom:bm/AGE_NUM",
  "custom:other/PFS_MONTHS", "custom:other/PFS_STATUS", "custom:bm/PFS_STATUS"].map((attribute) => ({ attribute }));

test("survival pairs: an upload's time beside its event or status columns, within one dataset", () => {
  assert.deepEqual(uploadedOutcomePairs(attrs, SURVIVAL_STATUS).map((p) => [p.name, p.months, p.status]), [
    ["ICPFS", "custom:bm/ICPFS_TIME", "custom:bm/ICPFS_EVENT"],
    ["ICPFS", "custom:bm/ICPFS_TIME", "custom:bm/ICPFS_EVENT_CAUSE_SPECIFIC"],
    ["PFS", "custom:other/PFS_MONTHS", "custom:other/PFS_STATUS"]
  ]);
  // the study's own OS pair is the endpoint chooser's already; bm's PFS_STATUS has no PFS time in bm
});

test("competing-risks pairs read the EVENTCR columns only", () => {
  assert.deepEqual(uploadedOutcomePairs(attrs, COMPETING_STATUS).map((p) => p.status),
    ["custom:bm/ICPFS_EVENTCR", "custom:bm/LMD_EVENTCR"]);
  assert.equal(uploadedOutcomePairs(attrs, COMPETING_STATUS)[0].label, "ICPFS_EVENTCR over ICPFS_TIME (custom: bm)");
});

test("an endpoint name is what `endpoint` accepts", () => {
  assert.equal(endpointName("icpfs"), "ICPFS");
  assert.equal(endpointName("2nd-line pfs"), "ND_LINE_PFS");
  assert.equal(endpointName("123"), "CUSTOM");
});

test("a column pair survives the chooser's value and back; anything else is not a pair", () => {
  assert.deepEqual(parsePairValue(pairValue("custom:bm/ICPFS_TIME", "custom:bm/ICPFS_EVENT")),
    { months: "custom:bm/ICPFS_TIME", status: "custom:bm/ICPFS_EVENT" });
  assert.equal(parsePairValue("OS"), null);
});

test("a subtitle names the endpoint a view reads", () => {
  assert.equal(endpointText({}), "OS");
  assert.equal(endpointText({ endpoint: "PFS" }), "PFS");
  assert.equal(endpointText({ endpoint: "ICPFS", monthsAttribute: "custom:bm/ICPFS_TIME", statusAttribute: "custom:bm/ICPFS_EVENT" }), "ICPFS");
  assert.equal(endpointText({ monthsAttribute: "custom:bm/ICPFS_TIME", statusAttribute: "custom:bm/ICPFS_EVENT" }), "ICPFS_EVENT");
});
