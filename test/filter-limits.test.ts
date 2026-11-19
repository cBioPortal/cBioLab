// How much one filter clause holds (lib/filter-limits.ts): the compiler's limits, and the refusal the
// page shows before applying a selection past one, naming it (CLAUDE.md invariant 1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ANY_LEAF_LIMIT, ASSAY_VALUES_LIMIT, CLINICAL_VALUES_LIMIT, limitRefusal } from "../lib/filter-limits.ts";
import { compileCohortDef } from "../lib/cohort2.ts";

test("the limits the compiler holds a clause to", () => {
  assert.deepEqual([ANY_LEAF_LIMIT, CLINICAL_VALUES_LIMIT, ASSAY_VALUES_LIMIT], [8, 50, 20]);
});

test("at the limit nothing is refused; past it the refusal names the limit and the count", () => {
  const cases: [number, number, string, string | null][] = [
    [8, ANY_LEAF_LIMIT, "alternatives", null],
    [9, ANY_LEAF_LIMIT, "alternatives", "one filter holds at most 8 alternatives; 9 are checked"],
    [50, CLINICAL_VALUES_LIMIT, "values", null],
    [200, CLINICAL_VALUES_LIMIT, "values", "one filter holds at most 50 values; 200 are checked"],
    [20, ASSAY_VALUES_LIMIT, "values", null],
    [30, ASSAY_VALUES_LIMIT, "values", "one filter holds at most 20 values; 30 are checked"],
  ];
  for (const [n, limit, what, want] of cases) assert.equal(limitRefusal(n, limit, what), want, n + " " + what);
});

test("the compiler refuses an any clause past ANY_LEAF_LIMIT, naming it", () => {
  const leaf = { kind: "caseList", id: "all" };
  assert.throws(() => compileCohortDef({ all: [{ any: Array(ANY_LEAF_LIMIT + 1).fill(leaf) }] } as never, { study: "s1", db: "cbio" }), /any: 1-8 leaves/);
  assert.doesNotThrow(() => compileCohortDef({ all: [{ any: Array(ANY_LEAF_LIMIT).fill(leaf) }] } as never, { study: "s1", db: "cbio" }));
});

test("the compiler refuses a values list past its limit, naming it, rather than cutting it short (invariant 1)", () => {
  const ctx = { study: "s1", db: "cbio", profiles: ["gistic"], gaProfiles: ["armlevel_cna"] };
  const vals = (n: number) => Array.from({ length: n }, (_, i) => "v" + i);
  const one = (leaf: unknown) => () => compileCohortDef({ all: [leaf] } as never, ctx);
  const cases: [string, (n: number) => unknown, number, RegExp][] = [
    ["clinical", (n) => ({ kind: "clinical", attribute: "CANCER_TYPE", values: vals(n) }), CLINICAL_VALUES_LIMIT,
      /clinical clause on CANCER_TYPE: at most 50 values; this lists 51/],
    ["genomicData", (n) => ({ kind: "genomicData", gene: "KRAS", profileType: "gistic", values: vals(n) }), ASSAY_VALUES_LIMIT,
      /genomicData clause on KRAS: at most 20 values; this lists 21/],
    ["genericAssay", (n) => ({ kind: "genericAssay", profileType: "armlevel_cna", entity: "1p", values: vals(n) }), ASSAY_VALUES_LIMIT,
      /genericAssay clause on 1p: at most 20 values; this lists 21/],
  ];
  for (const [kind, leaf, limit, refusal] of cases) {
    assert.doesNotThrow(one(leaf(limit)), kind + " at its limit");
    assert.throws(one(leaf(limit + 1)), refusal, kind + " one past it");
    assert.ok(compileCohortDef({ all: [leaf(limit)] } as never, ctx).includes("'v" + (limit - 1) + "'"), kind + ": every value at the limit is in the SQL");
  }
});
