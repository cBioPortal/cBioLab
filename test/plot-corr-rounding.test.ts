// A correlation coefficient is rounded to 5 decimals before it is shown or tested, as cbioportal.org
// does (ScatterPlot.tsx: Number(r.toFixed(5)), then computeCorrelationPValue of that rounded r).
// Reference p values: scipy 2 * t.sf(|t|, n - 2).
import { test, describe } from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { portalR5, portalCorr } from "../lib/chart/format.ts";
import { corrPValue } from "../lib/plot.ts";
import type { PlotData } from "../lib/plot.ts";
import { plotMethod } from "../lib/views/plot/method.ts";

const close = (actual: number | null, expected: number, tol: number, msg?: string) => {
  assert.ok(actual != null, msg ?? "expected a number, got null");
  assert.ok(Math.abs(actual - expected) <= tol * Math.abs(expected),
    `${msg ?? ""} ${actual} vs ${expected} (relative ${tol})`.trim());
};

describe("portalR5: r to 5 decimals", () => {
  test("F1: 0.123456789 → 0.12346", () => assert.equal(portalR5(0.123456789), 0.12346));
  test("F2: -0.0550868 → -0.05509", () => assert.equal(portalR5(-0.0550868), -0.05509));
  test("F3: 0.999996 → 1", () => assert.equal(portalR5(0.999996), 1));
  test("F4: -0.999996 → -1", () => assert.equal(portalR5(-0.999996), -1));
  test("F5: 0 → 0", () => assert.equal(portalR5(0), 0));
});

describe("portalCorr: 2 decimals of the 5-decimal r", () => {
  test("D1: 0.124996 → \"0.13\" (rounds through 0.125)", () => assert.equal(portalCorr(0.124996), "0.13"));
  test("D2: -0.0550868 → \"-0.06\"", () => assert.equal(portalCorr(-0.0550868), "-0.06"));
  test("D3: 0.5 → \"0.50\"", () => assert.equal(portalCorr(0.5), "0.50"));
});

describe("corrPValue: the p of the 5-decimal r", () => {
  test("P1: r = -0.0550868, n = 581 → the p of -0.05509", () =>
    close(corrPValue(-0.0550868, 581), 0.18482858596855997, 1e-9));
  test("P2: r = 0.999996, n = 3 → 0 (r rounds to 1)", () => assert.equal(corrPValue(0.999996, 3), 0));
  test("P3: r = 0.123456789, n = 10", () => close(corrPValue(0.123456789, 10), 0.7340102278451182, 1e-9));
  test("P4: r = 0.3486712, n = 523", () => close(corrPValue(0.3486712, 523), 2.141448514256564e-16, 1e-6));
  test("P5: n = 2 → null", () => assert.equal(corrPValue(0.5, 2), null));
  test("P6: r = null → null", () => assert.equal(corrPValue(null, 50), null));
  test("P7: r = -1 → 0", () => assert.equal(corrPValue(-1, 50), 0));
});

describe("plot method record: its script rounds r the same way", () => {
  const scatter: PlotData = { shape: "scatter", n: 590, x: { label: "AGE", kind: "num" }, y: { label: "FGA", kind: "num" },
    stats: { pearson: -0.03816, spearman: -0.05509, slope: -0.001, intercept: 0.3, pPearson: 0.359, pSpearman: 0.185 } };

  /** the script's own r5, run in python3 on each value, beside portalR5 */
  const scriptR5 = (python: string, xs: number[]): number[] => {
    const lines = python.split("\n");
    const at = lines.findIndex((l) => l.startsWith("def r5("));
    assert.ok(at >= 0, "the script defines r5");
    const end = lines.findIndex((l, i) => i > at && l.trim() !== "" && !/^\s/.test(l));
    const src = ["from decimal import Decimal, ROUND_HALF_UP", ...lines.slice(at, end < 0 ? undefined : end),
      "import json", "print(json.dumps([r5(x) for x in " + JSON.stringify(xs) + "]))"].join("\n");
    const r = spawnSync("python3", ["-I", "-c", src], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout) as number[];
  };
  // 1/64 and 3/64 sit exactly on a 5-decimal tie: toFixed rounds them away from zero, Python's format half to even
  const VALUES = [0.123456789, -0.0550868, 0.999996, -0.999996, 0.015625, -0.015625, 0.046875, 0.5, 0];

  test("M1: a single-study scatter's script rounds r as portalR5 does, ties included, and p_of tests the rounded r", () => {
    const m = plotMethod({ cohort: "All", studies: ["coadread"], unit: "sample", data: scatter });
    assert.deepEqual(scriptR5(m.python!, VALUES), VALUES.map(portalR5));
    assert.match(m.python!, /def p_of\(r, n\):[\s\S]*?\n {4}r = r5\(r\)\n/);
  });

  test("M2: a pooled scatter's script rounds the same way", () => {
    const moments = [{ study: "a", n: 3, sx: 6, sy: 6, sxy: 14, sxx: 14, syy: 14 }, { study: "b", n: 2, sx: 9, sy: 9, sxy: 41, sxx: 41, syy: 41 }];
    const m = plotMethod({ cohort: "All", studies: ["a", "b"], unit: "sample", data: scatter, moments });
    assert.deepEqual(scriptR5(m.python!, VALUES), VALUES.map(portalR5));
    assert.match(m.python!, /p_of\(pearson, n\)/, "the pooled Pearson's p goes through p_of");
  });
});
