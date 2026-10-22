// A view result has only its own kind's fields (lib/types.ts ViewResultFields): checking `kind`
// narrows it, and reading another kind's field does not compile. A drawn result carries its kind's
// main field (ViewResultMain), so once isDrawn() holds it is read without a `!`. The @ts-expect-error lines are the
// test: `next build` type-checks this file, and fails if one of them starts compiling.
import { test } from "node:test";
import assert from "node:assert/strict";
import { plainResult, isDrawn, type ViewResult } from "../lib/types.ts";

const results: ViewResult[] = [
  { kind: "survival", curves: [] },
  { kind: "cox", cox: { coefficients: [], n: 0, events: 0 }, endpoint: "OS" },
  plainResult("riskmodel", { error: "refused" }),
];

test("checking kind narrows a result to its kind's fields, and no other kind's", () => {
  for (const v of results) {
    if (v.kind === "survival") {
      assert.deepEqual(v.curves, []);
      // @ts-expect-error a survival result has no Cox fit
      void v.cox;
    } else if (v.kind === "cox") {
      assert.equal(v.endpoint, "OS");
      // @ts-expect-error a Cox result has no curves
      void v.curves;
    }
    // @ts-expect-error before narrowing, no kind's own field can be read
    void v.riskmodel;
  }
});

test("a result for a kind known only at run time carries only the common fields", () => {
  assert.deepEqual(plainResult("riskmodel", { error: "refused" }), { kind: "riskmodel", error: "refused" });
});

test("a drawn result carries its kind's main field; isDrawn() is what proves it", () => {
  // @ts-expect-error a Cox result that neither failed nor waits must carry its fit
  const missing: ViewResult = { kind: "cox", cohorts: [] };
  void missing;
  for (const v of results) {
    if (isDrawn(v) && v.kind === "cox") assert.equal(v.cox.n, 0);
    // @ts-expect-error without isDrawn, a refused Cox view may have no fit
    if (v.kind === "cox") void v.cox.n;
  }
  assert.equal(results.filter(isDrawn).length, 2, "the refusal is not drawn");
  assert.equal(isDrawn(plainResult("survival", { empty: true })), false, "nor is a view waiting for cohorts");
});
