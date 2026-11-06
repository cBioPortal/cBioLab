// The riskmodel view's runner (lib/views/riskmodel/run.ts), driven with a hand-made patient-level
// participant: refusals before any fit, the fit itself (candidates are genes EVERY modelled patient's
// panels cover and that are mutated often enough; covariates; delayed entry; the validation half),
// the groups and caveat, Table 1 and external validation, and a refusal found while fitting
// (lib/views/riskmodel/doc.ts).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";

// lib/ch.ts reads these at import; riskFitDirect routes the study through the stand-in warehouse below
process.env.CLICKHOUSE_DB = "rmdb";
process.env.STUDY_ID = "rm_local";
process.env.AGGREGATE_ONLY_STUDIES = "rm_agg";

const { setChTransport, PRIMARY } = await import("../lib/ch.ts");
const { runRiskmodel, fitRiskmodel, riskFitDirect, riskModelView, RiskRefusal } = await import("../lib/views/riskmodel/run.ts");
type RiskFitArgs = import("../lib/views/riskmodel/run.ts").RiskFitArgs;
type RiskResolver = import("../lib/views/riskmodel/run.ts").RiskResolver;
type RiskmodelResult = import("../lib/views/riskmodel/types.ts").RiskmodelResult;
type ViewRun = import("../lib/views/run.ts").ViewRun;
type EvaluatedCohort = import("../lib/views/run.ts").EvaluatedCohort;
type ViewResult = import("../lib/types.ts").ViewResult;
type ViewParticipation = import("../lib/types.ts").ViewParticipation;

type Row = Record<string, unknown>;

/**
 * 120 patients. Gene A (mutated in every third patient) shortens survival sharply; B is mutated in
 * every fourth with no effect; C is too rare to be a candidate; D is mutated only where a whole-exome
 * patient has it, but the targeted panel P does not cover it, so no patient on P could be called
 * wild-type for it — it is never a candidate. Half the patients are whole-exome (WES covers all).
 */
const N = 120;
const patient = (i: number): Row => {
  const a = i % 3 === 0;
  const genes = [...(a ? ["A"] : []), ...(i % 4 === 0 ? ["B"] : []), ...(i % 10 === 0 ? ["C"] : []), ...(i % 2 === 0 && i % 5 === 0 ? ["D"] : [])];
  return { m: a ? 2 + (i % 7) : 20 + (i % 11), ev: i % 5 === 4 ? 0 : 1, half: Math.floor(i / 2) % 2, panels: i % 2 ? ["P"] : ["WES"], genes,
    stratum: i % 2 ? "X" : "Y", c0: String(40 + (i % 30)), c1: ["never", "former", "current"][i % 3 === 0 ? 2 : i % 2],
    anchored: 1, anchor_months: 0 };
};
const ROWS: Row[] = Array.from({ length: N }, (_, i) => patient(i));
const PANELS = [{ panel: "P", genes: ["A", "B", "C"] }];

interface Site { r: RiskResolver & { instance: unknown; viewAggregate: unknown }; labels: string[] }
/** a local patient-level participant: the rows query answers `rows`, metadata answers panels (and Table 1's attributes) */
function site(rows: Row[] | ((label: string) => Row[]) = ROWS, attrs: Row[] = []): Site {
  const labels: string[] = [];
  const queries: { label: string; sql: string; ms?: number }[] = [];
  const r = {
    instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY },
    queries,
    viewRows: async (label: string, _def: unknown, build: (c: string, s: string, d: string) => string) => {
      const sql = build("SELECT 'p' AS patient_id", "rm_local", "rmdb");
      labels.push(label); queries.push({ label, sql, ms: 1 });
      return typeof rows === "function" ? rows(label) : rows;
    },
    viewMeta: async (label: string, build: (s: string, d: string) => unknown) => {
      build("rm_local", "rmdb");
      labels.push(label); queries.push({ label, sql: "meta" });
      return label === "riskmodel:panels" ? PANELS : attrs;
    },
    viewAggregate: async () => [],
  };
  return { r: r as never, labels };
}

const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "SELECT 1", count: n, samples: n, mode: "patient-level" }])),
  count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});

