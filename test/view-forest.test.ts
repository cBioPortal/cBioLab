// The forest view's runner (lib/views/forest/run.ts), driven with hand-made participants: one
// exposure's hazard ratio per stratum (an attribute, the study or the cohort) from per-patient rows
// inside each patient-level study, pooled by DerSimonian–Laird; an aggregate-only participant is
// named as left out, never silently dropped (lib/views/forest/doc.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runForest } from "../lib/views/forest/run.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import type { ForestResult } from "../lib/views/forest/types.ts";
import { PRIMARY } from "../lib/ch.ts";

type Row = { t: number; event: number; values: (number | string)[] };
type Answer = { rows: Row[]; kinds: string[]; notProfiled: number };
type Fake = Record<string, unknown> & { instance: { id: string; mode: string; label: string; conn: unknown } };
const patientLevel = (answer: Answer | ((def: unknown, endpoint: string, axes: unknown, cols: unknown) => Answer)): Fake =>
  ({ instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY },
    coxRows: async (def: unknown, endpoint: string, axes: unknown, cols: unknown) => typeof answer === "function" ? answer(def, endpoint, axes, cols) : answer });
const aggregateOnly = (): Fake => ({ instance: { id: "agg", mode: "aggregate-only", label: "agg site", conn: PRIMARY } });

const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "SELECT 1", count: n, samples: n, mode: "patient-level" }])),
  count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});

