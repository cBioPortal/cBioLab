import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { hlaPanel, covariateColumns, type HlaRec } from "../lib/views/hla.ts";
import { viewToSvg } from "../lib/view-svg.ts";
import { lintSvg } from "../lib/chart/lint.ts";

const rec = (hom: (number | null)[], loss: number | null, t: number | null, ev: number, cov: (string | null)[] = []): HlaRec => ({ hom, nf: hom.some((h) => h != null) ? 2 : null, loss, t, ev, cov, study: "s" });

describe("hla counts", () => {
  const recs: HlaRec[] = [];
  for (let i = 0; i < 12; i++) recs.push(rec([0, 0, 0], i % 3 === 0 ? 1 : 0, 10 + i, i % 2, [String(i)]));
  for (let i = 0; i < 6; i++) recs.push(rec([1, 0, 0], null, 5 + i, 1, [String(i)]));
  recs.push(rec([1, 1, 0], 0, 3, 1, ["2"]), rec([1, 1, 1], 0, 2, 1, [null]));
  recs.push(rec([0, null, 0], 0, 8, 0, ["1"]), rec([null, null, null], null, null, 0));
  const pn = hlaPanel("c", 25, recs, 2, 1, false);
  test("homozygosity over patients typed at all three loci; LOH over patients with a call", () => {
    assert.equal(pn.typed, 20);
    assert.deepEqual(pn.homozygous, [12, 6, 1, 1]);
    assert.equal(pn.anyTyped, 21);
    assert.deepEqual(pn.loci.map((l) => [l.typed, l.homozygous]), [[21, 8], [20, 2], [21, 1]]);
    assert.equal(pn.lohEvaluated, 15);
    assert.equal(pn.loh, 4);
    assert.equal(pn.noOutcome, 1);
  });
  test("homozygous patients die sooner here, so the HR is above 1; a missing covariate drops one patient from the adjusted fit", () => {
    const s = pn.byHomozygosity!;
    assert.equal(s.curves[0].n, 8);
    assert.equal(s.curves[1].n, 12);
    assert.ok(s.hr && s.hr.hr > 1 && s.logrank && s.logrank.p < 0.05);
    assert.equal(s.adjusted!.n, 19);
  });
  test("a split with too few patients in a group says why", () => {
    const small = hlaPanel("c", 3, recs.slice(0, 14), 2, 0, false);
    assert.equal(small.byHomozygosity, null);
    assert.match(small.byHomozygosityWhy!, /fewer than 5/);
  });
  test("covariates: numbers as they are, categories as indicators against the commonest", () => {
    const rs = ["a", "a", "b", "c"].map((v) => rec([0, 0, 0], null, 1, 1, [v, "3"]));
    const cols = covariateColumns(rs, 2);
    assert.deepEqual(rs.map((r) => cols.flatMap((c) => c(r))), [[0, 0, 3], [0, 0, 3], [1, 0, 3], [0, 1, 3]]);
  });
  test("the figure lints clean at both widths", () => {
    const v = { kind: "hla" as const, cohorts: ["c"], caveat: "x", hla: { resolution: 2 as const, endpoint: "OS", covariates: ["TMB"], panels: [pn] } };
    for (const width of [560, 936]) {
      const svg = viewToSvg(v, { width })!;
      assert.ok(svg.includes("OS by homozygosity"));
      assert.deepEqual(lintSvg(svg), []);
    }
  });
});
