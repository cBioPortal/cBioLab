// Hypothesis campaigns: the rules that make a campaign honest, checked without a database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalJson, validateHypothesis, withSplit, extractPrimary, pinCohortOrder, primaryCohorts,
  scoreDiscovery, replicated, type Hypothesis, type Outcome
} from "../lib/hypothesis.ts";
import { ledgerHash, funnel, checkFeasibility, hypothesisHash, type Campaign } from "../lib/campaign.ts";
import type { AnalysisResult } from "../lib/types.ts";

const base = (): Hypothesis => ({
  statement: "STK11 is more often altered in early immunotherapy failures",
  doc: {
    study: "s1",
    cohorts: { early: { all: [{ kind: "oql", q: "KRAS: MUT" }] }, durable: { all: [{ kind: "oql", q: "EGFR: MUT" }] } },
    views: [{ kind: "compare", genes: ["STK11", "KEAP1"] }]
  },
  primary: { view: 0, stat: "compare", gene: "STK11" },
  direction: "higher"
});

describe("identity: the same test hashes alike however it is spelled", () => {
  test("key order does not change the hash", () => {
    const a = base();
    const b = base();
    b.doc = { views: b.doc.views, cohorts: { durable: b.doc.cohorts.durable, early: b.doc.cohorts.early }, study: "s1" } as any;
    assert.equal(hypothesisHash(a), hypothesisHash(b));
  });
  test("the prose statement is not part of the test", () => {
    assert.equal(hypothesisHash(base()), hypothesisHash({ ...base(), statement: "reworded" }));
  });
  test("a different primary, direction or threshold is a different test", () => {
    assert.notEqual(hypothesisHash(base()), hypothesisHash({ ...base(), primary: { view: 0, stat: "compare", gene: "KEAP1" } }));
    assert.notEqual(hypothesisHash(base()), hypothesisHash({ ...base(), direction: "lower" }));
  });
  test("canonical JSON sorts keys at every depth and drops undefined", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: undefined, x: 0 }], c: 3 } }), '{"a":{"c":3,"d":[2,{"x":0,"z":1}]},"b":1}');
  });
  test("the ledger receipt does not depend on registration order", () => {
    assert.equal(ledgerHash(["b", "a", "c"]), ledgerHash(["c", "b", "a"]));
    assert.notEqual(ledgerHash(["a", "b"]), ledgerHash(["a", "b", "c"]));
  });
});

describe("validation refuses what cannot be counted honestly", () => {
  test("a well-formed hypothesis passes", () => { validateHypothesis(base()); });
  test("the split belongs to the campaign, not the generator", () => {
    const h = base();
    h.doc.cohorts.early.all!.push({ kind: "split", part: "validation" });
    assert.throws(() => validateHypothesis(h), /owned by the campaign/);
  });
  test("the primary must point at a view of the stated kind", () => {
    assert.throws(() => validateHypothesis({ ...base(), primary: { view: 3, stat: "compare", gene: "STK11" } }), /index one/);
    assert.throws(() => validateHypothesis({ ...base(), primary: { view: 0, stat: "survival" } }), /compare view/);
  });
  test("a two-arm test needs exactly two cohorts", () => {
    const h = base();
    h.doc.cohorts.third = { all: [] };
    assert.throws(() => validateHypothesis(h), /exactly two cohorts/);
    (h.doc.views![0] as any).cohorts = ["early", "durable"];
    validateHypothesis(h);
  });
  test("no statement, no hypothesis", () => {
    assert.throws(() => validateHypothesis({ ...base(), statement: "  " }), /statement/);
  });
});

describe("withSplit restricts every cohort to one half", () => {
  test("appends the split to each cohort and leaves the rest alone", () => {
    const d = withSplit(base().doc, "validation");
    for (const c of Object.values(d.cohorts)) assert.deepEqual(c.all!.at(-1), { kind: "split", part: "validation" });
    assert.equal(d.cohorts.early.all!.length, 2);
    assert.equal(base().doc.cohorts.early.all!.length, 1, "the original document is not mutated");
  });
  test("an empty cohort becomes 'this half of the study'", () => {
    const d = withSplit({ study: "s1", cohorts: { all: { all: [] } }, views: [] }, "discovery");
    assert.deepEqual(d.cohorts.all.all, [{ kind: "split", part: "discovery" }]);
  });
  test("a v1 bare event definition is wrapped, not dropped", () => {
    const ev = { a: { eventType: "Treatment" }, rel: { type: "NONE" } };
    const d = withSplit({ study: "s1", cohorts: { t: ev as any }, views: [] }, "discovery");
    assert.equal(d.cohorts.t.all!.length, 2);
  });
  test("a cohort already at the 8-clause cap is refused rather than silently unsplit", () => {
    const eight = Array.from({ length: 8 }, () => ({ kind: "oql" as const, q: "TP53: MUT" }));
    assert.throws(() => withSplit({ study: "s1", cohorts: { full: { all: eight } }, views: [] }, "discovery"), /no room/);
  });
});

