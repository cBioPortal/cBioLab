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
