import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { poissonBinomialTails } from "../lib/stats.ts";
import { fitBackground } from "../lib/views/exclusivity.ts";
import { viewToSvg } from "../lib/view-svg.ts";
import { lintSvg } from "../lib/chart/lint.ts";
import type { DrawnResultOf } from "../lib/types.ts";

describe("poissonBinomialTails", () => {
  test("p = ½, ½, ⅕ by hand: P(0)=.2, P(1)=.45, P(2)=.3, P(3)=.05", () => {
    const t = poissonBinomialTails([{ n: 2, p: 0.5 }, { n: 1, p: 0.2 }], 1);
    assert.ok(Math.abs(t.lower - 0.65) < 1e-12 && Math.abs(t.upper - 0.8) < 1e-12 && t.exact);
    assert.ok(Math.abs(t.mean - 1.2) < 1e-12);
    const three = poissonBinomialTails([{ n: 2, p: 0.5 }, { n: 1, p: 0.2 }], 3);
    assert.ok(Math.abs(three.upper - 0.05) < 1e-12 && Math.abs(three.lower - 1) < 1e-12);
  });
  test("one group is the binomial; the approximation lands near the exact tail", () => {
    const ex = poissonBinomialTails([{ n: 1000, p: 0.3 }], 280), ap = poissonBinomialTails([{ n: 1000, p: 0.3 }], 280, 1);
    assert.ok(Math.abs(ex.lower - 0.08858) < 1e-4, String(ex.lower));
    assert.ok(!ap.exact && Math.abs(ap.lower - ex.lower) < 1e-3 && Math.abs(ap.upper - ex.upper) < 1e-3);
  });
});

describe("fitBackground", () => {
  test("matches every row and column margin, panel-aware", () => {
    const rows = [{ sig: "A", r: 1, n: 10 }, { sig: "A", r: 2, n: 5 }, { sig: "A", r: 0, n: 5 }, { sig: "B", r: 1, n: 4 }];
    const cover = new Map([["A", new Set(["g1", "g2", "g3"])], ["B", new Set(["g1", "g2"])]]);
    const cols = new Map([["g1", 12], ["g2", 8], ["g3", 4]]);
    const f = fitBackground(rows, cols, cover);
    assert.ok(f.converged);
    const p = (i: number, g: string) => 1 / (1 + Math.exp(-(f.a[i] + f.b.get(g)!)));
    for (const [g, c] of cols) {
      const sum = rows.reduce((s, r, i) => s + (cover.get(r.sig)!.has(g) && r.r > 0 ? r.n * p(i, g) : 0), 0);
      assert.ok(Math.abs(sum - c) < 1e-2, g + " " + sum);
    }
    assert.ok(Math.abs(p(0, "g1") + p(0, "g2") + p(0, "g3") - 1) < 1e-3);
    assert.equal(f.a[2], -Infinity);
  });
});

describe("exclusivity figure", () => {
  const pair = (a: string, b: string, qE: number, qC: number) => ({ a, b, profiled: 100, both: 2, expected: 10, pExclusive: qE, qExclusive: qE, pCooccur: qC, qCooccur: qC, exact: true,
    onlyA: 20, onlyB: 20, neither: 58, fisherP: 0.01, fisherQ: 0.02, log2Odds: -1.5 });
  const v: DrawnResultOf<"exclusivity"> = { kind: "exclusivity", cohorts: ["NSCLC"], caveat: "a pattern, not a mechanism",
    exclusivity: { cohort: "NSCLC", genes: ["KRAS", "EGFR", "TP53"], stratifyBy: null, strata: [{ name: "all", samples: 100 }], measure: "any", samples: 100, matrixGenes: 300,
      iterations: 4, converged: true, maxResidual: 1e-5, pairs: [pair("KRAS", "EGFR", 1e-9, 1), pair("KRAS", "TP53", 1, 0.03)], unassessable: ["EGFR/TP53"] } };
  test("draws the triangle, the never-profiled cell and the table, and lints clean", () => {
    for (const width of [560, 936]) {
      const svg = viewToSvg(v, { width })!;
      assert.ok(svg.includes("TP53 / EGFR — never profiled together"));
      assert.ok(svg.includes("1e-9 exclusive"));
      assert.ok(svg.includes("0.03 co-occurring"));
      assert.deepEqual(lintSvg(svg), []);
    }
  });
});