const compareResult = (early: [number, number], durable: [number, number], p?: number): AnalysisResult => ({
  study: "s1", involvedStudies: ["s1"], oncokbPin: null, stats: { ms: 0 },
  cohorts: { early: { count: early[1], text: "", studies: [], sql: "" }, durable: { count: durable[1], text: "", studies: [], sql: "" } },
  views: [{ kind: "compare", rows: [{ gene: "STK11", pAny: p, cells: [
    { cohort: "durable", profiled: durable[1], any: durable[0], driver: 0, anyPct: 100 * durable[0] / durable[1], driverPct: 0 } as any,
    { cohort: "early", profiled: early[1], any: early[0], driver: 0, anyPct: 100 * early[0] / early[1], driverPct: 0 } as any
  ] }] }]
});

describe("reading the primary result", () => {
  test("cells are matched by cohort name, not position", () => {
    const o = extractPrimary(base(), compareResult([181, 827], [22, 215], 6.7e-5));
    assert.equal(o.ok, true);
    assert.equal(o.observed, "higher");
    assert.equal(o.directionOk, true);
    assert.match(o.effect!, /21\.9% vs 10\.2%/);
  });
  test("a result in the opposite direction is flagged, whatever its p", () => {
    const o = extractPrimary(base(), compareResult([22, 827], [60, 215], 1e-9));
    assert.equal(o.observed, "lower");
    assert.equal(o.directionOk, false);
  });
  test("no test is a stated reason, not a p of 1", () => {
    const o = extractPrimary(base(), compareResult([1, 3], [0, 2]));
    assert.equal(o.ok, false);
    assert.match(o.reason!, /no test/);
  });
  test("a view error is carried through", () => {
    const r = compareResult([1, 3], [0, 2]);
    r.views[0] = { kind: "compare", error: "unknown gene FOO" };
    assert.equal(extractPrimary(base(), r).reason, "unknown gene FOO");
  });
});

describe("the campaign's decision rules", () => {
  const ok = (p: number, directionOk = true): Outcome => ({ ok: true, p, directionOk, observed: "higher" });
  test("BH runs across the whole campaign, and untested rows neither count nor get a q", () => {
    const s = scoreDiscovery([ok(0.001), ok(0.04), { ok: false, reason: "x" }, ok(0.5), undefined]);
    assert.deepEqual(s.map((x) => x.q === undefined), [false, false, true, false, true]);
    assert.ok(Math.abs(s[0].q! - 0.003) < 1e-12, "3 tested, smallest p times 3");
    assert.ok(Math.abs(s[1].q! - 0.06) < 1e-12, "second of 3: 0.04 * 3 / 2");
    assert.deepEqual(s.map((x) => x.promising), [true, true, false, false, false], "q <= 0.1 survives");
    assert.deepEqual(s.map((x) => x.naiveClaim), [true, true, false, false, false]);
  });
  test("a significant result pointing the wrong way does not survive", () => {
    assert.equal(scoreDiscovery([ok(1e-6, false)])[0].promising, false);
  });
  test("replication needs significance AND the same direction as discovery", () => {
    assert.equal(replicated(ok(1e-4), ok(0.01)), true);
    assert.equal(replicated(ok(1e-4), ok(0.2)), false);
    assert.equal(replicated(ok(1e-4), { ...ok(0.01), observed: "lower" }), false);
    assert.equal(replicated(ok(1e-4), { ok: false, reason: "refused" }), false);
  });
});

