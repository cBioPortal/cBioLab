// The mutation-expression view's pure parts: the quantile read off bins, its SQL's grouping rules, and its figure.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { binQuantile, QUANTILES } from "../lib/views/mutexpr/run.ts";
import { mutexprGroupsSql, mutexprRangeSql } from "../lib/views/mutexpr/sql.ts";
import { viewToSvg } from "../lib/view-svg.ts";
import type { ViewResult } from "../lib/types.ts";

/** a fixed pseudo-random stream, so a failure reproduces */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

describe("binQuantile", () => {
  test("lies within one bin of the smallest value with that share at or below it, at every size", () => {
    const r = rng(7);
    for (const n of [1, 2, 3, 5, 6, 17, 100, 1000]) for (let rep = 0; rep < 20; rep++) {
      const vals = Array.from({ length: n }, () => (r() + r() + r()) * 4 - 6).sort((a, b) => a - b);
      const x0 = -6, x1 = 6, B = 60, w = (x1 - x0) / B;
      const bins = new Array(B).fill(0);
      for (const v of vals) bins[Math.min(B - 1, Math.max(0, Math.floor((v - x0) / w)))]++;
      for (const p of Object.values(QUANTILES)) {
        const exact = vals[Math.max(0, Math.ceil(p * n) - 1)];
        const got = binQuantile(bins, x0, w, p);
        assert.ok(Math.abs(got - exact) <= w + 1e-12, `n=${n} p=${p}: ${got} vs ${exact}`);
      }
    }
  });
  test("interpolates within a bin, the values taken as spread evenly across it", () => {
    // 4 values in bin 2 of width 1 from 0: the median's target (2) is half way through it
    assert.equal(binQuantile([0, 0, 4, 0], 0, 1, 0.5), 2.5);
    assert.equal(binQuantile([2, 0, 2, 0], 0, 1, 0.25), 0.5);
  });
});

describe("mutexpr SQL", () => {
  const cohortSql = "SELECT DISTINCT 'p' AS pid, 's' AS sid";
  const base = { expressionGene: "MDM2", profileType: "rna_seq_v2_mrna", log2: true, gene: "TP53", resolution: "protein" as const, stratify: [], fusionGene: "TP53", range: [0, 10] as [number, number], bins: 60 };
  test("not profiled is decided by the panel, never read as not mutated", () => {
    const sql = String(mutexprGroupsSql(cohortSql, "st", "db", base));
    assert.match(sql, /'#notMutated', '#notProfiled'\)/);
    assert.match(sql, /sample_to_gene_panel_derived/);
    assert.match(sql, /NOT g\.off_panel/);
  });
  test("codons are read from the protein change, and the strata only when asked for", () => {
    const codon = String(mutexprGroupsSql(cohortSql, "st", "db", { ...base, resolution: "codon" }));
    assert.match(codon, /extract\(g\.mutation_variant/);
    assert.doesNotMatch(String(mutexprGroupsSql(cohortSql, "st", "db", base)), /CANCER_TYPE|structural_variant/);
    const both = String(mutexprGroupsSql(cohortSql, "st", "db", { ...base, stratify: ["cancerType", "fusion"], fusionGene: "ERG" }));
    assert.match(both, /attribute_name = 'CANCER_TYPE'/);
    assert.match(both, /hugo_gene_symbol = 'ERG' AND g\.variant_type = 'structural_variant'/);
  });
  test("log2 leaves out a negative value and counts it; as stored, nothing is left out", () => {
    assert.match(String(mutexprRangeSql(cohortSql, "st", "db", base)), /< 0/);
    assert.doesNotMatch(String(mutexprRangeSql(cohortSql, "st", "db", { ...base, log2: false })), /neg AS/);
  });
  test("a range that is not finite is refused rather than written into SQL", () => {
    assert.throws(() => mutexprGroupsSql(cohortSql, "st", "db", { ...base, range: [0, Infinity] }), /finite/);
  });
});

describe("mutexpr figure", () => {
  const g = (label: string, role: any, n: number | null, extra: Record<string, number> = {}) => ({ label, role, n,
    ...(n == null ? {} : { mean: 1, sd: 0.5, p5: 0, q1: 0.5, median: 1, q3: 1.5, p95: 2, ...extra }) });
  const v = { kind: "mutexpr", cohorts: ["A"], caveat: "",
    mutexpr: { gene: "TP53", expressionGene: "TP53", profileType: "rna_seq_v2_mrna", scale: "log2", resolution: "protein", stratify: ["cancerType"], minCount: 5,
      valueLabel: "TP53 expression — log2(v + 1) of rna_seq_v2_mrna", range: [0, 3], bins: 60, withheldStrata: 1,
      samples: { cohort: 30, withValue: 28, negativeDropped: 0 }, tested: 1,
      strata: [{ key: "a", label: "Breast <Cancer>", n: 25, groups: [g("All mutated", "allMutated", 10, { diff: 0.5, t: 2, p: 0.01, q: 0.01 }), g("R175H", "variant", 6),
        g("Several protein changes", "multiple", null), g("Not mutated", "notMutated", 15)] }] } } as unknown as ViewResult;
  test("draws withheld groups without a box, names the stratum escaped, and says what is withheld", () => {
    const svg = viewToSvg(v)!;
    assert.ok(svg.startsWith("<svg"));
    assert.match(svg, /Breast &lt;Cancer&gt;/);
    assert.match(svg, /withheld: fewer than 5 samples/);
    assert.match(svg, /&lt; 5/);
    assert.match(svg, /1 stratum is withheld whole/);
  });
});
