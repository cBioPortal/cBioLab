// The organotropism view's runner (lib/views/organotropism/run.ts), driven with hand-made
// participants: which site source a cohort carries, the gene × site grid tested by CMH within
// strata, and, for timeline sites, the cumulative-incidence panel or the reason it is withheld
// (lib/views/organotropism/doc.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runOrganotropism } from "../lib/views/organotropism/run.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import type { OrganotropismResult } from "../lib/views/organotropism/types.ts";
import { PRIMARY } from "../lib/ch.ts";

type Rows = Record<string, unknown>[];
type Answers = Record<string, Rows | ((study: string) => Rows)>;

/** A participant that serves view aggregates: each query name (or its prefix up to ':' groups) answered from `answers`. */
function participant(id: string, answers: Answers, calls: string[] = []) {
  return {
    instance: { id, mode: "patient-level", label: id, conn: PRIMARY },
    async viewAggregate(name: string, def: unknown, build: (c: string, s: string, d: string) => unknown) {
      calls.push(name);
      build("SELECT 1 AS pid, 's1' AS sid", id, "db"); // the SQL builds for these inputs
      const key = Object.keys(answers).find((k) => name === k) ?? Object.keys(answers).find((k) => name.startsWith(k));
      const a = key == null ? [] : answers[key];
      return typeof a === "function" ? a(id) : a;
    },
  };
}
const remote = (id: string) => ({ instance: { id, mode: "aggregate-only", label: id, conn: PRIMARY } });

const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "SELECT 1", count: n, samples: n, mode: "patient-level" }])),
  count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});

