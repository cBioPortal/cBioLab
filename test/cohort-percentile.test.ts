// Percentile-based cohort cutoffs ("top 20% of TMB"): resolveCohortPercentiles rewrites a
// `percentile` clinical leaf into an ordinary `value` before compilation, via an injected
// quantile callback — these tests fake that callback so the rewriting logic is checked without
// a live database, and a separate live check (done manually against crc_apc_impact_2020 and
// tmb_mskcc_2018) covers the real SQL/wiring end to end.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveCohortPercentiles } from "../lib/cohort-percentile.ts";
import type { AnalysisDoc } from "../lib/types.ts";

function doc(cohorts: AnalysisDoc["cohorts"], study = "x"): AnalysisDoc {
  return { study, cohorts };
}

describe("resolveCohortPercentiles", () => {
  test("no percentile leaves anywhere: returns the exact same document (fast path)", async () => {
    const d = doc({ a: { all: [{ kind: "oql", q: "TP53: MUT" }] } });
    const out = await resolveCohortPercentiles(d, "x", async () => { throw new Error("should not be called"); });
    assert.equal(out, d);
  });

  test("a basic percentile leaf is rewritten to op+value, percentile/percentileOf/kind preserved", async () => {
    const d = doc({ high: { all: [{ kind: "clinical", attribute: "TMB_NONSYNONYMOUS", op: ">=", percentile: 0.8 }] } });
    const out = await resolveCohortPercentiles(d, "x", async (study, refDef, attribute, p) => {
      assert.equal(study, "x"); assert.equal(refDef, null); assert.equal(attribute, "TMB_NONSYNONYMOUS");
      assert.equal(p, 0.8);
      return 13.7;
    });
    const leaf: any = out.cohorts.high.all![0];
    assert.equal(leaf.value, 13.7);
    assert.equal(leaf.op, ">=");
    assert.equal(leaf.kind, "clinical");
  });

  test("percentileOf references another cohort's def as the reference population", async () => {
    const d = doc({
      "NSCLC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["NSCLC"] }] },
      "NSCLC high-TMB": { all: [{ kind: "clinical", attribute: "TMB_NONSYNONYMOUS", op: ">=", percentile: 0.8, percentileOf: "NSCLC" }] },
    });
    let sawRefDef: any = undefined;
    const out = await resolveCohortPercentiles(d, "x", async (study, refDef) => {
      sawRefDef = refDef;
      return 13.7;
    });
    assert.deepEqual(sawRefDef, d.cohorts["NSCLC"]);
    assert.equal((out.cohorts["NSCLC high-TMB"].all![0] as any).value, 13.7);
  });

  test("percentileOf naming an unknown cohort is rejected loudly", async () => {
    const d = doc({ a: { all: [{ kind: "clinical", attribute: "TMB_NONSYNONYMOUS", op: ">=", percentile: 0.8, percentileOf: "nope" }] } });
    await assert.rejects(() => resolveCohortPercentiles(d, "x", async () => 1), /references unknown cohort "nope"/);
  });

  test("chaining (percentileOf -> a cohort that itself has an unresolved percentile leaf) is rejected", async () => {
    const d = doc({
      base: { all: [{ kind: "clinical", attribute: "AGE", op: ">=", percentile: 0.5 }] },
      derived: { all: [{ kind: "clinical", attribute: "TMB_NONSYNONYMOUS", op: ">=", percentile: 0.8, percentileOf: "base" }] },
    });
    await assert.rejects(() => resolveCohortPercentiles(d, "x", async () => 1), /chaining is not supported/);
  });

  test("a cohort spanning multiple studies is rejected for a percentile cutoff", async () => {
    const d = doc({ a: { studies: ["s1", "s2"], all: [{ kind: "clinical", attribute: "TMB_NONSYNONYMOUS", op: ">=", percentile: 0.8 }] } });
    await assert.rejects(() => resolveCohortPercentiles(d, "x", async () => 1), /needs a single study; this cohort spans 2 studies/);
  });

  test("percentileOf's cohort spanning multiple studies is also rejected", async () => {
    const d = doc({
      ref: { studies: ["s1", "s2"], all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["NSCLC"] }] },
      a: { all: [{ kind: "clinical", attribute: "TMB_NONSYNONYMOUS", op: ">=", percentile: 0.8, percentileOf: "ref" }] },
    });
    await assert.rejects(() => resolveCohortPercentiles(d, "x", async () => 1), /needs a single study; this cohort spans 2 studies/);
  });

  test("combining percentile with an explicit value is rejected", async () => {
    const d = doc({ a: { all: [{ kind: "clinical", attribute: "TMB_NONSYNONYMOUS", op: ">=", value: 5, percentile: 0.8 } as any] } });
    await assert.rejects(() => resolveCohortPercentiles(d, "x", async () => 1), /cannot combine percentile with an explicit value/);
  });

  test("combining percentile with values[] or range is rejected", async () => {
    const d1 = doc({ a: { all: [{ kind: "clinical", attribute: "X", values: ["A"], percentile: 0.8 } as any] } });
    await assert.rejects(() => resolveCohortPercentiles(d1, "x", async () => 1), /percentile replaces value, not values/);
    const d2 = doc({ a: { all: [{ kind: "clinical", attribute: "X", range: { gt: 1 }, percentile: 0.8 } as any] } });
    await assert.rejects(() => resolveCohortPercentiles(d2, "x", async () => 1), /percentile replaces value, not values/);
  });

  test("a percentile leaf without op is rejected", async () => {
    const d = doc({ a: { all: [{ kind: "clinical", attribute: "TMB_NONSYNONYMOUS", percentile: 0.8 } as any] } });
    await assert.rejects(() => resolveCohortPercentiles(d, "x", async () => 1), /needs op/);
  });

  test("percentile out of (0,1) is rejected", async () => {
    const d = doc({ a: { all: [{ kind: "clinical", attribute: "TMB_NONSYNONYMOUS", op: ">=", percentile: 1.5 }] } });
    await assert.rejects(() => resolveCohortPercentiles(d, "x", async () => 1), /between 0 and 1/);
  });

  test("a reference population with no values (quantileFor resolves null) is rejected, not silently zero", async () => {
    const d = doc({ a: { all: [{ kind: "clinical", attribute: "TMB_NONSYNONYMOUS", op: ">=", percentile: 0.8 }] } });
    await assert.rejects(() => resolveCohortPercentiles(d, "x", async () => null), /no values for TMB_NONSYNONYMOUS/);
  });

  test("the same (study, percentileOf, attribute, per, percentile) key is only resolved once", async () => {
    let calls = 0;
    const d = doc({
      a: { all: [{ kind: "clinical", attribute: "TMB_NONSYNONYMOUS", op: ">=", percentile: 0.8 }] },
      b: { all: [{ kind: "clinical", attribute: "TMB_NONSYNONYMOUS", op: ">=", percentile: 0.8 }] },
    });
    const out = await resolveCohortPercentiles(d, "x", async () => { calls++; return 13.7; });
    assert.equal(calls, 1);
    assert.equal((out.cohorts.a.all![0] as any).value, 13.7);
    assert.equal((out.cohorts.b.all![0] as any).value, 13.7);
  });

  test("resolves inside any/not, not just top-level all clauses", async () => {
    const d = doc({
      a: {
        all: [
          { any: [{ kind: "clinical", attribute: "TMB_NONSYNONYMOUS", op: ">=", percentile: 0.8 }, { kind: "oql", q: "TP53: MUT" }] },
          { not: { kind: "clinical", attribute: "AGE", op: "<", percentile: 0.2 } },
        ],
      },
    });
    const out = await resolveCohortPercentiles(d, "x", async (_s, _r, attribute) => attribute === "TMB_NONSYNONYMOUS" ? 13.7 : 40);
    const all: any = out.cohorts.a.all;
    assert.equal(all[0].any[0].value, 13.7);
    assert.equal(all[1].not.value, 40);
  });
});
