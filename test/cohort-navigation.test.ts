// The Patient page stepping through a cohort (app/portal/cohort-navigation.ts): what its link
// carries, and the document that lists the cohort's patients.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { listDoc, navigationParams, patientHref, readNavigation, NAV_COHORT } from "../app/portal/cohort-navigation.ts";
import type { CohortDef } from "../lib/types.ts";

const def: CohortDef = { studies: ["a", "b"], all: [{ kind: "clinical", attribute: "SEX", values: ["Female"] }] } as CohortDef;

describe("a Patient page's cohort navigation", () => {
  test("the link carries the definition and the list's order, and reads back the same", () => {
    const nav = { def, order: { sort: { column: "AGE", desc: true }, search: "x" } };
    const href = patientHref({ study: "b", id: "P-1" }, nav, "Clinical Data");
    const q = new URL("http://h" + href).searchParams;
    assert.equal(q.get("study"), "b");
    assert.equal(q.get("patient"), "P-1");
    assert.equal(q.get("tab"), "Clinical Data");
    assert.deepEqual(readNavigation(q), { nav: { def, order: { sort: { column: "AGE", desc: true }, search: "x" } }, error: null });
  });
  test("no order, no order parameter; columns are the dialog's own and not carried", () => {
    assert.deepEqual(Object.keys(navigationParams({ def, order: {} })), ["cohort"]);
    assert.deepEqual(Object.keys(navigationParams({ def, order: { columns: ["patient"], filters: {} } })), ["cohort"]);
    assert.deepEqual(navigationParams(null), {});
  });
  test("a link without a cohort is not a navigation; one whose cohort does not decode says so", () => {
    assert.deepEqual(readNavigation(new URLSearchParams("study=a&patient=P")), { nav: null, error: null });
    assert.match(readNavigation(new URLSearchParams("cohort=%%%")).error || "", /cannot be read/);
  });
  test("the list is a per-patient table view over the cohort, naming the patient to place", () => {
    const d = listDoc({ def, order: { sort: { column: "AGE" } } }, { rows: 1, columns: ["patient"], at: { study: "a", id: "P-2" } });
    assert.equal(d.study, "a");
    assert.deepEqual(d.cohorts, { [NAV_COHORT]: def });
    assert.deepEqual(d.views, [{ kind: "table", unit: "patient", cohorts: [NAV_COHORT], rows: 1, columns: ["patient"], sort: { column: "AGE" }, patient: { study: "a", id: "P-2" } }]);
  });
});
