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

describe("derived buckets OR into one scan", () => {
  const ctx = { study: "x", db: "db" };
  const leaf = (range: Record<string, number>) => ({ kind: "derived" as const, metric: "followupMonths" as const, range });

  test("buckets of one metric compile to a single pass with OR'd ranges", () => {
    // The generic `any` path unions the leaves, and each derived leaf recomputes
    // the metric over the whole study — four buckets meant four scans, and
    // Explore went 4.7s -> 13.3s as buckets were ticked.
    const sql = compileCohortDef({ all: [{ any: [leaf({ lt: 6 }), leaf({ gte: 6, lt: 12 }), leaf({ gte: 12 })] }] }, ctx);
    assert.equal((sql.match(/clinical_event/g) || []).length, 1, "the metric must be computed once, not per bucket");
    assert.equal(/UNION DISTINCT/.test(sql), false);
    assert.match(sql, /\(v < 6\) OR \(v >= 6 AND v < 12\) OR \(v >= 12\)/);
  });

  test("a single bucket still compiles as before", () => {
    const sql = compileCohortDef({ all: [leaf({ gte: 24 })] }, ctx);
    assert.match(sql, /v >= 24/);
    assert.equal(/ OR /.test(sql), false);
  });

  test("different metrics in one group keep the union — they cannot share a scan", () => {
    const sql = compileCohortDef({ all: [{ any: [
      leaf({ gte: 24 }), { kind: "derived" as const, metric: "alteredGenes" as const, range: { gte: 6 } }] }] } as any, ctx);
    assert.match(sql, /UNION DISTINCT/);
  });

  test("a mixed group is untouched by the shortcut", () => {
    const sql = compileCohortDef({ all: [{ any: [
      leaf({ gte: 24 }), { kind: "clinical" as const, attribute: "SEX", op: "=" as const, value: "Female" }] }] } as any, ctx);
    assert.match(sql, /UNION DISTINCT/);
  });

  test("validation still applies inside a group", () => {
    assert.throws(() => compileCohortDef({ all: [{ any: [leaf({ gte: 1 }), { kind: "derived", metric: "bogus", range: { gte: 1 } }] }] } as any, ctx),
      /metric must be one of/);
    assert.throws(() => compileCohortDef({ all: [{ any: [leaf({ gte: 1 }), { kind: "derived", metric: "followupMonths" }] }] } as any, ctx),
      /needs a range/);
  });
});
