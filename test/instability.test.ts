import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { HG19_CENTROMERES, CHROM_LENGTHS, GENOME_CHROMS, instabilityArms } from "../lib/federation-views.ts";
import { viewToSvg } from "../lib/view-svg.ts";
import { lintSvg } from "../lib/chart/lint.ts";
import type { DrawnResultOf } from "../lib/types.ts";

describe("instability arms", () => {
  test("39 autosomal arms (no acrocentric p arms), 41 with X; every centromere inside its chromosome", () => {
    assert.equal(instabilityArms(false).length, 39);
    assert.equal(instabilityArms(true).length, 41);
    for (const c of ["13", "14", "15", "21", "22"]) assert.ok(!instabilityArms(false).includes(c + "p"));
    for (const c of GENOME_CHROMS) assert.ok(HG19_CENTROMERES[c] > 0 && HG19_CENTROMERES[c] < CHROM_LENGTHS.hg19[c], c);
  });
});

describe("instability figure", () => {
  const arms = instabilityArms(false);
  const hist = (n: number, at: number) => Array.from({ length: n }, (_, i) => Math.abs(i - at) < 3 ? 10 : 1);
  const panel = (cohort: string, at: number) => ({ cohort, samples: 100, segmented: 98, allArms: 95, score: hist(40, at), fga: hist(101, at * 2),
    scoreSpread: { p5: 1, q1: at - 2, median: at, q3: at + 2, p95: at + 10, mean: at }, fgaSpread: { p5: 1, q1: 2 * at - 4, median: 2 * at, q3: 2 * at + 4, p95: 2 * at + 20, mean: 2 * at },
    arms: arms.map((a, k) => ({ arm: a, measured: 98, gain: k % 7, loss: k % 5 })) });
  const v: DrawnResultOf<"instability"> = { kind: "instability", cohorts: ["Colorectal", "Breast"], caveat: "purity is not corrected",
    instability: { build: "hg19", threshold: 0.2, armShare: 0.5, includeX: false, arms, panels: [panel("Colorectal", 7), panel("Breast", 9)], test: { name: "Mann–Whitney U", scoreP: 1e-5, fgaP: 0.2 } } };
  test("draws both boxes and the arm heatmap, and lints clean", () => {
    for (const width of [560, 936, 1352]) {
      const svg = viewToSvg(v, { width })!;
      assert.ok(svg.includes("Colorectal — 20q gained in"));
      assert.ok(svg.includes("Mann–Whitney U: aneuploidy score"));
      assert.deepEqual(lintSvg(svg), []);
    }
  });
});
