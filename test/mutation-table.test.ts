// The mutation table's OncoKB call (lib/mutation-table.ts mutationRowSource). Which call a row shows
// (its sample's tumour type's at the pin, else the gene-level one; case table rows T*, S*) is SQL, so
// it is run against the fixture study by scripts/check-oncokb-tumor-type.ts (npm run
// check:oncokb-tumor-type). What is checked here is which stores a table reads, which decides
// whether a warehouse without OncoKB can draw it at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mutationRowSource } from "../lib/mutation-table.ts";

const part = [{ cohort: "c", study: "paad_x", cohortSql: "SELECT 'P1' AS pid, 'S1' AS sid" }];
const PINS = { hg19: null, hg38: null };

test("S5 without an OncoKB pin the table reads neither OncoKB store, so a warehouse without them still answers", () => {
  assert.doesNotMatch(mutationRowSource(part, "db", "KRAS", null, PINS).with, /annotation\.oncokb/);
});

test("S3 S4 with a pin the table reads the tumour-type store and the gene-level one it falls back to", () => {
  const w = mutationRowSource(part, "db", "KRAS", "v7.7", PINS).with;
  assert.match(w, /annotation\.oncokb_tumor_type\b/);
  assert.match(w, /annotation\.oncokb\b(?!_)/);
});
