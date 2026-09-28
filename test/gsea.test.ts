// Preranked GSEA (lib/stats.ts): the enrichment score against a brute-force walk of the
// running sum, and the permutation null against what a null must look like.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { enrichmentScore, preRankedGsea, seededRandom } from "../lib/stats.ts";

/** The running sum walked gene by gene, exactly as Subramanian et al. define it. */
function bruteEs(inSet: boolean[], w: number[]): number {
  const n = inSet.length, k = inSet.filter(Boolean).length;
  const nr = w.reduce((s, x, i) => s + (inSet[i] ? x : 0), 0);
  let rs = 0, best = 0;
  for (let i = 0; i < n; i++) {
    rs += inSet[i] ? w[i] / nr : -1 / (n - k);
    if (Math.abs(rs) > Math.abs(best)) best = rs;
  }
  return best;
}

describe("enrichmentScore", () => {
  test("equals the gene-by-gene running sum on random rankings, both signs", () => {
    const rnd = seededRandom(7);
    for (let trial = 0; trial < 300; trial++) {
      const n = 20 + Math.floor(rnd() * 200);
      const w = Array.from({ length: n }, () => rnd() * 3);
      const inSet = Array.from({ length: n }, () => rnd() < 0.15);
      if (!inSet.some(Boolean) || inSet.every(Boolean)) continue;
      const pos = inSet.map((b, i) => b ? i : -1).filter((i) => i >= 0);
      const fast = enrichmentScore(pos, pos.map((i) => w[i]), n);
      assert.ok(Math.abs(fast - bruteEs(inSet, w)) < 1e-12, "trial " + trial + ": " + fast + " vs " + bruteEs(inSet, w));
    }
  });
  test("a set at the very top scores +1 minus nothing; at the very bottom, -1", () => {
    const n = 100, pos = [0, 1, 2, 3, 4], w = [1, 1, 1, 1, 1];
    assert.ok(Math.abs(enrichmentScore(pos, w, n) - 1) < 1e-12);
    assert.ok(Math.abs(enrichmentScore([95, 96, 97, 98, 99], w, n) + 1) < 1e-12);
  });
});

describe("preRankedGsea", () => {
  const n = 2000;
  const ranked = Array.from({ length: n }, (_, i) => ({ gene: "G" + i, score: (n / 2 - i) / 100 }));
  test("a set concentrated at the top is strongly positive, and its leading edge is the top members", () => {
    const top = Array.from({ length: 30 }, (_, i) => "G" + (i * 3));
    const [r] = preRankedGsea(ranked, [{ name: "top", genes: top }], { permutations: 500 });
    assert.ok(r.es > 0.8 && r.nes > 1.5, "es " + r.es + " nes " + r.nes);
    // no null set of the same sign beats it, so p is at its floor: 1 / (same-sign nulls + 1),
    // about half of the 500 permutations
    assert.ok(r.p < 0.01, "p " + r.p);
    assert.ok(r.leadingEdge.length > 20 && r.leadingEdge.includes("G0"));
  });
  test("the running-sum curve peaks at the reported score", () => {
    const set = Array.from({ length: 25 }, (_, i) => "G" + (1900 - i * 7));
    const [r] = preRankedGsea(ranked, [{ name: "bottom", genes: set }], { permutations: 100, curvePoints: n });
    assert.ok(r.es < 0);
    assert.ok(Math.abs(Math.min(...r.curve) - r.es) < 1e-3);
  });
  test("random sets give p-values that look uniform — the null is a null", () => {
    const rnd = seededRandom(11);
    const sets = Array.from({ length: 120 }, (_, s) => ({ name: "rand" + s,
      genes: Array.from({ length: 40 }, () => "G" + Math.floor(rnd() * n)) }));
    const res = preRankedGsea(ranked, sets, { permutations: 200 });
    const mean = res.reduce((a, r) => a + r.p, 0) / res.length;
    const small = res.filter((r) => r.p < 0.05).length / res.length;
    assert.ok(mean > 0.38 && mean < 0.62, "mean p " + mean);
    assert.ok(small < 0.12, "share below 0.05: " + small);
  });
  test("reproducible: the same set gets the same p on every run", () => {
    const set = [{ name: "s", genes: Array.from({ length: 30 }, (_, i) => "G" + (i * 50)) }];
    assert.deepEqual(preRankedGsea(ranked, set).map((r) => r.p), preRankedGsea(ranked, set).map((r) => r.p));
  });
  test("a set with fewer than minSize members in the ranking is skipped, not scored", () => {
    assert.equal(preRankedGsea(ranked, [{ name: "tiny", genes: ["G1", "G2", "NOPE"] }]).length, 0);
  });
});
