// Cohort-definition semantics that are easy to regress and expensive to get wrong.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compileCohortDef, describeCohortDef } from "../lib/cohort2.ts";

const ctx = { study: "s1", db: "db" };

describe("a cohort with no clauses is every patient in the study", () => {
  test("{all: []} compiles to exactly what an absent definition compiles to", () => {
    assert.equal(compileCohortDef({ all: [] }, ctx), compileCohortDef(null, ctx),
      "the two spellings of 'no filter' must not diverge");
  });
  test("...and reads back as such, so it cannot pass for a filter that did nothing", () => {
    assert.equal(describeCohortDef({ all: [] }), "all patients in the study");
    assert.equal(describeCohortDef(null), "all patients in the study");
  });
  test("the study base really is unfiltered SQL over that study", () => {
    const sql = compileCohortDef({ all: [] }, ctx);
    assert.match(sql, /FROM db\.sample_derived/);
    assert.match(sql, /cancer_study_identifier = 's1'/);
  });
  test("a filtered cohort still differs from the base", () => {
    assert.notEqual(compileCohortDef({ all: [{ kind: "oql", q: "TP53: MUT" }] }, ctx),
      compileCohortDef({ all: [] }, ctx));
  });
});

describe("clause-count bounds are still enforced", () => {
  test("more than 8 clauses is refused", () => {
    const nine = Array.from({ length: 9 }, () => ({ kind: "oql" as const, q: "TP53: MUT" }));
    assert.throws(() => compileCohortDef({ all: nine }, ctx), /0-8 clauses/);
  });
  test("a non-array clause list is refused", () => {
    assert.throws(() => compileCohortDef({ all: "nope" } as never, ctx), /0-8 clauses/);
  });
});
