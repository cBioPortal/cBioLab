// Which rows a survival endpoint is read from (lib/survival-sql.ts). A study's own outcome columns
// are patient-level and their SQL must not change; an uploaded column keyed by SAMPLE_ID is read per
// patient, and a patient whose samples disagree is refused instead of having one sample picked.
import { test } from "node:test";
import assert from "node:assert/strict";

import { endpointRowsSql, endpointValueSql } from "../lib/survival-sql.ts";
import { survivalCountsSql, coxRowsSql } from "../lib/survival-queries.ts";

test("a study's own columns: the caller's filter and value expression, unchanged", () => {
  assert.equal(endpointRowsSql("OS_MONTHS", "OS_STATUS", "type='patient'"), "type='patient'");
  assert.equal(endpointRowsSql("PFS_MONTHS", "PFS_STATUS", "type = 'patient'"), "type = 'patient'");
  assert.equal(endpointValueSql("OS_MONTHS"), "anyIf(attribute_value, attribute_name='OS_MONTHS')");
  assert.equal(endpointValueSql("OS_STATUS", " = "), "anyIf(attribute_value, attribute_name = 'OS_STATUS')");
});

test("uploaded columns: their sample-level rows are read too, and only theirs", () => {
  assert.equal(endpointRowsSql("custom:bm/ICPFS_TIME", "custom:bm/ICPFS_EVENT", "type='patient'"),
    "(type = 'patient' OR type = 'sample' AND attribute_name IN ('custom:bm/ICPFS_TIME', 'custom:bm/ICPFS_EVENT'))");
  // a study's months with an uploaded status: only the upload may come from samples
  assert.equal(endpointRowsSql("OS_MONTHS", "custom:bm/OS_EVENT", "type='patient'"),
    "(type = 'patient' OR type = 'sample' AND attribute_name IN ('custom:bm/OS_EVENT'))");
});

test("an uploaded column's value is refused when a patient's samples disagree", () => {
  const v = endpointValueSql("custom:bm/ICPFS_TIME");
  assert.match(v, /throwIf\(uniqExactIf\(trimBoth\(attribute_value\), attribute_name = 'custom:bm\/ICPFS_TIME'\) > 1, '/);
  assert.match(v, /different values of custom:bm\/ICPFS_TIME/);
  assert.match(v, /anyIf\(attribute_value, attribute_name = 'custom:bm\/ICPFS_TIME'\), ''\)$/);
});

test("the survival queries use them for uploaded columns, and stay as they were for OS", () => {
  const custom = { months: "custom:bm/ICPFS_TIME", status: "custom:bm/ICPFS_EVENT" };
  const counts = String(survivalCountsSql("SELECT 1", "s", "db", "ICPFS", custom));
  assert.match(counts, /type = 'sample' AND attribute_name IN \('custom:bm\/ICPFS_TIME', 'custom:bm\/ICPFS_EVENT'\)/);
  assert.equal((counts.match(/throwIf/g) || []).length, 2);
  const cox = String(coxRowsSql("SELECT 1", "s", "db", "ICPFS", [], custom));
  assert.match(cox, /type = 'sample'/);
  const os = String(survivalCountsSql("SELECT 1", "s", "db", "OS"));
  assert.doesNotMatch(os, /type = 'sample'|throwIf/);
  assert.match(os, /AND type='patient'\n/);
});