function ctx(cohorts: Record<string, EvaluatedCohort>, resolvers: Record<string, unknown>, pin: string | null = "v4.20"): ViewRun {
  const vNames = Object.keys(cohorts);
  const vStudies = [...new Set(vNames.flatMap((n) => cohorts[n].studies))];
  return {
    doc: { study: vStudies[0], cohorts: Object.fromEntries(vNames.map((n) => [n, { study: cohorts[n].studies[0] }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies,
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
}
const org = (r: ViewResult) => (r as unknown as { organotropism: OrganotropismResult }).organotropism;
const run = (view: Record<string, unknown>, c: ViewRun) => runOrganotropism({ kind: "organotropism", ...view } as never, c);

// A flags-source cohort of 200: LIVER (60 with it) and BONE (3 with it, under minPatients 5).
const FLAG_SOURCES: Rows = [{ flag_patients: 200, flags: 2, timeline_patients: 0, sample_patients: 0 }];
const FLAG_SITES: Rows = [{ site: "LIVER", evaluable: 200, with_site: 60 }, { site: "CNS_BRAIN", evaluable: 200, with_site: 3 }];
const TOP: Rows = [{ gene: "TP53", altered: 40 }, { gene: "KRAS", altered: 30 }];
// two strata; TP53 strongly with LIVER, KRAS not at all
const COUNTS: Rows = [
  { site: "LIVER", gene: "TP53", stratum: "Colorectal", n: 100, with_site: 30, altered: 20, both: 16 },
  { site: "LIVER", gene: "TP53", stratum: "Breast", n: 100, with_site: 30, altered: 20, both: 15 },
  { site: "LIVER", gene: "KRAS", stratum: "Colorectal", n: 100, with_site: 30, altered: 15, both: 4 },
  { site: "LIVER", gene: "KRAS", stratum: "Breast", n: 100, with_site: 30, altered: 15, both: 3 },
];
const flagsAnswers = (over: Answers = {}): Answers => ({
  "organotropism:sources": FLAG_SOURCES, "organotropism:sites": FLAG_SITES, "organotropism:top": TOP, "organotropism:counts": COUNTS, ...over,
});

describe("organotropism: refusals before any query", () => {
  const one = () => ctx({ A: cohort({ s1: 200 }) }, { s1: participant("s1", flagsAnswers()) });
  const err = async (view: Record<string, unknown>, c = one()) => (await run(view, c)).error!;
  test("one cohort only", async () => {
    const c = ctx({ A: cohort({ s1: 5 }), B: cohort({ s1: 5 }) }, { s1: participant("s1", {}) });
    assert.match(await err({}, c), /reads one cohort; this one draws 2/);
  });
  test("bad source, prefix, attribute, stratifyBy and alteration name what is accepted", async () => {
    assert.match(await err({ source: "imaging" }), /source is auto, flags, timeline or sample; got "imaging"/);
    assert.match(await err({ flagPrefix: "bad prefix!" }), /flagPrefix is an attribute-name prefix/);
    assert.match(await err({ siteAttribute: "a;b" }), /siteAttribute is an attribute name/);
    assert.match(await err({ stratifyBy: "x y" }), /stratifyBy is a clinical attribute name, or null/);
    assert.match(await err({ alteration: "methylation" }), /alteration is mutation, cna, amp, homdel or sv/);
  });
  test("drivers need an OncoKB pin", async () => {
    const c = ctx({ A: cohort({ s1: 200 }) }, { s1: participant("s1", flagsAnswers()) }, null);
    assert.match(await err({}, c), /no OncoKB annotation pin.*set measure "any"/);
  });
  test("minPatients and top out of range", async () => {
    assert.match(await err({ minPatients: 0 }), /minPatients is 1 to 10000/);
    assert.match(await err({ top: 21 }), /top is 1 to 20 genes/);
  });
  test("too many genes, or one that is not a symbol", async () => {
    assert.match(await err({ genes: Array.from({ length: 21 }, (_, i) => "G" + i) }), /at most 20 genes; this asks for 21/);
    assert.match(await err({ genes: ["TP53", "not a gene"] }), /'NOT A GENE' is not a gene symbol/);
  });
  test("an empty cohort, and no participant that serves aggregates", async () => {
    assert.match(await err({}, ctx({ A: cohort({ s1: 0 }) }, { s1: participant("s1", {}) })), /cohort “A” is empty/);
    assert.match(await err({}, ctx({ A: cohort({ r1: 9 }) }, { r1: remote("r1") })), /no participant can answer: r1 is a remote peer/);
  });
});

describe("organotropism: the site source", () => {
  test("auto with no source at all lists what the cohort has", async () => {
    const c = ctx({ A: cohort({ s1: 50 }) }, { s1: participant("s1", { "organotropism:sources": [{ flag_patients: 0, flags: 0, timeline_patients: 0, sample_patients: 0 }] }) });
    const r = await run({}, c);
    assert.match(r.error!, /“A” has no metastatic sites from any source: it has 0 patients with DMETS_DX_\* flags \(0 flags\), 0 patients with Diagnosis \/ TUMOR_SITE on the timeline, 0 patients with METASTATIC_SITE/);
  });
  test("an asked source the cohort lacks is named", async () => {
    const c = ctx({ A: cohort({ s1: 50 }) }, { s1: participant("s1", flagsAnswers()) });
    assert.match((await run({ source: "timeline" }, c)).error!, /no metastatic sites from timeline Diagnosis events' TUMOR_SITE/);
    assert.match((await run({ source: "sample", siteAttribute: "BIOPSY" }, c)).error!, /the biopsy site of a sample, BIOPSY, mapped to organs/);
  });
  test("flag patients without any flag attribute do not count as a flags source", async () => {
    const c = ctx({ A: cohort({ s1: 50 }) }, { s1: participant("s1", { "organotropism:sources": [{ flag_patients: 9, flags: 0, timeline_patients: 0, sample_patients: 0 }] }) });
    assert.match((await run({}, c)).error!, /no metastatic sites from any source/);
  });
});

describe("organotropism: the grid", () => {
  test("flags: sites under minPatients drop, genes are the most altered, cells are CMH-tested within strata", async () => {
    const calls: string[] = [];
    const r = await run({ top: 2 }, ctx({ A: cohort({ s1: 200 }) }, { s1: participant("s1", flagsAnswers(), calls) }));
    assert.equal(r.error, undefined);
    const o = org(r);
    assert.equal(o.source, "flags");
    assert.equal(o.measure, "driver");
    assert.equal(o.stratifyBy, "CANCER_TYPE");
    assert.deepEqual(o.sites.map((s) => [s.site, s.label, s.withSite]), [["LIVER", "Liver", 60]]);
    assert.deepEqual(o.genes, [{ gene: "TP53", altered: 40 }, { gene: "KRAS", altered: 30 }]);
    const tp53 = o.cells.find((c) => c.gene === "TP53")!, kras = o.cells.find((c) => c.gene === "KRAS")!;
    assert.deepEqual([tp53.withSite, tp53.withAltered, tp53.without, tp53.withoutAltered, tp53.strata], [60, 31, 140, 9, 2]);
    assert.ok(tp53.or! > 1 && tp53.p! < 0.001 && tp53.q! < 0.05);
    assert.ok(kras.or! < 1);
    assert.equal(o.tested, 2);
    assert.ok(o.significant >= 1);
    assert.equal(o.otherValues, undefined, "only the sample source lists Other values");
    assert.equal(o.incidence, undefined); assert.equal(o.noIncidence, undefined, "flags have no dates, so no incidence panel");
    assert.match(r.caveat!, /per-organ flags DMETS_DX_<site>/);
    assert.match(r.caveat!, /stratified by CANCER_TYPE per patient .*2 strata\)/);
    assert.match(r.caveat!, /OncoKB store \(v4\.20\)/);
    assert.ok(!calls.includes("organotropism:other"));
  });

  test("asked genes skip the top-genes query; asked sites may include one under minPatients", async () => {
    const calls: string[] = [];
    const r = await run({ genes: ["tp53"], sites: ["cns brain", "LIVER"], measure: "any" },
      ctx({ A: cohort({ s1: 200 }) }, { s1: participant("s1", flagsAnswers(), calls) }));
    const o = org(r);
    assert.deepEqual(o.genes, [{ gene: "TP53" }]);
    assert.deepEqual(o.sites.map((s) => s.label), ["Liver", "CNS Brain"]);
    assert.ok(!calls.includes("organotropism:top"));
    const brain = o.cells.find((c) => c.site === "CNS_BRAIN")!;
    assert.equal(brain.p, null, "no counts for the cell: untested");
    assert.doesNotMatch(r.caveat!, /OncoKB store/, "measure any calls no drivers");
  });

  test("an asked site the cohort lacks is refused with the sites it has", async () => {
    const r = await run({ sites: ["Lung"] }, ctx({ A: cohort({ s1: 200 }) }, { s1: participant("s1", flagsAnswers()) }));
    assert.match(r.error!, /no site “lung” in “A”; its sites are Liver \(60\), CNS Brain \(3\)/);
  });

  test("no site reaching minPatients, and more than 30 sites, are refused", async () => {
    const few = await run({ minPatients: 100 }, ctx({ A: cohort({ s1: 200 }) }, { s1: participant("s1", flagsAnswers()) }));
    assert.match(few.error!, /no site has 100 or more patients with a metastasis there in “A”: Liver \(60\), CNS Brain \(3\)/);
    const many = Array.from({ length: 31 }, (_, i) => ({ site: "S" + i, evaluable: 100, with_site: 10 }));
    const r = await run({}, ctx({ A: cohort({ s1: 200 }) }, { s1: participant("s1", flagsAnswers({ "organotropism:sites": many })) }));
    assert.match(r.error!, /at most 30 sites; this asks for 31.*choose them with sites/);
  });

  test("no altered gene: names the alteration and the driver filter", async () => {
    const r = await run({ alteration: "amp" }, ctx({ A: cohort({ s1: 200 }) }, { s1: participant("s1", flagsAnswers({ "organotropism:top": [] })) }));
    assert.equal(r.error, "no patient of “A” has a amplification called an OncoKB driver on a covering panel");
  });

  test("sample source: values matching no organ are listed as Other, most patients first; unstratified says so", async () => {
    const answers: Answers = {
      "organotropism:sources": [{ flag_patients: 0, flags: 0, timeline_patients: 0, sample_patients: 80 }],
      "organotropism:sites": [{ site: "liver", label: "Liver", evaluable: 80, with_site: 20 }],
      "organotropism:other": [{ value: "soft tissue", patients: 3 }, { value: "omentum", patients: 7 }, { value: "axilla", patients: 3 }],
      "organotropism:top": TOP, "organotropism:counts": COUNTS.map((c) => ({ ...c, site: "liver", stratum: "" })),
    };
    const r = await run({ stratifyBy: null, alteration: "cna" }, ctx({ A: cohort({ s1: 80 }) }, { s1: participant("s1", answers) }));
    const o = org(r);
    assert.equal(o.source, "sample");
    assert.equal(o.stratifyBy, null);
    assert.equal(o.alteration, "amplification or deep deletion");
    assert.deepEqual(o.otherValues, [{ value: "omentum", patients: 7 }, { value: "axilla", patients: 3 }, { value: "soft tissue", patients: 3 }]);
    assert.match(r.caveat!, /counted as Other — here “omentum” \(7\), “axilla” \(3\), “soft tissue” \(3\)/);
    assert.match(r.caveat!, /not stratified \(stratifyBy null\)/);
    assert.match(r.caveat!, /copy-number panel/);
  });

  test("several studies: counts summed, a remote peer left out and named", async () => {
    const r = await run({ measure: "any", alteration: "sv" }, ctx({ A: cohort({ s1: 200, s2: 200, r1: 10 }) },
      { s1: participant("s1", flagsAnswers()), s2: participant("s2", flagsAnswers()), r1: remote("r1") }));
    const o = org(r);
    assert.equal(o.sites[0].withSite, 120);
    assert.deepEqual(o.genes.map((g) => g.altered), [80, 60]);
    assert.equal(o.cells.find((c) => c.gene === "TP53")!.strata, 4, "a study's strata stay its own");
    assert.deepEqual(o.excluded, [{ study: "r1", reason: "a remote peer, which does not serve this view's aggregates yet" }]);
    assert.deepEqual(r.studies, ["s1", "s2", "r1"]);
    assert.match(r.caveat!, /4 strata, kept per study/);
    assert.match(r.caveat!, /summed across 3 studies/);
    assert.match(r.caveat!, /Left out: r1/);
    assert.match(r.caveat!, /structural-variant panel/);
  });
});

describe("organotropism: timeline sites and the incidence panel", () => {
  const TL_SOURCES: Rows = [{ flag_patients: 0, flags: 0, timeline_patients: 200, sample_patients: 0 }];
  const TL_SITES: Rows = [{ site: "liver", label: "Liver", evaluable: 200, with_site: 60 }];
  const TL_COUNTS = COUNTS.map((c) => ({ ...c, site: "liver" }));
  // per arm: one row per (t, cause) group; altered patients reach the site sooner
  const arm = (altered: boolean, late = 0): Rows => [
    { kind: "prior", n: 2 }, { kind: "unobserved", n: 1 }, { kind: "nofollowup", n: 3 },
    { kind: "event", entry: 0, t: altered ? 6 : 30, cause: 1, n: altered ? 12 : 4, late: 0 },
    { kind: "event", entry: 2, t: 40, cause: 2, n: 3, late: 0 },
    { kind: "event", entry: 0, t: 70, cause: 0, n: altered ? 2 : 10, late: 0 },
    ...(late ? [{ kind: "event", entry: 0, t: 50, cause: 1, n: late, late: 1 }] : []),
  ];
  const tlAnswers = (over: Answers = {}): Answers => ({
    "organotropism:sources": TL_SOURCES, "organotropism:sites": TL_SITES, "organotropism:top": TOP, "organotropism:counts": TL_COUNTS,
    "organotropism:incidence:altered": arm(true), "organotropism:incidence:wildtype": arm(false), ...over,
  });
  const one = (a: Answers) => ctx({ A: cohort({ s1: 200 }) }, { s1: participant("s1", a) });

  test("by default the grid's most significant cell is followed, death competing, with Gray's test", async () => {
    const r = await run({}, one(tlAnswers()));
    const o = org(r);
    assert.equal(o.source, "timeline");
    const inc = o.incidence!;
    assert.equal(inc.site, "Liver"); assert.equal(inc.gene, "TP53");
    assert.deepEqual(inc.curves.map((c) => c.cohort), ["TP53 altered", "TP53 not altered"]);
    assert.deepEqual(inc.curves.map((c) => [c.events, c.competing, c.censored]), [[12, 3, 2], [4, 3, 10]]);
    for (const c of inc.curves) {
      assert.equal(c.n, 17);
      assert.deepEqual(c.excluded, { prior: 2, unobserved: 1, noFollowup: 3, noAnchor: 0 });
    }
    assert.equal(inc.records, 34); assert.equal(inc.late, 0);
    assert.deepEqual(inc.horizons.map((h) => h.months), [12, 24, 60]);
    const at12 = inc.horizons[0].cells;
    assert.ok(at12[0].f1 > 0.4 && at12[1].f1 === 0, "altered reach the site by 6 months, the rest not before 30");
    assert.ok(at12[0].lo >= 0 && at12[0].hi <= 1 && at12[0].lo <= at12[0].f1 && at12[0].f1 <= at12[0].hi);
    assert.equal(at12[1].atRisk, 17, "everyone not yet out is at risk at 12 months");
    assert.equal(inc.gray!.permutations, 2000);
    assert.ok(inc.gray!.p < 0.05);
    assert.match(r.caveat!, /cumulative incidence of the first Liver event .* for patients profiled for TP53/);
    assert.match(r.caveat!, /TP53 altered 2, TP53 not altered 2/);
    assert.match(r.caveat!, /timeline Diagnosis events' TUMOR_SITE|values of TUMOR_SITE on Diagnosis timeline events/);
  });

  test("an asked site and gene are followed instead", async () => {
    const r = await run({ incidence: { site: "LIVER", gene: "kras" } }, one(tlAnswers()));
    assert.equal(org(r).incidence!.gene, "KRAS");
    assert.equal(org(r).incidence!.site, "Liver");
  });

  test("incidence null draws no panel and says nothing about one", async () => {
    const calls: string[] = [];
    const r = await run({ incidence: null }, ctx({ A: cohort({ s1: 200 }) }, { s1: participant("s1", tlAnswers(), calls) }));
    assert.equal(org(r).incidence, undefined); assert.equal(org(r).noIncidence, undefined);
    assert.ok(!calls.some((c) => c.startsWith("organotropism:incidence")));
  });

  test("an unknown incidence site or a bad gene is refused", async () => {
    assert.match((await run({ incidence: { site: "Lung" } }, one(tlAnswers()))).error!, /incidence.site “lung” is not a site of “A”; its sites are Liver/);
    assert.match((await run({ incidence: { gene: "no gene" } }, one(tlAnswers()))).error!, /incidence.gene 'NO GENE' is not a gene symbol/);
  });

  test("no tested cell: no site and gene to follow", async () => {
    const r = await run({ minPatients: 50 }, one(tlAnswers({ "organotropism:sites": [{ site: "liver", label: "Liver", evaluable: 200, with_site: 60 }] })));
    const o = org(r);
    assert.equal(o.tested, 0);
    assert.equal(o.noIncidence, "no cell was tested, so there is no site and gene to follow over time");
    assert.match(r.caveat!, /No incidence panel: no cell was tested/);
  });

  test("more than 5% of records with the site after the last follow-up: the clocks disagree, no panel", async () => {
    const r = await run({}, one(tlAnswers({ "organotropism:incidence:altered": arm(true, 4) })));
    const o = org(r);
    assert.equal(o.incidence, undefined);
    assert.match(o.noIncidence!, /^4 patients of 38 have their first Liver event after their last follow-up/);
  });

  test("an arm under 10 patients: no panel, naming the arms' sizes", async () => {
    const small: Rows = [{ kind: "event", entry: 0, t: 5, cause: 1, n: 4, late: 0 }];
    const r = await run({}, one(tlAnswers({ "organotropism:incidence:wildtype": small })));
    assert.match(org(r).noIncidence!, /fewer than 10 patients in a group \(TP53 altered 17, TP53 not altered 4\) for the incidence of Liver/);
  });
});