function ctx(cohorts: Record<string, EvaluatedCohort>, resolvers: Record<string, Fake>, catalog: unknown[] = []): ViewRun {
  const vNames = Object.keys(cohorts);
  const vStudies = [...new Set(vNames.flatMap((n) => cohorts[n].studies))];
  return {
    doc: { study: vStudies[0], cohorts: Object.fromEntries(vNames.map((n) => [n, { study: cohorts[n].studies[0], name: n }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies,
    participationFor: (studies: string[], requiresPatientLevel: boolean): ViewParticipation =>
      ({ studies: [], requiresPatientLevel, aggregateOnly: studies.filter((s) => resolvers[s].instance.mode !== "patient-level") }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [], catalog: catalog as never }),
  };
}
const forestOf = (r: ViewResult) => (r as unknown as { forest: ForestResult }).forest;
const run = (view: Record<string, unknown>, c: ViewRun) => runForest({ kind: "forest", ...view } as never, c);
const TP53 = { source: "alteration", gene: "TP53" };

/** n patients of one stratum: every other one exposed, the exposed dying `shift` times sooner, a third censored */
function stratum(label: string, n: number, shift: number, exp: [string | number, string | number] = ["Mutated", "Not mutated"], extra: (i: number) => (number | string)[] = () => []): Row[] {
  return Array.from({ length: n }, (_, i) => {
    const exposed = i % 2 === 1;
    return { t: 1 + ((i * 7) % 23) / (exposed ? shift : 1), event: i % 3 === 0 ? 0 : 1, values: [exposed ? exp[0] : exp[1], label, ...extra(i)] };
  });
}

describe("forest: refusals before any data is read", () => {
  const one = () => ctx({ A: cohort({ s1: 100 }) }, { s1: patientLevel({ rows: [], kinds: ["cat", "cat"], notProfiled: 0 }) });
  const err = async (view: Record<string, unknown>, c = one()) => (await run(view, c)).error!;
  test("a malformed endpoint, or half an endpoint override", async () => {
    assert.match(await err({ exposure: TP53, endpoint: "1os" }), /bad survival endpoint '1OS'/);
    assert.match(await err({ exposure: TP53, monthsAttribute: "PFS_M" }), /monthsAttribute and statusAttribute must both be given/);
  });
  test("no exposure", async () => assert.match(await err({}), /a forest view needs an exposure/));
  test("more than 4 covariates", async () => {
    const cov = { source: "clinical", attribute: "AGE" };
    assert.match(await err({ exposure: TP53, covariates: [cov, cov, cov, cov, cov] }), /at most 4 covariates; this asks for 5/);
  });
  test("strata that is neither an attribute, study nor cohort", async () =>
    assert.match(await err({ exposure: TP53, strata: "not a name!" }), /strata is a categorical attribute, "study" or "cohort"; got "not a name!"/));
  test("strata study over one study, strata cohort over one cohort", async () => {
    assert.match(await err({ exposure: TP53, strata: "study" }), /needs cohorts spanning two or more studies; these span s1/);
    assert.match(await err({ exposure: TP53, strata: "cohort" }), /needs two or more cohorts; this view draws 1/);
  });
  test("thresholds out of range", async () => {
    assert.match(await err({ exposure: TP53, minPatients: 2 }), /minPatients is 5 to 100000/);
    assert.match(await err({ exposure: TP53, minEvents: 0 }), /minEvents is 1 to 100000/);
    assert.match(await err({ exposure: TP53, maxStrata: 61 }), /maxStrata is 2 to 60/);
  });
  test("every cohort empty", async () => {
    assert.equal(await err({ exposure: TP53 }, ctx({ A: cohort({ s1: 0 }) }, { s1: patientLevel({ rows: [], kinds: [], notProfiled: 0 }) })), "nothing to fit: the cohort is empty");
    assert.equal(await err({ exposure: TP53 }, ctx({ A: cohort({ s1: 0 }), B: cohort({ s1: 0 }) }, { s1: patientLevel({ rows: [], kinds: [], notProfiled: 0 }) })), "nothing to fit: every cohort is empty");
  });
  test("an invalid exposure or covariate axis, an unknown profile, and an exposure of none", async () => {
    assert.match(await err({ exposure: { source: "clinical", attribute: "bad name!" } }), /exposure axis: 'bad name!' is not a clinical attribute name/);
    assert.match(await err({ exposure: TP53, covariates: [{ source: "clinical", attribute: "bad name!" }] }), /covariate 1 axis/);
    assert.match(await err({ exposure: { source: "profile", profile: "mrna", gene: "TP53" } }), /exposure axis: s1 has no profile 'mrna'/);
    assert.match(await err({ exposure: { source: "none" } }), /the exposure axis is "none"/);
  });
});

describe("forest: nothing to fit", () => {
  test("only aggregate-only participants: named, since a Cox fit needs patient rows", async () => {
    const r = await run({ exposure: TP53 }, ctx({ A: cohort({ s2: 50 }) }, { s2: aggregateOnly() }));
    assert.equal(r.error, "no patient-level participant could answer: s2 answers with counts only, and a Cox fit needs patient rows");
  });
  test("no patient with every value names what was needed", async () => {
    const none = patientLevel({ rows: [], kinds: ["cat", "cat"], notProfiled: 0 });
    const r = await run({ exposure: TP53 }, ctx({ A: cohort({ s1: 50 }) }, { s1: none }));
    assert.equal(r.error, "no patient had a OS time, the exposure, a CANCER_TYPE on record");
    const r2 = await run({ exposure: TP53, strata: "cohort", covariates: [{ source: "clinical", attribute: "AGE" }] },
      ctx({ A: cohort({ s1: 50 }), B: cohort({ s1: 50 }) }, { s1: none }));
    assert.equal(r2.error, "no patient had a OS time, the exposure and every covariate on record");
  });
});

describe("forest: the exposure and strata as the data has them", () => {
  const c1 = (rows: Row[], kinds: string[]) => ctx({ A: cohort({ s1: rows.length }) }, { s1: patientLevel({ rows, kinds, notProfiled: 0 }) });
  test("a numeric stratum attribute is refused", async () =>
    assert.match((await run({ exposure: TP53, strata: "AGE" }, c1(stratum("A", 40, 2), ["cat", "num"]))).error!, /AGE is numeric; strata is a categorical attribute/));
  test("a numeric exposure needs a threshold; a categorical one refuses a threshold", async () => {
    const num = { source: "clinical", attribute: "TMB" };
    assert.match((await run({ exposure: num }, c1(stratum("A", 40, 2, [12, 3]), ["num", "cat"]))).error!, /TMB is numeric: give a threshold/);
    assert.match((await run({ exposure: TP53, threshold: 1 }, c1(stratum("A", 40, 2), ["cat", "cat"]))).error!, /mutation status is categorical: name the exposed level with exposed, not a threshold/);
  });
  test("a categorical attribute needs the exposed level named, from the values it takes", async () => {
    const smoker = { source: "clinical", attribute: "SMOKER" };
    const rows = stratum("A", 40, 2, ["Yes", "No"]);
    assert.match((await run({ exposure: smoker }, c1(rows, ["cat", "cat"]))).error!, /SMOKER is categorical: name the level counted as exposed with exposed — it takes No, Yes$/);
    assert.match((await run({ exposure: smoker, exposed: "Maybe" }, c1(rows, ["cat", "cat"]))).error!, /exposed level 'Maybe' is not a value of SMOKER here; it takes No, Yes/);
  });
  test("no stratum estimable: each listed with its reason", async () => {
    const r = await run({ exposure: TP53 }, c1(stratum("A", 20, 2), ["cat", "cat"]));
    assert.match(r.error!, /^no stratum could be estimated: Other \(1 strata\) \(pooled, the small strata still have fewer than 30 patients or 10 events\)/);
  });
});

describe("forest: a fit", () => {
  test("alteration exposure by cancer type: rows, pooled estimates, and every patient left out is counted", async () => {
    const rows = [...stratum("Lung", 80, 3), ...stratum("Breast", 60, 2),
      { t: 5, event: 1, values: ["Not profiled", "Lung"] }, { t: 5, event: 1, values: ["Mutated", "Multiple"] }, { t: -1, event: 1, values: ["Mutated", "Lung"] }];
    let asked: unknown[] = [];
    const c = ctx({ A: cohort({ s1: 150 }) }, { s1: patientLevel((_d, endpoint, axes) => { asked = [endpoint, axes]; return { rows, kinds: ["cat", "cat"], notProfiled: 2 }; }) });
    const r = await run({ exposure: TP53 }, c);
    assert.equal(r.error, undefined);
    assert.deepEqual(asked, ["OS", [TP53, { source: "clinical", attribute: "CANCER_TYPE" }]], "the exposure then the stratum attribute");
    const f = forestOf(r);
    assert.equal(f.exposedLabel, "TP53 mutated");
    assert.equal(f.strata, "CANCER_TYPE");
    assert.deepEqual(f.rows.map((x) => x.label), ["Lung", "Breast"], "largest first");
    assert.deepEqual([f.n, f.notProfiled], [140, 2]);
    assert.equal(f.missing, 150 - rows.length - 2);
    assert.ok(f.rows.every((x) => x.hr > 1), "the exposed die sooner in each");
    assert.ok(f.fixed && f.random && f.random.ciLow < f.random.hr && f.random.hr < f.random.ciHigh);
    assert.ok(Math.abs(f.rows.reduce((a, x) => a + x.weight, 0) - 1) < 1e-9);
    assert.match(r.caveat!, /univariate/);
    assert.match(r.caveat!, /Panel-aware: a patient not profiled for the gene is left out/);
    assert.match(r.caveat!, /1 patient whose samples carry different values of CANCER_TYPE were left out/);
    assert.match(r.caveat!, /2 patients had an exposure value that could not be coded/);
    assert.match(r.caveat!, /lacked the endpoint, the stratum or a covariate/);
    assert.match(r.caveat!, /DerSimonian–Laird random effects/);
    assert.equal(r.participation!.requiresPatientLevel, true);
  });

  test("numeric exposure with a threshold, strata by study, adjusted, an aggregate-only study left out by name", async () => {
    const age = (i: number) => [40 + ((i * 13) % 30)];
    const s1 = stratum("x", 60, 3, [20, 2], age), s2 = stratum("y", 50, 2, [15, 1], age);
    const c = ctx({ A: cohort({ s1: 60, s2: 50, s3: 9 }) }, { s1: patientLevel({ rows: s1.map((r) => ({ ...r, values: [r.values[0], r.values[2]] })), kinds: ["num", "num"], notProfiled: 0 }),
      s2: patientLevel({ rows: s2.map((r) => ({ ...r, values: [r.values[0], r.values[2]] })), kinds: ["num", "num"], notProfiled: 0 }), s3: aggregateOnly() });
    const r = await run({ exposure: { source: "clinical", attribute: "TMB" }, threshold: 10, strata: "study", covariates: [{ source: "clinical", attribute: "AGE" }] }, c);
    const f = forestOf(r);
    assert.equal(f.exposedLabel, "TMB ≥ 10");
    assert.equal(f.strata, "study");
    assert.deepEqual(f.covariates, ["AGE"]);
    assert.deepEqual(f.rows.map((x) => x.label), ["s1", "s2"]);
    assert.deepEqual(f.excludedRemote, [{ study: "s3", patients: 9 }]);
    assert.deepEqual(r.studies, ["s1", "s2", "s3"]);
    assert.match(r.caveat!, /adjusted there for AGE/);
    assert.match(r.caveat!, /Left out: s3 \(9 patients, aggregate-only\)/);
    assert.match(r.caveat!, /Clinical vocabularies are not harmonized/);
  });

  test("strata by cohort, a categorical exposed level, and an endpoint override", async () => {
    const smokers = (rs: Row[]) => rs.map((r) => ({ ...r, values: [r.values[0]] }));
    let cols: unknown;
    const c = ctx({ A: cohort({ s1: 60 }), B: cohort({ s1: 50 }) }, { s1: patientLevel((d, _e, _a, cc) => {
      cols = cc;
      const name = (d as { name: string }).name;
      return { rows: smokers(stratum(name, name === "A" ? 60 : 50, 2, ["Yes", "No"])), kinds: ["cat"], notProfiled: 0 };
    }) });
    const r = await run({ exposure: { source: "clinical", attribute: "SMOKER" }, exposed: "Yes", strata: "cohort", monthsAttribute: "PFS_M", statusAttribute: "PFS_S" }, c);
    const f = forestOf(r);
    assert.deepEqual(cols, { months: "PFS_M", status: "PFS_S" });
    assert.equal(f.endpoint, "PFS_M/PFS_S");
    assert.equal(f.exposedLabel, "SMOKER = Yes");
    assert.deepEqual(f.rows.map((x) => x.label), ["A", "B"]);
    assert.match(r.caveat!, /Cohorts may share patients/);
  });

  test("one estimable row is not pooled; a small stratum pooled into Other is disclosed", async () => {
    const rows = [...stratum("Lung", 80, 3), ...stratum("Rare1", 20, 2), ...stratum("Rare2", 20, 2)];
    const c = ctx({ A: cohort({ s1: rows.length }) }, { s1: patientLevel({ rows, kinds: ["cat", "cat"], notProfiled: 0 }) });
    const f = forestOf(await run({ exposure: TP53 }, c));
    assert.deepEqual(f.rows.map((x) => x.label), ["Lung", "Other (2 strata)"]);
    const r1 = await run({ exposure: TP53, small: "drop" }, c);
    const f1 = forestOf(r1);
    assert.deepEqual(f1.rows.map((x) => x.label), ["Lung"]);
    assert.equal(f1.random, null);
    assert.match(r1.caveat!, /Only one row could be estimated, so nothing is pooled/);
    assert.match(r1.caveat!, /Not estimated: Rare1 \(fewer than 30 patients or 10 events\)/);
    const r2 = await run({ exposure: TP53 }, c);
    assert.match(r2.caveat!, /“Other \(2 strata\)” pools Rare1, Rare2/);
  });

  test("the exposure's words: OQL, copy number, structural variant, a gene set", async () => {
    const rows = [...stratum("Lung", 80, 3), ...stratum("Breast", 60, 2)];
    const c = ctx({ A: cohort({ s1: rows.length }) }, { s1: patientLevel({ rows, kinds: ["cat", "cat"], notProfiled: 0 }) });
    const label = async (exposure: unknown) => forestOf(await run({ exposure }, c)).exposedLabel;
    assert.equal(await label({ source: "alteration", oql: "TP53: MUT" }), "TP53: MUT (altered)");
    assert.equal(await label({ source: "alteration", gene: "erbb2", by: "cna" }), "ERBB2 amplified or deeply deleted");
    assert.equal(await label({ source: "alteration", gene: "ALK", by: "sv" }), "ALK with a structural variant");
    assert.equal(await label({ source: "alteration", genes: ["KRAS", "NRAS"], by: "mutated" }), "KRAS or NRAS mutated");
  });
});

test("forest: a stratum where the exposure decides the events is listed as not converging, not drawn", async () => {
  // in "Sep" every exposed patient dies before any unexposed one: the log-HR runs off to infinity
  const sep: Row[] = Array.from({ length: 40 }, (_, i) => i % 2
    ? { t: 1 + i / 100, event: 1, values: ["Mutated", "Sep"] } : { t: 50 + i, event: 1, values: ["Not mutated", "Sep"] });
  const rows = [...stratum("Lung", 80, 3), ...stratum("Breast", 60, 2), ...sep];
  const c = ctx({ A: cohort({ s1: rows.length }) }, { s1: patientLevel({ rows, kinds: ["cat", "cat"], notProfiled: 0 }) });
  const f = forestOf(await run({ exposure: TP53 }, c));
  assert.deepEqual(f.rows.map((x) => x.label), ["Lung", "Breast"]);
  assert.deepEqual(f.left.map((l) => [l.label, l.n]), [["Sep", 40]]);
  assert.match(f.left[0].reason, /did not converge \(separation/);
});
