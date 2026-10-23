// aalenJohansen checked against statsmodels (CumIncidenceRight: F1, F2 and the delta-method SE)
// and, with delayed entry, against lifelines' AalenJohansenFitter; grayPermutationTest against
// the Python port of our seeded permutation test that the incidence view's script carries
// (regenerate with `uv run python/golden/incidence.py`).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aalenJohansen, grayPermutationTest, type CrRecord } from "../lib/stats.ts";
import { VERIFIED } from "../lib/method.ts";
import { GRAY_NULL_PY } from "../lib/views/incidence/method.ts";

const golden = JSON.parse(readFileSync("test/fixtures/golden/incidence.json", "utf8"));
const TOL = 1e-12;

describe("aalenJohansen matches statsmodels CumIncidenceRight — statsmodels " + golden.libraries.statsmodels, () => {
  golden.cif.forEach((c: any, i: number) => test("case " + (i + 1) + ": " + c.records.length + " records, tied times", () => {
    const r = aalenJohansen(c.records as CrRecord[]);
    const at = new Map(r.points.map((p) => [p.t, p]));
    c.times.forEach((t: number, j: number) => {
      const p = at.get(t);
      const stepped = j === 0 ? c.f1[0] + c.f2[0] > 0 : c.f1[j] !== c.f1[j - 1] || c.f2[j] !== c.f2[j - 1];
      if (!p) { assert.ok(!stepped, "a step at t=" + t + " (statsmodels' curve moves there)"); return; }
      assert.ok(Math.abs(p.f1 - c.f1[j]) <= TOL, "F1(" + t + "): " + p.f1 + " vs " + c.f1[j]);
      assert.ok(Math.abs(p.f2 - c.f2[j]) <= TOL, "F2(" + t + "): " + p.f2 + " vs " + c.f2[j]);
      if (c.se1[j] != null) assert.ok(Math.abs(p.se1 - c.se1[j]) <= TOL, "SE(F1)(" + t + "): " + p.se1 + " vs " + c.se1[j]);
    });
  }));
});

describe("aalenJohansen with delayed entry matches lifelines AalenJohansenFitter — lifelines " + golden.libraries.lifelines, () => {
  golden.entryCif.forEach((c: any, i: number) => test("case " + (i + 1) + ": " + c.records.length + " records", () => {
    const at = new Map(aalenJohansen(c.records as CrRecord[]).points.map((p) => [p.t, p]));
    for (const p of c.points) {
      const q = at.get(p.t);
      assert.ok(q, "a step at t=" + p.t);
      assert.ok(Math.abs(q!.f1 - p.f1) <= 1e-12, "F1(" + p.t + "): " + q!.f1 + " vs " + p.f1);
    }
  }));
});

describe("grayPermutationTest matches the incidence script's Python port exactly", () => {
  golden.gray.forEach((c: any, i: number) => test("case " + (i + 1) + ": " + c.groups.length + " groups", () => {
    const r = grayPermutationTest(c.groups, c.permutations, 1);
    assert.equal(r.statistic, c.statistic);
    assert.equal(r.p, c.p, "the permutation p is a ratio of counts: equal, not close");
  }));
});

test("the port the incidence script embeds is python/golden/gray_null.py, character for character", () => {
  assert.equal(GRAY_NULL_PY, readFileSync("python/golden/gray_null.py", "utf8"));
});

test("the incidence record's verification claim names the library versions this fixture was made with", () => {
  assert.equal(VERIFIED.cif.version, golden.libraries.statsmodels);
});