function ctx(cohorts: Record<string, EvaluatedCohort>, resolvers: Record<string, unknown>, o: { pin?: string | null; fitWith?: Site; vNames?: string[] } = {}): ViewRun {
  const vNames = o.vNames ?? Object.keys(cohorts).slice(0, 1);
  const vStudies = [...new Set(vNames.flatMap((n) => cohorts[n].studies))];
  return {
    doc: { study: vStudies[0], cohorts: Object.fromEntries(Object.keys(cohorts).map((n) => [n, { study: cohorts[n].studies[0], all: [] }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies,
    participationFor: (studies: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies, requiresPatientLevel, aggregateOnly: [] } as never),
    pin: o.pin === undefined ? null : o.pin, studyProfiles: async () => ({ profiles: ["mutations"], gaProfiles: [] }),
    ...(o.fitWith ? { riskFit: (args: RiskFitArgs) => fitRiskmodel(o.fitWith!.r, args) } : {}),
  };
}
const one = (s: Site = site(), extra: Parameters<typeof ctx>[2] = {}) => ctx({ L: cohort({ rm_local: N }) }, { rm_local: s.r }, { fitWith: s, ...extra });
const rm = (r: ViewResult) => { assert.equal(r.error, undefined, String(r.error)); return (r as ViewResult & { riskmodel: RiskmodelResult }).riskmodel; };
const v = (o: Record<string, unknown> = {}) => ({ kind: "riskmodel", runs: 1, ...o }) as never;

describe("riskmodel: refusals before any fit", () => {
  const err = async (view: Record<string, unknown>, c: ViewRun = one()) => (await runRiskmodel(v(view), c) as ViewResult).error ?? "";

  test("one cohort, in one study, at a patient-level participant", async () => {
    const two = ctx({ L: cohort({ rm_local: N }), M: cohort({ rm_local: 5 }) }, { rm_local: site().r }, { vNames: ["L", "M"] });
    assert.match(await err({}, two), /fitted to one cohort; this view names 2/);
    assert.match(await err({}, ctx({ L: cohort({ rm_local: 5, other: 5 }) }, { rm_local: site().r, other: site().r })), /within one study; “L” spans 2 \(rm_local, other\)/);
    const agg = { instance: { id: "agg", mode: "aggregate-only", label: "agg", conn: PRIMARY } };
    assert.match(await err({}, ctx({ L: cohort({ rm_agg: 5 }) }, { rm_agg: agg })), /rm_agg answers in aggregate only/);
  });

  test("model settings out of range", async () => {
    assert.match(await err({ endpoint: "1os" }), /endpoint is a name like OS/);
    assert.match(await err({ monthsAttribute: "M" }), /monthsAttribute and statusAttribute go together/);
    assert.match(await err({ measure: "driver" }), /needs the OncoKB annotation/);
    assert.match(await err({ alpha: 1.5 }), /alpha, the l1 share/);
    for (const runs of [0, 1.5, 101]) assert.match(await err({ runs }), /runs is a whole number from 1 to 100/);
    for (const groups of [1, 6, 2.5]) assert.match(await err({ groups }), /groups is 2 to 5/);
    assert.match(await err({ minMutated: 4 }), /minMutated is a whole number of patients, at least 5/);
    assert.match(await err({ seed: 1.5 }), /seed is a whole number/);
    assert.match(await err({ labelAbove: 2 }), /labelAbove is a share of runs/);
  });

  test("cuts: not with groups, and 1 to 4 increasing quantiles strictly inside (0, 1)", async () => {
    assert.match(await err({ cuts: [0.5], groups: 2 }), /groups \(equal quantiles\) or cuts .*not both/);
    for (const cuts of [[], [0.2, 0.4, 0.6, 0.8, 0.9], [0.6, 0.4], [0], [1], ["0.5"]]) assert.match(await err({ cuts }), /cuts are 1 to 4 quantiles/, JSON.stringify(cuts));
  });

  test("attribute names, the covariate limit, duplicates and the anchor", async () => {
    assert.match(await err({ strata: "not a name!" }), /“not a name!” is not a clinical attribute's name/);
    assert.match(await err({ covariates: ["A", "B", "C", "D", "E", "F", "G"] }), /at most 6 covariates; this asks for 7/);
    assert.match(await err({ covariates: ["AGE", "AGE"] }), /listed twice, or is also the stratum/);
    assert.match(await err({ strata: "AGE", covariates: ["AGE"] }), /listed twice, or is also the stratum/);
    assert.match(await err({ anchor: { eventType: "" } }), /anchor needs eventType/);
  });

  test("describe: its shape, its names, and its limits", async () => {
    assert.match(await err({ describe: [] }), /describe is \{ attributes\?/);
    assert.match(await err({ describe: { attributes: [1] } }), /describe is \{ attributes\?/);
    assert.match(await err({ describe: { attributes: ["bad name"] } }), /“bad name” is not a clinical attribute's name/);
    assert.match(await err({ describe: { genes: ["-X"] } }), /“-X” is not a gene symbol/);
    assert.match(await err({ describe: { attributes: Array.from({ length: 21 }, (_, i) => "A" + i) } }), /at most 20 attributes/);
    assert.match(await err({ describe: { genes: Array.from({ length: 21 }, (_, i) => "G" + i) } }), /at most 20 genes/);
  });

  test("validateOn: another cohort of the document, in one patient-level study, and no covariates", async () => {
    const agg = { instance: { id: "agg", mode: "aggregate-only", label: "agg", conn: PRIMARY } };
    const s = site();
    const docOf = (vc: EvaluatedCohort, res: Record<string, unknown> = {}) => ctx({ L: cohort({ rm_local: N }), V: vc }, { rm_local: s.r, ...res }, { fitWith: s });
    assert.match(await err({ validateOn: "Nope" }, docOf(cohort({ rm_local: 5 }))), /“Nope” is not one \(it has “L”, “V”\)/);
    assert.match(await err({ validateOn: "L" }, docOf(cohort({ rm_local: 5 }))), /must name a different cohort/);
    assert.match(await err({ validateOn: "V" }, docOf(cohort({ a: 1, b: 1 }))), /scored within one study; “V” spans 2/);
    assert.match(await err({ validateOn: "V" }, docOf(cohort({ rm_agg: 3 }), { rm_agg: agg })), /rm_agg answers in aggregate only; scoring “V”/);
    assert.match(await err({ validateOn: "V", covariates: ["AGE"] }, docOf(cohort({ rm_local: 5 }))), /a model with covariates cannot be carried/);
  });

  test("patients × runs past the work limit names the runs that would fit", async () => {
    const big = ctx({ L: cohort({ rm_local: 40_000 }) }, { rm_local: site().r });
    assert.match(await err({ runs: 10 }, big), /at most 300,000 patients × runs .* 40,000 patients, so at most 7 runs/);
  });
});

describe("riskmodel: the fit", () => {
  test("candidates are the genes every panel covers and enough patients carry; the harmful gene is kept with HR > 1", async () => {
    const s = site();
    const r = await runRiskmodel(v({ minMutated: 20, runs: 2 }), one(s));
    const m = rm(r as ViewResult);
    assert.equal(m.n, N);
    assert.equal(m.events, ROWS.filter((x) => x.ev === 1).length);
    assert.equal(m.genesCovered, 3, "WES covers everything, so P's genes are the covered set");
    assert.equal(m.candidates, 2, "A and B; C is too rare, D is not on P");
    const a = m.features.find((f) => f.gene === "A");
    assert.ok(a && a.selected > 0 && a.hr > 1, "A shortens survival: " + JSON.stringify(a));
    assert.ok(!m.features.some((f) => f.gene === "D" || f.gene === "C"));
    assert.ok(m.cIndex.median > 0.6, "A separates survival: " + m.cIndex.median);
    assert.equal(m.cIndex.values.length, 2);
    assert.equal(m.groups.length, 3);
    // the highest-risk group holds the A carriers, so it dies sooner than the lowest
    assert.ok(m.groups[2].curve.median! < m.groups[0].curve.median!, "high risk dies sooner");
    assert.ok(m.logrank && m.logrank.p < 0.05);
    assert.equal(m.reportedOn, "held-out scores");
    assert.deepEqual(s.labels, ["riskmodel:rows", "riskmodel:panels"]);
    assert.ok(r.queries!.every((q) => q.study === "rm_local"), "the fit's queries are the view's provenance");
    assert.ok(r.method, "a method record");
    assert.match(r.caveat!, /Without strata, a gene that marks a cancer type/);
    assert.match(r.caveat!, /equal quantiles of the score, chosen without the outcome/);
    assert.deepEqual(r.participation, { studies: ["rm_local"], requiresPatientLevel: true, aggregateOnly: [] });
  });

  test("the same document gives the same model (seeded)", async () => {
    const a = rm(await runRiskmodel(v({ minMutated: 20, seed: 7 }), one()) as ViewResult);
    const b = rm(await runRiskmodel(v({ minMutated: 20, seed: 7 }), one()) as ViewResult);
    assert.deepEqual(a.cIndex.values, b.cIndex.values);
    assert.deepEqual(a.features, b.features);
  });

  test("covariates: numbers as they are, categories as indicators against the commonest value; strata named in the caveat", async () => {
    const m = await runRiskmodel(v({ minMutated: 20, strata: "CANCER_TYPE", covariates: ["AGE", "SMOKING"] }), one()) as ViewResult;
    const r = rm(m);
    assert.equal(r.strataLevels, 2);
    // c1 is "current" for every third patient (40), otherwise never/former by parity (40 each): the tie breaks alphabetically
    assert.deepEqual(r.covariates.map((c) => c.name), ["AGE", "SMOKING = former (vs current)", "SMOKING = never (vs current)"]);
    assert.match(m.caveat!, /within each CANCER_TYPE/);
    assert.match(m.caveat!, /and the covariates held fixed/);
  });

  test("patients missing a panel, the stratum or a covariate are left out and counted", async () => {
    const rows = ROWS.map((x, i) => i < 3 ? { ...x, panels: [] } : i < 5 ? { ...x, stratum: "" } : i < 9 ? { ...x, c0: null } : x);
    const r = rm(await runRiskmodel(v({ minMutated: 20, strata: "ST", covariates: ["AGE"] }), one(site(rows))) as ViewResult);
    assert.deepEqual([r.notProfiled, r.noStratum, r.noCovariate, r.n], [3, 2, 4, N - 9]);
  });

  test("an anchor delays entry; patients without it, anchored after day 0, or without follow-up after it are counted out", async () => {
    const rows = ROWS.map((x, i) => i === 1 ? { ...x, anchored: 0 } : i === 2 ? { ...x, anchor_months: 3 } : i === 4 ? { ...x, m: 0, anchor_months: -1 } : { ...x, anchor_months: -1 });
    const m = await runRiskmodel(v({ minMutated: 20, anchor: { eventType: "Treatment", key: "SUBTYPE", value: "Immuno", occurrence: "LAST" } }), one(site(rows))) as ViewResult;
    const r = rm(m);
    assert.deepEqual([r.noAnchor, r.anchorAfterStart, r.noFollowUp, r.n], [1, 1, 1, N - 3]);
    assert.equal(r.anchoredTo, "Treatment [SUBTYPE=Immuno] (LAST)");
    assert.match(m.caveat!, /The clock starts at Treatment \[SUBTYPE=Immuno\] \(LAST\); .*delayed entry/);
  });

  test("validate: trained on the discovery half, reported on the validation half", async () => {
    const m = await runRiskmodel(v({ minMutated: 10, validate: true }), one()) as ViewResult;
    const r = rm(m);
    assert.equal(r.reportedOn, "validation half");
    assert.deepEqual([r.validation!.discovery, r.validation!.validation], [60, 60]);
    assert.ok(r.validation!.cIndex > 0.6, "A still separates on unseen patients: " + r.validation!.cIndex);
    assert.equal(r.groups.reduce((a, g) => a + g.curve.n, 0), 60, "the curves are the validation half's");
    assert.match(m.caveat!, /trained on the discovery half/);
  });

  test("cuts: the chosen quantiles name their percentiles, and warn against cuts read off the curves", async () => {
    const m = await runRiskmodel(v({ minMutated: 20, cuts: [0.5, 0.8] }), one()) as ViewResult;
    assert.equal(rm(m).cutsChosen!.length, 2);
    assert.match(m.caveat!, /at the 50th, 80th percentiles of the score; if they were placed while looking at these curves/);
    const one3 = await runRiskmodel(v({ minMutated: 20, cuts: [0.333] }), one()) as ViewResult;
    assert.match(one3.caveat!, /at the 33.3rd percentile of the score/);
  });

  test("scores with few distinct values make fewer groups than asked, and the caveat says so", async () => {
    // one candidate gene and nothing else: every score is one of two values
    const rows = ROWS.map((x) => ({ ...x, genes: (x.genes as string[]).filter((g) => g === "A") }));
    const m = await runRiskmodel(v({ minMutated: 20, groups: 4 }), one(site(rows))) as ViewResult;
    const r = rm(m);
    assert.ok(r.groups.length < 4);
    assert.match(m.caveat!, new RegExp("Asked for 4 groups, made " + r.groups.length + ": the scores take only \\d+ distinct values"));
  });
});

describe("riskmodel: refusals found while fitting", () => {
  test("fewer than 50 modelled patients: about the cohort, with the queries that found it", async () => {
    const r = await runRiskmodel(v({}), one(site(ROWS.slice(0, 40)))) as ViewResult;
    assert.equal(r.error, "“L” has 40 patients with a survival time, a mutation panel and every covariate on record; a risk model needs at least 50");
    assert.deepEqual(r.queries!.map((q) => q.label), ["riskmodel:rows", "riskmodel:panels"]);
  });
  test("no candidate gene", async () => {
    const r = await runRiskmodel(v({ minMutated: 100 }), one()) as ViewResult;
    assert.match(r.error!, /^no gene covered for every patient is mutated in at least 100 of them; lower minMutated/);
  });
  test("a categorical covariate with more than 10 values", async () => {
    const rows = ROWS.map((x, i) => ({ ...x, c0: "v" + (i % 12) }));
    const r = await runRiskmodel(v({ minMutated: 20, covariates: ["SITE"] }), one(site(rows))) as ViewResult;
    assert.match(r.error!, /SITE takes 12 values among these patients; a categorical covariate takes at most 10/);
  });
  test("validation needs 50 patients in each half", async () => {
    const rows = ROWS.map((x, i) => ({ ...x, half: i < 80 ? 0 : 1 }));
    const r = await runRiskmodel(v({ minMutated: 20, validate: true }), one(site(rows))) as ViewResult;
    assert.match(r.error!, /validation needs at least 50 patients in each half; this cohort has 80 and 40/);
  });
  test("an error that is not a refusal is not turned into one", async () => {
    const c = { ...one(), riskFit: async () => { throw new Error("warehouse down"); } };
    await assert.rejects(runRiskmodel(v({}), c), /warehouse down/);
  });
});

describe("riskmodel: Table 1 and external validation", () => {
  const ATTRS = [{ id: "SEX", datatype: "STRING", patient: 1, priority: 1 }];
  const withAttr = (label: string) => label === "riskmodel:table1" ? ROWS.map((x, i) => ({ ...x, d0: i % 2 ? "Male" : "Female", r0: i % 2 ? "Male" : "Female", u0: 1 })) : ROWS;

  test("describe adds Table 1 over the curves' patients, its queries in the provenance", async () => {
    const s = site(withAttr, ATTRS);
    const m = await runRiskmodel(v({ minMutated: 20, describe: { attributes: ["SEX"], genes: ["A"] } }), one(s)) as ViewResult;
    const t = rm(m).table1!;
    assert.ok(t, "Table 1 is in the result");
    assert.ok(t.rows.some((x) => (x as { name?: string }).name === "SEX"));
    assert.ok(s.labels.includes("riskmodel:table1") && s.labels.includes("riskmodel:table1-attributes"));
    assert.ok(m.queries!.some((q) => q.label === "riskmodel:table1"));
    assert.match(m.caveat!, /Table 1 describes the patients the curves draw/);
  });

  test("Table 1 over rows that changed since the fit is refused, with both stages' queries", async () => {
    const s = site((label) => label === "riskmodel:table1" ? ROWS.slice(1) : ROWS, ATTRS);
    const m = await runRiskmodel(v({ minMutated: 20, describe: {} }), one(s)) as ViewResult;
    assert.match(m.error!, /Table 1 could not be matched to the model's patients/);
    assert.ok(m.queries!.some((q) => q.label === "riskmodel:rows") && m.queries!.some((q) => q.label === "riskmodel:table1"));
  });

  test("validateOn scores another cohort at the training cuts", async () => {
    const s = site();
    const vs = site();
    const c = ctx({ L: cohort({ rm_local: N }), V: cohort({ rm_v: 90 }) }, { rm_local: s.r, rm_v: vs.r }, { fitWith: s });
    const m = await runRiskmodel(v({ minMutated: 20, validateOn: "V" }), c) as ViewResult;
    const e = rm(m).external!;
    assert.ok(e, "external validation is in the result");
    assert.equal(e.cohortPatients, 90);
    assert.ok(e.cIndex > 0.6);
    assert.ok(m.queries!.some((q) => q.study === "rm_v"), "the validation's queries are marked as the other study's");
    assert.match(m.caveat!, /External validation on “V” \(rm_v\)/);
    assert.match(m.caveat!, /not harmonized/);
    // the same study: overlap is named
    const same = ctx({ L: cohort({ rm_local: N }), V: cohort({ rm_local: 90 }) }, { rm_local: s.r }, { fitWith: s });
    assert.match((await runRiskmodel(v({ minMutated: 20, validateOn: "V" }), same) as ViewResult).caveat!, /Both cohorts are in rm_local: a patient in both is not removed/);
  });

  test("a validation cohort too small to score is refused, its queries marked as its study's", async () => {
    const s = site();
    const c = ctx({ L: cohort({ rm_local: N }), V: cohort({ rm_v: 5 }) }, { rm_local: s.r, rm_v: site(ROWS.slice(0, 5)).r }, { fitWith: s });
    const m = await runRiskmodel(v({ minMutated: 20, validateOn: "V" }), c) as ViewResult;
    assert.match(m.error!, /“V” has \d+ patients a validation can score/);
    assert.ok(m.queries!.some((q) => q.study === "rm_v") && m.queries!.some((q) => q.study === "rm_local"));
  });
});

describe("riskmodel: the fit's key and the direct fitter", () => {
  // a stand-in warehouse holding rm_local (patient-level) and rm_agg (forced aggregate-only); it holds no patient rows
  const seen: string[] = [];
  setChTransport(async (st) => {
    seen.push(st.query);
    const data = /SELECT cancer_study_identifier AS id, name FROM rmdb\.cancer_study/.test(st.query) ? [{ id: "rm_local", name: "Local" }, { id: "rm_agg", name: "Agg" }] : [];
    return JSON.stringify({ meta: [], data, rows: data.length, statistics: { rows_read: 1, elapsed: 0, bytes_read: 0 } });
  });
  after(() => setChTransport(null));
  const args = (study: string): RiskFitArgs => ({ study, def: { all: [] } as never, compile: { oncokbPin: null, profiles: ["mutations"], gaProfiles: [] }, view: { kind: "riskmodel" } as never });

  test("riskModelView drops the presentation settings and sorts the rest", () => {
    const k = riskModelView({ kind: "riskmodel", runs: 5, groups: 4, cuts: undefined, labelAbove: 0.3, note: "x", cohorts: ["L"], alpha: 0.2, describe: {}, validateOn: "V" } as never);
    assert.deepEqual(Object.keys(k), ["alpha", "kind", "runs"]);
  });

  test("an aggregate-only study is refused: a model needs each patient's rows", async () => {
    await assert.rejects(riskFitDirect(args("rm_agg")), (e) => e instanceof RiskRefusal && /rm_agg answers in aggregate only/.test(e.message) && e.queries.length === 0);
  });
  test("a patient-level study is read through its own resolver; an empty cohort is refused with the queries it ran", async () => {
    await assert.rejects(riskFitDirect(args("rm_local")), (e) => e instanceof RiskRefusal && e.aboutCohort && /has 0 patients/.test(e.message) &&
      e.queries.some((q) => q.label === "riskmodel:rows"));
    assert.ok(seen.some((q) => /rmdb\./.test(q) && /panel/i.test(q)), "the panels query reached the warehouse");
  });
});
