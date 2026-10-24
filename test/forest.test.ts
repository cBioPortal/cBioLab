// The forest view's pooling and row building, on fixed inputs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { dersimonianLaird } from "../lib/stats.ts";
import { forestFit, type ForestPatient } from "../lib/views/forest/run.ts";

const near = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, a + " is not " + b);

describe("dersimonianLaird", () => {
  // reference values computed by hand from the DerSimonian–Laird formulas
  test("fixed and random effects, tau², Q, I²", () => {
    const m = dersimonianLaird([{ beta: 0.2, se: 0.1 }, { beta: 0.5, se: 0.2 }, { beta: -0.1, se: 0.15 }]);
    near(m.fixed.beta, 0.16557377049180327); near(m.fixed.se, 0.07682212795973759);
    near(m.q, 6.049180327868853); near(m.tau2, 0.04258620689655173);
    near(m.random.beta, 0.17899073644682223); near(m.random.se, 0.1466641616170751);
    near(m.i2, 0.6693766937669376); near(m.qP, 0.04857772609501106, 1e-6);
    near(m.weights.reduce((a, b) => a + b, 0), 1);
  });
  test("homogeneous strata: tau² is 0 and the two pools agree", () => {
    const m = dersimonianLaird([{ beta: 0.3, se: 0.1 }, { beta: 0.3, se: 0.2 }]);
    assert.equal(m.tau2, 0); assert.equal(m.i2, 0); near(m.random.beta, m.fixed.beta);
  });
  test("refuses fewer than two estimates or a zero se", () => {
    assert.throws(() => dersimonianLaird([{ beta: 1, se: 0.1 }]));
    assert.throws(() => dersimonianLaird([{ beta: 1, se: 0.1 }, { beta: 1, se: 0 }]));
  });
});

describe("forestFit", () => {
  // deterministic patients: in stratum A the exposed die sooner; B is small and pools into Other
  const make = (stratum: string, n: number, hrShift: number): ForestPatient[] => Array.from({ length: n }, (_, i) => {
    const exposed = (i % 2) as 0 | 1;
    return { t: 1 + ((i * 7) % 23) / (exposed ? hrShift : 1), event: i % 3 === 0 ? 0 : 1, exposed, stratum, values: [] };
  });
  const opts = { minPatients: 30, minEvents: 10, maxStrata: 30, small: "pool" as const };
  test("one row per large stratum, the small ones pooled into a disclosed Other", () => {
    const f = forestFit([...make("A", 80, 2), ...make("C", 60, 1.5), ...make("B", 12, 1), ...make("D", 12, 1), ...make("E", 10, 1)], [], [], opts);
    assert.deepEqual(f.rows.map((r) => r.label), ["A", "C", "Other (3 strata)"]);
    assert.deepEqual(f.rows[2].pooled, ["B", "D", "E"]);
    assert.ok(f.rows[0].hr > 1, "the exposed die sooner in A");
    assert.ok(f.random && f.fixed);
    near(f.rows.reduce((a, r) => a + r.weight, 0), 1);
  });
  test("drop lists the small strata instead, with the reason", () => {
    const f = forestFit([...make("A", 80, 2), ...make("C", 60, 1.5), ...make("B", 12, 1)], [], [], { ...opts, small: "drop" });
    assert.deepEqual(f.rows.map((r) => r.label), ["A", "C"]);
    assert.equal(f.left[0].label, "B"); assert.match(f.left[0].reason, /fewer than 30 patients/);
  });
  test("a stratum without exposed patients is left out, not fit", () => {
    const none = make("Z", 40, 1).map((r) => ({ ...r, exposed: 0 as const }));
    const f = forestFit([...make("A", 80, 2), ...none], [], [], opts);
    assert.deepEqual(f.rows.map((r) => r.label), ["A"]);
    assert.equal(f.left[0].reason, "no exposed patient");
    assert.equal(f.random, null);
  });
});
