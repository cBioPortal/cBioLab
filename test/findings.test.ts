// A view's findings (lib/findings.ts, lib/view-findings.ts): the kind's own names where it states
// them, the method record's checks where it does not, `checked` only where that check exists, and
// nothing for a result with nothing to report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./support/tsx-loader.mjs", import.meta.url);
const { viewFindings } = await import("../lib/view-findings.ts");
const { FINDINGS_VERSION } = await import("../lib/findings.ts");

const curve = (cohort: string, n: number, events: number, median: number | null) => ({ cohort, n, events, median, points: [] });
const logrank = { chi2: 12.5, p: 4e-4, df: 1, observed: [30, 20], expected: [22, 28], variance: 5, strata: 1 };

test("survival: named per cohort and for the test, each marked with the check that recomputes it", () => {
  const v: any = { kind: "survival", curves: [curve("a", 100, 40, 18.2), curve("b", 80, 20, null)], logrank, caveat: "read me",
    method: { steps: [], implementation: { functions: [], file: "", commit: null },
      check: { "km:a:n": { v: 100 }, "km:a:events": { v: 40 }, "km:a:median": { v: 18.2 }, "km:b:n": { v: 80 }, "logrank:p": { v: 4e-4 } } } };
  const f = viewFindings(v)!;
  assert.equal(f.version, FINDINGS_VERSION);
  assert.equal(f.source, "kind");
  assert.equal(f.caveat, "read me");
  const by = (name: string, cohort?: string) => f.findings.find((x) => x.name === name && x.cohort === cohort);
  assert.deepEqual(by("median_months", "a"), { name: "median_months", value: 18.2, cohort: "a", unit: "months", checked: "km:a:median" });
  // a median never reached is null, not a number; and no check is claimed where none exists
  assert.deepEqual(by("median_months", "b"), { name: "median_months", value: null, cohort: "b", unit: "months" });
  assert.equal(by("logrank_p")!.checked, "logrank:p");
  assert.equal(by("logrank_p")!.test, "log-rank");
  assert.equal(by("logrank_chi2")!.checked, undefined);
});

test("compare: percentages from the counts, unrounded, and the test named by the number of cohorts", () => {
  const cell = (cohort: string, profiled: number, any: number, driver: number) =>
    ({ cohort, profiled, any, driver, anyPct: Math.round(1000 * any / profiled) / 10, driverPct: null, byType: {} });
  const v: any = { kind: "compare", rows: [{ gene: "TP53", cells: [cell("a", 3, 1, 1), cell("b", 7, 2, 0)], pAny: 0.5 }] };
  const f = viewFindings(v)!;
  const pct = f.findings.find((x) => x.name === "pct_altered" && x.cohort === "a")!;
  assert.equal(pct.value, 100 / 3);
  assert.equal(f.findings.find((x) => x.name === "p_altered")!.test, "Fisher's exact");
  assert.equal(f.findings.some((x) => x.name === "q_altered"), false);
});

test("a kind without its own findings falls back to its method checks, under the script's names", () => {
  const v: any = { kind: "cox", rows: [], method: { steps: [], implementation: { functions: [], file: "", commit: null }, check: { "cox:age:hr": { v: 1.02 } } } };
  assert.deepEqual(viewFindings(v), { version: FINDINGS_VERSION, kind: "cox", source: "method-check", findings: [{ name: "cox:age:hr", value: 1.02, checked: "cox:age:hr" }] });
});

test("nothing for an error, an empty view, or a view with no numbers", () => {
  assert.equal(viewFindings({ kind: "survival", error: "no" } as any), null);
  assert.equal(viewFindings({ kind: "survival", empty: true } as any), null);
  assert.equal(viewFindings({ kind: "cox", rows: [] } as any), null);
});
