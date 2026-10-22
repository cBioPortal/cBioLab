// A view result has only its own kind's fields (lib/types.ts ViewResultFields): checking `kind`
// narrows it, and reading another kind's field does not compile. The @ts-expect-error lines are the
// test: `next build` type-checks this file, and fails if one of them starts compiling.
import { test } from "node:test";
import assert from "node:assert/strict";
import { plainResult, type ViewResult } from "../lib/types.ts";

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
