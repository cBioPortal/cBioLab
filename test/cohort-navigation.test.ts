// The Patient page stepping through a cohort (app/portal/cohort-navigation.ts): what its link
// carries, and the document that lists the cohort's patients.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { excludePatient, listDoc, navigationFromHash, navigationParams, studyViewParams, patientHref, readNavigation, sampleHref, NAV_COHORT } from "../app/portal/cohort-navigation.ts";
import type { CohortDef } from "../lib/types.ts";
import { readFilters } from "../lib/study-view-url.ts";

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
  test("a sample's link (the mutation table's sample ids) opens its sample view, with no cohort to step through", () => {
    const q = new URL("http://h" + sampleHref("coadread_tcga_pub", "TCGA-AA-3867-01")).searchParams;
    assert.deepEqual([...q.entries()], [["study", "coadread_tcga_pub"], ["sample", "TCGA-AA-3867-01"]]);
    assert.deepEqual(readNavigation(q), { nav: null, error: null });
  });
  test("a stored link holding exactly the cohort is carried as ?s= instead of the cohort, and reads back the same", () => {
    const cohort = navigationParams({ def, order: {} }).cohort;
    const link = { id: "abcdefghijklmnopqrstuv", params: { cohort } };
    const q = new URLSearchParams({ cohort, study: "a" });
    const nav = readNavigation(q, link).nav!;
    assert.equal(nav.link, link.id);
    assert.deepEqual(new URL("http://h" + patientHref({ study: "a", id: "P-1" }, nav, null)).searchParams.get("s"), link.id);
    assert.equal(new URL("http://h" + patientHref({ study: "a", id: "P-1" }, nav, null)).searchParams.get("cohort"), null);
    assert.equal(readNavigation(q, { ...link, params: { cohort, doc: "x" } }).nav!.link, undefined, "a link holding more than the cohort is not carried");
    assert.equal(readNavigation(q, { ...link, params: { cohort: cohort + "x" } }).nav!.link, undefined, "nor one holding another cohort");
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

// Legacy patient view: PAT-URL-4, PAT-URL-6, PAT-NAV-3, PAT-NAV-4 (docs/legacy-spec/40-patient-summary.md).
const A = { kind: "clinical", attribute: "SEX", values: ["Female"] } as NonNullable<CohortDef["all"]>[number];

describe("navigation from a legacy #navCaseIds hash", () => {
  test("H1: study-qualified ids become one patient list over that study", () => {
    assert.deepEqual(navigationFromHash("#navCaseIds=s1:P1,s1:P2"), {
      nav: { def: { study: "s1", all: [{ kind: "patientList", ids: ["s1:P1", "s1:P2"] }] }, order: {} },
      error: null,
    });
  });
  test("H2: ids from two studies give def.studies and no single study", () => {
    const { nav, error } = navigationFromHash("#navCaseIds=s1:P1,s2:P9");
    assert.equal(error, null);
    assert.deepEqual(nav!.def.studies, ["s1", "s2"]);
    assert.equal(nav!.def.study, undefined);
    assert.deepEqual(nav!.def.all, [{ kind: "patientList", ids: ["s1:P1", "s2:P9"] }]);
  });
  test("H3: no navCaseIds is not a navigation and not an error", () => {
    assert.deepEqual(navigationFromHash(""), { nav: null, error: null });
    assert.deepEqual(navigationFromHash("#foo=1"), { nav: null, error: null });
  });
  test("H4: an id without its study is refused, naming the id", () => {
    const { nav, error } = navigationFromHash("#navCaseIds=P1,s1:P2");
    assert.equal(nav, null);
    assert.match(error || "", /P1/);
  });
  test("H5: navCaseIds is found among other hash parameters", () => {
    const { nav } = navigationFromHash("#a=1&navCaseIds=s1:P1");
    assert.deepEqual(nav!.def.all, [{ kind: "patientList", ids: ["s1:P1"] }]);
  });
  test("H6: an empty navCaseIds names nothing to step through", () => {
    assert.equal(navigationFromHash("#navCaseIds=").nav, null);
  });
});

describe("excluding a patient from the cohort being stepped through", () => {
  const nav = { def: { study: "s1", all: [A] } as CohortDef, order: { search: "x" }, link: "abcdefghijklmnopqrstuv" };
  const P2 = { study: "s1", id: "P2" };
  const P3 = { study: "s1", id: "P3" };
  test("X1: appends a not-clause, keeps the order, drops the stored link", () => {
    const out = excludePatient(nav, P2);
    assert.deepEqual(out.def.all, [A, { not: { kind: "patientList", ids: ["s1:P2"] } }]);
    assert.deepEqual(out.order, { search: "x" });
    assert.equal(out.link, undefined);
  });
  test("X2: excluding twice merges into one trailing clause, the first clause kept first", () => {
    const out = excludePatient(excludePatient(nav, P2), P3);
    assert.deepEqual(out.def.all, [A, { not: { kind: "patientList", ids: ["s1:P2", "s1:P3"] } }]);
  });
  test("X3: the input navigation is not mutated", () => {
    const before = structuredClone(nav);
    excludePatient(nav, P2);
    assert.deepEqual(nav, before);
  });
  test("X4: a stored-set exclusion as the last clause is left alone and a new clause appended", () => {
    const setClause = { not: { kind: "patientList", set: "0b8b5f0e-1c1a-4a53-9a55-2f4f1f5d9c11" } };
    const withSet = { def: { study: "s1", all: [A, setClause] } as unknown as CohortDef, order: {} };
    const out = excludePatient(withSet, P2);
    assert.deepEqual(out.def.all, [A, setClause, { not: { kind: "patientList", ids: ["s1:P2"] } }]);
  });
  test("X5: excluding the same patient twice lists the id once", () => {
    const out = excludePatient(excludePatient(nav, P2), P2);
    assert.deepEqual(out.def.all, [A, { not: { kind: "patientList", ids: ["s1:P2"] } }]);
  });
});

describe("the study view parameters for a navigation", () => {
  const ok = (nav: { def: CohortDef; order: object }) => {
    const r = studyViewParams(nav);
    assert.ok("params" in r, "expected params, got " + JSON.stringify(r));
    return r.params;
  };
  test("V1: explore tab, the study, and the clauses as filters", () => {
    const p = ok({ def: { study: "s1", all: [A] } as CohortDef, order: {} });
    assert.equal(p.tab, "explore");
    assert.equal(p.study, "s1");
    assert.deepEqual(readFilters(new URLSearchParams(p), "")?.all, [A]);
  });
  test("V2: several studies are comma-separated", () => {
    assert.equal(ok({ def: { studies: ["s1", "s2"], all: [A] } as CohortDef, order: {} }).study, "s1,s2");
  });
  test("V3: a cohort with no clauses has no filters key", () => {
    assert.equal("filters" in ok({ def: { study: "s1", all: [] } as CohortDef, order: {} }), false);
  });
  test("V4: a definition with more than study/studies/all is refused, naming the extra keys", () => {
    const def = { study: "s1", all: [A], a: { kind: "event" }, lineGap: 30 } as unknown as CohortDef;
    const r = studyViewParams({ def, order: {} });
    assert.ok("refused" in r, "expected a refusal");
    assert.match(r.refused, /\ba\b/);
    assert.match(r.refused, /lineGap/);
  });
});