describe("feasibility sees cohort sizes, never an outcome", () => {
  test("runs the document with no views, on the discovery half", async () => {
    let seen: any;
    const f = await checkFeasibility(base(), async (d) => { seen = d; return compareResult([10, 100], [5, 80]); });
    assert.deepEqual(seen.views, []);
    assert.deepEqual(seen.cohorts.early.all.at(-1), { kind: "split", part: "discovery" });
    assert.equal(f.ok, true);
    assert.deepEqual(f.n, { early: 100, durable: 80 });
  });
  test("a small arm is untestable, with the number that made it so", async () => {
    const f = await checkFeasibility(base(), async () => compareResult([1, 100], [1, 12]));
    assert.equal(f.ok, false);
    assert.match(f.reason!, /"durable" has 12 patients/);
  });
  test("an engine rejection is a reason, not a crash", async () => {
    const f = await checkFeasibility(base(), async () => { throw new Error("unknown attribute XYZ"); });
    assert.match(f.reason!, /rejected by the engine: unknown attribute XYZ/);
  });
});

describe("the funnel counts every registered hypothesis", () => {
  test("nulls and untestables stay in the denominator", () => {
    const row = (over: any) => ({ feasibility: { ok: true }, discovery: null, verdict: null, ...over });
    const c = { hypotheses: [
      row({ feasibility: { ok: false, reason: "small" }, verdict: "untestable" }),
      row({ discovery: { ok: true, p: 0.2 }, verdict: "not-supported" }),
      row({ discovery: { ok: true, p: 0.03 }, verdict: "not-supported" }),
      row({ discovery: { ok: true, p: 0.001 }, verdict: "not-replicated" }),
      row({ discovery: { ok: true, p: 1e-5 }, verdict: "replicated" })
    ] } as unknown as Campaign;
    assert.deepEqual(funnel(c), { registered: 5, testable: 4, tested: 4, nominal: 3, survivedCorrection: 2, replicated: 1 });
  });
});

describe("a categorical result names the value that moved", () => {
  test("the largest shift in share, among values both cohorts report", () => {
    const h: Hypothesis = { ...base(), doc: { ...base().doc, views: [{ kind: "clinical", attributes: ["SMOKING"] }] },
      primary: { view: 0, stat: "clinical", attribute: "SMOKING" }, direction: "any" };
    const r = compareResult([0, 100], [0, 50]);
    r.views[0] = { kind: "clinical", clinical: [{ attribute: "SMOKING", per: "patient", kind: "cat", test: "chi-squared", p: 0.01, cells: [
      { cohort: "early", n: 100, top: [{ v: "Former/Current", n: 80 }, { v: "Never", n: 15 }, { v: "Unknown", n: 5 }] },
      { cohort: "durable", n: 50, top: [{ v: "Former/Current", n: 45 }, { v: "Never", n: 5 }] }
    ] }] };
    const o = extractPrimary(h, r);
    assert.equal(o.effect, "Former/Current: 80.0% vs 90.0% (chi-squared)", "Unknown is absent from one list, so it is not compared");
  });
});

describe("cohort order survives storage", () => {
  // jsonb returns object keys shortest-first; "direction" must not flip when it does
  const reorder = (doc: any) => ({ ...doc, cohorts: Object.fromEntries(Object.entries(doc.cohorts).sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1))) });
  const longFirst = (): Hypothesis => ({ ...base(), doc: { ...base().doc, cohorts: { "early progression": { all: [] }, "durable control": { all: [] } } } });
  test("without pinning, a key reorder silently swaps the first cohort — the bug this guards", () => {
    const h = longFirst();
    assert.equal(primaryCohorts(h)[0], "early progression");
    assert.equal(primaryCohorts({ ...h, doc: reorder(h.doc) })[0], "durable control");
  });
  test("pinned, the order is an array and a reorder cannot touch it", () => {
    const p = pinCohortOrder(longFirst());
    assert.deepEqual((p.doc.views![0] as any).cohorts, ["early progression", "durable control"]);
    assert.deepEqual(primaryCohorts({ ...p, doc: reorder(p.doc) }), ["early progression", "durable control"]);
  });
  test("an explicit order is left alone, and the input is not mutated", () => {
    const h = longFirst();
    (h.doc.views![0] as any).cohorts = ["durable control", "early progression"];
    assert.equal(pinCohortOrder(h), h);
    const g = longFirst();
    pinCohortOrder(g);
    assert.equal((g.doc.views![0] as any).cohorts, undefined);
  });
});
