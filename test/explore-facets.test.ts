// Explore's facets (lib/explore.ts) beyond the gene tables: the portal's numeric bin edges, how
// participants' facets merge (counts summed before dividing, overlap not deduplicated), a single
// study's clinical / derived / per-gene facets with their disjunctive counting, the draft resolved
// once and shipped as a table (or inlined past the bound), the multi-study pass pooled per
// connection, and the generic-assay charts. The warehouse is a stand-in (setChTransport) that
// answers each statement by what it reads.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "cbio_a";
process.env.CLICKHOUSE_USER = "u";
process.env.CLICKHOUSE_PASSWORD = "p";
// a draft of more than three (patient, sample) rows is not shipped as a table
process.env.EXPLORE_COHORT_EXTERNAL_LIMIT = "3";
for (const k of ["CLICKHOUSE2_URL", "ONCOKB_PIN", "FEDERATION_PEERS", "CH_RUN_CACHE"]) delete process.env[k];

const { setChTransport, PRIMARY } = await import("../lib/ch.ts");
const { numericBinEdges, mergeExplore, buildExplore, buildExploreFederated, buildAssayFacets, ASSAY_CHART_LIMIT } = await import("../lib/explore.ts");
type ExploreResult = import("../lib/types.ts").ExploreResult;
type ChConn = import("../lib/ch.ts").ChConn;
type Row = Record<string, unknown>;

let sent: string[] = [];
let answers: [RegExp, Row[] | ((q: string) => Row[])][] = [];
setChTransport(async ({ query }) => {
  sent.push(query);
  for (const [re, rows] of answers) if (re.test(query)) {
    const data = typeof rows === "function" ? rows(query) : rows;
    return JSON.stringify({ meta: [], data, rows: data.length });
  }
  return JSON.stringify({ meta: [], data: [], rows: 0 });
});
after(() => setChTransport(null));
beforeEach(() => { sent = []; answers = []; });
const on = (re: RegExp, rows: Row[] | ((q: string) => Row[])) => { answers.push([re, rows]); };
const fail = (re: RegExp) => on(re, () => { throw new Error("no such table"); });

const SECOND: ChConn = { id: "b", url: "http://second.invalid", user: "u", password: "p", db: "cbio_b", label: "second" } as ChConn;

describe("numeric bin edges (the portal's LinearDataBinner)", () => {
  test("a range with no width has no bins", () => {
    assert.deepEqual(numericBinEdges(5, 5, 5, 5, true), { edges: [], interval: 0 });
  });
  test("integers 0–100 take the smallest interval giving at most 20 bins", () => {
    const { edges, interval } = numericBinEdges(0, 100, 25, 75, true);
    assert.equal(interval, 5);
    assert.equal(edges[0], 5);
    assert.equal(edges.at(-1), 95);
    assert.ok(edges.every((e, i) => i === 0 || e - edges[i - 1] === 5));
  });
  test("outliers past 1.5 IQR are cut off into the end bars, not given bins of their own", () => {
    const { edges, interval } = numericBinEdges(0, 1000, 10, 20, false);
    assert.equal(interval, 2); // the 0–35 inlier range, not 0–1000
    assert.ok(edges.at(-1)! <= 35);
  });
  test("decimal data gets a decimal interval, and edges carry no float noise", () => {
    const { edges, interval } = numericBinEdges(0, 1, 0.25, 0.75, false);
    assert.equal(interval, 0.05);
    assert.equal(edges[0], 0.05);
    assert.ok(edges.includes(0.15));
    assert.ok(edges.every((e) => String(e).length <= 4));
  });
  test("decimal data keeps its last interior edge, as integer data does (0–1 by 0.05 ends at 0.95, as 0–100 by 5 ends at 95)", () => {
    assert.equal(numericBinEdges(0, 1, 0.25, 0.75, false).edges.at(-1), 0.95);
  });
  test("integer data never gets a fractional interval", () => {
    assert.equal(numericBinEdges(0, 6, 1, 4, true).interval, 1);
  });
});

describe("merging participants' facets", () => {
  const part = (o: Partial<ExploreResult>): ExploreResult => ({
    study: "s", draftCount: null, clinical: [], events: [], caseLists: [], profiles: [], gaProfiles: [], stats: { ms: 0 }, ...o,
  } as ExploreResult);

  test("one participant is returned as it is", () => {
    const p = part({ study: "only" });
    assert.equal(mergeExplore([p]), p);
  });

  test("counts are summed across participants, frequencies divided only after summing", () => {
    const a = part({
      study: "s1", draftCount: 10, totals: { patients: 100, samples: 110 },
      studyBreakdown: [{ study: "s1", n: 10, instance: "a", instanceLabel: "primary" }],
      clinical: [
        { attribute: "SEX", per: "patient", kind: "cat", patients: 90, distinct: 2, values: [{ v: "Female", n: 50 }, { v: "Male", n: 40 }] },
        { attribute: "AGE", per: "patient", kind: "num", patients: 80, min: 20, max: 70, median: 50, displayName: "Age", priority: 3 },
        { attribute: "STAGE", per: "patient", kind: "cat", patients: 5, distinct: 3, values: [{ v: "I", n: 5 }] },
      ],
      events: [{ type: "Treatment", n: 7 }],
      caseLists: [{ id: "all", name: "All", n: 100 }],
      dataTypes: [{ profile: "mutations", label: "Mutations", alterationType: "MUTATION_EXTENDED", n: 90 }],
      derived: [{ metric: "followupMonths", label: "Follow-up", unit: "months", note: "n", covered: 9,
        buckets: [{ label: "< 6mo", n: 4, lt: 6 }, { label: "> 5y", n: 5, gte: 60 }] }],
      geneFacets: [{ gene: "EGFR", type: "MUTATION", per: "sample", total: 110, profiled: 100,
        states: [{ state: "altered", label: "Mutated", n: 10 }, { state: "unaltered", label: "Not mutated", n: 90 }] }],
      profiles: ["mutations"], gaProfiles: ["mutational_signature"],
      geneTotals: { mutated: 3, cna: 0, sv: 1 },
    });
    const b = part({
      study: "s2", draftCount: 5, totals: { patients: 50, samples: 50 },
      studyBreakdown: [{ study: "s2", n: 5, instance: "b", instanceLabel: "second" }],
      clinical: [
        { attribute: "SEX", per: "patient", kind: "cat", patients: 40, distinct: 3, disjunctive: true,
          values: [{ v: "Male", n: 30 }, { v: "Female", n: 10 }] },
        { attribute: "AGE", per: "patient", kind: "num", patients: 20, min: 10, max: 90, median: 60 },
        // a study that records STAGE as a number: the kind of the study with more patients wins
        { attribute: "STAGE", per: "patient", kind: "num", patients: 30, min: 1, max: 4, median: 2 },
      ],
      events: [{ type: "Treatment", n: 3 }, { type: "Status", n: 20 }],
      caseLists: [{ id: "all", name: "All", n: 50 }, { id: "cna", name: "CNA", n: 40 }],
      dataTypes: [{ profile: "mutations", label: "Mutations", alterationType: "MUTATION_EXTENDED", n: 45 }],
      derived: [{ metric: "followupMonths", label: "Follow-up", unit: "months", note: "n", covered: 6, disjunctive: true,
        buckets: [{ label: "< 6mo", n: 1, lt: 6 }, { label: "6–12mo", n: 2, gte: 6, lt: 12 }, { label: "> 5y", n: 3, gte: 60 }] },
      { metric: "lines", eventType: "Treatment", lineGap: 90, label: "Lines", unit: "lines", note: "n", covered: 2,
        buckets: [{ label: "1", n: 2, lt: 2 }] }],
      geneFacets: [{ gene: "EGFR", type: "MUTATION", per: "sample", total: 50, profiled: 20,
        states: [{ state: "altered", label: "Mutated", n: 4 }, { state: "notProfiled", label: "Not profiled", n: 30 }] }],
      profiles: ["mutations", "cna"], gaProfiles: [],
      geneTotals: { mutated: 7, cna: 2, sv: 0 },
    });
    // a gene-only participant (the pooled gene tables): it names no study
    const genes = part({ study: "", studies: [],
      mutatedGenes: [{ gene: "KRAS", altered: 3, events: 3, profiled: 30, freqPct: 10 }] as never });
    const genes2 = part({ study: "", studies: [],
      mutatedGenes: [{ gene: "KRAS", altered: 2, alteredOnPanel: 1, events: 4, profiled: 70, freqPct: 1.4, cytoband: "12p12.1" }] as never });

    const m = mergeExplore([a, b, genes, genes2]);
    assert.deepEqual(m.studies, ["s1", "s2"]);
    assert.equal(m.study, "s1 + s2");
    assert.equal(m.draftCount, 15);
    assert.deepEqual(m.totals, { patients: 150, samples: 160 });
    assert.deepEqual(m.studyBreakdown!.map((r) => r.study), ["s1", "s2"]);
    assert.deepEqual(m.stats.perStudy, { s1: 10, s2: 5 }, "keyed by each part's own study; the gene-only parts add no key");

    const facet = (n: string) => m.clinical.find((c) => c.attribute === n)!;
    assert.deepEqual(m.clinical.map((c) => c.attribute), ["AGE", "SEX", "STAGE"], "declared priority first, then patients");
    const sex = facet("SEX");
    assert.ok(sex.kind === "cat");
    assert.deepEqual(sex.values, [{ v: "Male", n: 70 }, { v: "Female", n: 60 }]);
    assert.equal(sex.patients, 130);
    assert.equal(sex.studyCount, 2);
    assert.equal(sex.distinct, 3);
    assert.equal((sex as { disjunctive?: boolean }).disjunctive, true, "one participant counted it without its own clauses");
    const age = facet("AGE");
    assert.ok(age.kind === "num");
    assert.deepEqual([age.min, age.max, age.median, age.displayName, age.priority], [10, 90, 52, "Age", 3]);
    const stage = facet("STAGE");
    assert.equal(stage.kind, "num");
    assert.equal(stage.patients, 30, "only the participants of the winning kind are counted");

    assert.deepEqual(m.events, [{ type: "Status", n: 20 }, { type: "Treatment", n: 10 }]);
    assert.deepEqual(m.caseLists, [{ id: "all", name: "All", n: 150 }, { id: "cna", name: "CNA", n: 40 }]);
    assert.deepEqual(m.dataTypes, [{ profile: "mutations", label: "Mutations", alterationType: "MUTATION_EXTENDED", n: 135 }]);
    assert.deepEqual(m.profiles, ["mutations", "cna"]);
    assert.deepEqual(m.gaProfiles, ["mutational_signature"]);
    assert.deepEqual(m.geneTotals, { mutated: 7, cna: 2, sv: 1 });

    const fu = m.derived!.find((d) => d.metric === "followupMonths")!;
    assert.deepEqual(fu.buckets, [{ label: "< 6mo", n: 5, lt: 6 }, { label: "6–12mo", n: 2, gte: 6, lt: 12 }, { label: "> 5y", n: 8, gte: 60 }],
      "the bucket shape is the fullest participant's, so one that dropped an empty bucket does not truncate it");
    assert.equal(fu.covered, 15);
    assert.equal(fu.disjunctive, true);
    const lines = m.derived!.find((d) => d.metric === "lines")!;
    assert.deepEqual([lines.eventType, lines.lineGap, lines.covered], ["Treatment", 90, 2]);

    const egfr = m.geneFacets![0];
    assert.deepEqual([egfr.total, egfr.profiled], [160, 120]);
    assert.deepEqual(egfr.states.map((s) => [s.state, s.n]), [["altered", 14], ["unaltered", 90], ["notProfiled", 30]]);
    assert.equal(a.geneFacets![0].states[0].n, 10, "the parts are not mutated");

    const kras = m.mutatedGenes![0];
    assert.deepEqual([kras.gene, kras.altered, kras.events, kras.profiled, kras.alteredOnPanel, kras.cytoband], ["KRAS", 5, 7, 100, 4, "12p12.1"]);
    assert.equal(kras.freqPct, 4, "altered on panel ÷ profiled, after summing: 4 / 100");
  });

  test("without a draft the merged draft count is null; a facet no participant has is not invented", () => {
    const m = mergeExplore([part({ study: "x", derived: [{ metric: "alteredGenes", label: "g", unit: "genes", note: "", covered: 0, buckets: [] }] }), part({ study: "y" })]);
    assert.equal(m.draftCount, null);
    assert.equal(m.derived, undefined);
    assert.deepEqual(m.mutatedGenes, []);
  });
});

// ---- one study -----------------------------------------------------------------------------
const S = "st1";
/** the facet queries' rows for one study (on the primary unless `db` says otherwise) */
function facetAnswers(s = S) {
  on(/AS pts, uniqExact\(sample_unique_id\) AS smp/, [{ s, pts: 100, smp: 120 }]);
  on(/cam\.attr_id AS a/, [
    { s, a: "AGE", datatype: "NUMBER", display_name: "Age", description: "at diagnosis", priority: "5" },
    { s, a: "SEX", datatype: "STRING", display_name: "Sex", description: "", priority: "1" },
  ]);
  on(/AS numratio/, [
    { s, type: "patient", a: "SEX", nv: 2, numratio: 0, np: 100 },
    { s, type: "patient", a: "AGE", nv: 50, numratio: 1, np: 90, mn: 20, mx: 80, md: 55, na: 10 },
    // no metadata: sniffed from its values, numeric when nearly all are numbers and they are many
    { s, type: "sample", a: "TMB", nv: 40, numratio: 0.95, np: 110, mn: 0, mx: 30, md: 5, na: 10 },
    { s, type: "sample", a: "CODE", nv: 5, numratio: 1, np: 120 },
  ]);
  on(/AS vkey/, [
    { s, type: "patient", a: "SEX", v: "Female", n: 60 }, { s, type: "patient", a: "SEX", v: "Male", n: 40 },
    { s, type: "sample", a: "CODE", v: "1", n: 120 },
  ]);
  on(/ce\.event_type AS t/, [{ s, t: "Treatment", n: 50 }]);
  on(/AS atype/, [{ s, profile: "mutations", label: "Mutations", atype: "MUTATION_EXTENDED", n: 110 }]);
  on(/sl\.stable_id AS id/, [{ s, id: s + "_all", name: "All samples", n: 100 }]);
  on(/attribute_value AS v, uniqExact/, [
    { type: "patient", a: "AGE", v: "30", n: 40 }, { type: "patient", a: "AGE", v: "60", n: 50 },
    { type: "sample", a: "TMB", v: "5", n: 100 },
  ]);
}

describe("one study", () => {
  test("clinical facets: declared type first, sniffed only without metadata, in the portal's order, with histograms and NA counts", async () => {
    facetAnswers();
    const r = await buildExplore({ study: S, conn: PRIMARY });
    assert.equal(r.draftCount, null);
    assert.deepEqual(r.totals, { patients: 100, samples: 120 });
    assert.deepEqual(r.studyBreakdown, [{ study: S, n: 100, instance: "a", instanceLabel: "primary" }]);
    assert.deepEqual(r.clinical.map((c) => [c.attribute, c.kind]), [["AGE", "num"], ["SEX", "cat"], ["CODE", "cat"], ["TMB", "num"]]);
    const age = r.clinical[0];
    assert.ok(age.kind === "num");
    assert.deepEqual([age.displayName, age.description, age.priority, age.min, age.max, age.median], ["Age", "at diagnosis", 5, 20, 80, 55]);
    assert.equal(age.bins!.reduce((n, b) => n + b.count, 0), 90);
    assert.equal(age.naCount, 10, "the cohort's patients without a value: 100 − 90");
    const tmb = r.clinical[3];
    assert.ok(tmb.kind === "num");
    assert.equal(tmb.naCount, 20, "a sample attribute's NA is counted against samples: 120 − 100");
    const sex = r.clinical[1];
    assert.ok(sex.kind === "cat");
    assert.deepEqual(sex.values, [{ v: "Female", n: 60 }, { v: "Male", n: 40 }]);
    assert.equal(sex.disjunctive, undefined);
    assert.deepEqual(r.events, [{ type: "Treatment", n: 50 }]);
    assert.deepEqual(r.caseLists, [{ id: "all", name: "All samples", n: 100 }]);
    assert.deepEqual(r.dataTypes, [{ profile: "mutations", label: "Mutations", alterationType: "MUTATION_EXTENDED", n: 110 }]);
    assert.deepEqual(r.derived, []);
    assert.deepEqual(r.geneFacets, []);
  });

  test("skipping bins and genes sends neither the histogram nor any gene-table statement", async () => {
    facetAnswers();
    const r = await buildExplore({ study: S, skipBins: true, skipGenes: true });
    assert.ok(!sent.some((q) => /attribute_value AS v, uniqExact/.test(q)));
    assert.ok(!sent.some((q) => /genomic_event_derived/.test(q)));
    assert.deepEqual(r.geneTotals, { mutated: 0, cna: 0, sv: 0 });
    const age = r.clinical.find((c) => c.attribute === "AGE")!;
    assert.ok(age.kind === "num" && age.bins === undefined);
  });

  test("an attribute allow-list narrows the clinical scan to the names it allows", async () => {
    facetAnswers();
    await buildExplore({ study: S, skipBins: true, skipGenes: true, attributes: ["AGE", "bad name;"] });
    const cls = sent.find((q) => /AS numratio/.test(q))!;
    assert.match(cls, /AND attribute_name IN \('AGE'\)/);
  });

  describe("derived facets", () => {
    test("only the requested ones, filled to their spec, empty buckets dropped; one whose table is missing is left out", async () => {
      facetAnswers();
      on(/max\(ce\.start_date\) \//, [{ b: 0, n: 5 }, { b: 4, n: 3 }, { b: 5, n: 99 }]);
      on(/max\(line_no\) AS v/, [{ b: 0, n: 2 }, { b: 3, n: 1 }]);
      on(/coalesce\(ce\.stop_date/, [{ b: 1, n: 4 }]);
      fail(/greatest\(0, -min\(ce\.start_date\)\)/);
      on(/uniqExact\(hugo_gene_symbol\) AS v/, []);
      const r = await buildExplore({ study: S, skipBins: true, skipGenes: true, derived: [
        { metric: "followupMonths" }, { metric: "historyMonths" }, { metric: "alteredGenes" },
        { metric: "lines", eventType: " Treatment ", lineGap: 99999 }, { metric: "treatmentSpan", eventType: "Treatment" },
        { metric: "lines" }, { metric: "bogus" as never, eventType: "x" },
      ] });
      assert.deepEqual(r.derived!.map((d) => d.metric), ["followupMonths", "lines", "treatmentSpan"],
        "history failed, altered genes had no patients, and the two malformed requests are not facets");
      const [fu, lines, span] = r.derived!;
      assert.deepEqual(fu.buckets, [{ label: "< 6mo", n: 5, lt: 6 }, { label: "> 5y", n: 3, gte: 60 }], "a value outside every cut is no bucket");
      assert.equal(fu.covered, 8);
      assert.equal(fu.disjunctive, undefined);
      assert.deepEqual([lines.eventType, lines.lineGap, lines.label], ["Treatment", 3650, "Lines of 'Treatment'"], "the gap is clamped to ten years");
      assert.deepEqual(lines.buckets.map((b) => [b.label, b.n]), [["1", 2], ["4+", 1]]);
      assert.deepEqual([span.eventType, span.unit, span.buckets[0].label], ["Treatment", "months", "3–12mo"]);
    });

    test("a metric the draft filters on is counted without its own clauses, so its other buckets stay selectable", async () => {
      facetAnswers();
      on(/SELECT DISTINCT pid, sid FROM/, [{ pid: "P1", sid: "S1" }, { pid: "P1", sid: "S2" }]);
      on(/max\(ce\.start_date\) \//, [{ b: 0, n: 5 }, { b: 4, n: 3 }]);
      const fu = (range: Record<string, number>) => ({ kind: "derived" as const, metric: "followupMonths" as const, range });
      const draft = { all: [{ any: [fu({ gte: 60 }), fu({ lt: 6 })] }, { kind: "clinical" as const, attribute: "SEX", values: ["Female"] }] };
      const r = await buildExplore({ study: S, draft, skipBins: true, skipGenes: true, derived: [{ metric: "followupMonths" }] });
      assert.equal(r.draftCount, 1, "the draft's patients: owners of its samples");
      assert.equal(r.derived![0].disjunctive, true);
      const q = sent.find((x) => /max\(ce\.start_date\) \//.test(x))!;
      assert.match(q, /'Female'/, "the rest of the draft still applies");
      assert.doesNotMatch(q, /_cohort_st1/, "the draft's own table, which includes the follow-up clause, is not read");
    });
  });

  describe("the draft", () => {
    const female = { all: [{ kind: "clinical" as const, attribute: "SEX", values: ["Female"] }] };

    test("resolved once and shipped as a table, which every facet reads; a drafted attribute is counted without its own clause", async () => {
      facetAnswers();
      on(/SELECT DISTINCT pid, sid FROM/, [{ pid: "P1", sid: "S1" }, { pid: "P2", sid: "S2" }, { pid: "P2", sid: "S3" }]);
      const r = await buildExplore({ study: S, draft: female, skipGenes: true });
      assert.equal(r.draftCount, 2);
      assert.equal(sent.filter((q) => /SELECT DISTINCT pid, sid FROM/.test(q)).length, 1);
      assert.ok(!sent.some((q) => /uniqExact\(pid\) AS n, uniqExact\(sid\) AS ns/.test(q)), "its size came from the rows");
      assert.ok(sent.filter((q) => /AS pts, uniqExact/.test(q)).every((q) => q.includes("_cohort_st1")));
      assert.deepEqual(r.studyBreakdown![0].n, 2);
      const sex = r.clinical.find((c) => c.attribute === "SEX")!;
      assert.equal((sex as { disjunctive?: boolean }).disjunctive, true);
      // the disjunctive value count has no draft left: every SEX value of the study
      const disj = sent.filter((q) => /AS vkey/.test(q) && /IN \('SEX'\)/.test(q) && !/_cohort_st1/.test(q));
      assert.equal(disj.length, 1);
    });

    test("a drafted numeric attribute's values are not counted without its clause, as no facet draws them", async () => {
      facetAnswers();
      on(/SELECT DISTINCT pid, sid FROM/, [{ pid: "P1", sid: "S1" }, { pid: "P2", sid: "S2" }]);
      const draft = { all: [
        { kind: "clinical" as const, attribute: "SEX", values: ["Female"] },
        { kind: "clinical" as const, attribute: "AGE", range: { gt: 40, lte: 70 } },
        { kind: "clinical" as const, attribute: "TMB", range: { gt: 1 } },
      ] };
      const r = await buildExplore({ study: S, draft, skipGenes: true, skipBins: true });
      const disj = (a: string) => sent.filter((q) => /AS vkey/.test(q) && q.includes("IN ('" + a + "')") && !/_cohort_st1/.test(q));
      assert.equal(disj("SEX").length, 1);
      assert.equal(disj("AGE").length, 0, "declared NUMBER");
      assert.equal(disj("TMB").length, 0, "sniffed numeric, no metadata row");
      assert.equal((r.clinical.find((c) => c.attribute === "SEX") as { disjunctive?: boolean }).disjunctive, true);
      assert.equal(r.clinical.find((c) => c.attribute === "AGE")!.kind, "num");
    });

    test("past the bound, the definition is read inline and its size counted once", async () => {
      facetAnswers();
      on(/SELECT DISTINCT pid, sid FROM/, [1, 2, 3, 4].map((i) => ({ pid: "P" + i, sid: "S" + i })));
      on(/uniqExact\(pid\) AS n, uniqExact\(sid\) AS ns/, [{ n: 40, ns: 44 }]);
      const r = await buildExplore({ study: S, draft: female, skipGenes: true, skipBins: true, geneCharts: ["EGFR"] });
      assert.equal(r.draftCount, 40);
      assert.ok(!sent.some((q) => q.includes("_cohort_st1")));
      assert.equal(r.geneFacets![0].total, 44, "the gene charts' base is the draft in samples");
    });

    test("a drafted attribute whose only values the draft excludes keeps its facet, counted without its clause", async () => {
      facetAnswers();
      answers = answers.filter(([re]) => !/numratio/.test(re.source));
      on(/AS numratio/, []);
      on(/SELECT DISTINCT pid, sid FROM/, [{ pid: "P1", sid: "S1" }]);
      const r = await buildExplore({ study: S, draft: { all: [{ not: { kind: "clinical" as const, attribute: "SEX", values: ["Female"] } }] }, skipGenes: true });
      const sex = r.clinical.find((c) => c.attribute === "SEX")!;
      assert.ok(sex.kind === "cat");
      assert.equal((sex as { disjunctive?: boolean }).disjunctive, true);
      assert.equal(sex.patients, 0);
      assert.deepEqual(sex.values, [{ v: "Female", n: 60 }, { v: "Male", n: 40 }]);
    });
  });

  describe("per-gene charts", () => {
    const geneAnswers = () => {
      on(/AS all_altered/, [{ all_altered: 12, in_panel: 10 }]);
      on(/cna_alteration AS c, uniqExact/, [{ c: 2, n: 6 }, { c: -2, n: 3 }]);
      on(/^SELECT uniqExact\(sample_unique_id\) AS n FROM cbio_a\.genomic_event_derived/, [{ n: 8 }]);
      on(/^SELECT uniqExact\(sample_unique_id\) AS n\nFROM cbio_a\.sample_derived/, (q) => [{ n: /MUTATION_EXTENDED/.test(q) ? 90 : 80 }]);
      on(/^SELECT uniqExact\(sample_unique_id\) AS n FROM cbio_a\.sample_derived\nWHERE/, [{ n: 70 }]);
    };

    test("mutation and copy-number states, with not-profiled kept apart from unaltered and contradictions reported", async () => {
      facetAnswers();
      geneAnswers();
      const r = await buildExplore({ study: S, skipBins: true, skipGenes: true, geneCharts: ["egfr", "EGFR", "bad gene!", "KRAS", "A", "B", "C", "D", "E"] });
      const genes = [...new Set(r.geneFacets!.map((f) => f.gene))];
      assert.deepEqual(genes, ["EGFR", "KRAS", "A", "B", "C", "D"], "upper-cased, de-duplicated, malformed dropped, at most six");
      const mut = r.geneFacets!.find((f) => f.gene === "EGFR" && f.type === "MUTATION")!;
      assert.deepEqual([mut.total, mut.profiled, mut.alteredUnprofiled], [120, 90, 2]);
      assert.deepEqual(mut.states.map((s) => [s.label, s.n]), [["Mutated", 10], ["Not mutated", 80], ["Not profiled", 30]]);
      const cna = r.geneFacets!.find((f) => f.gene === "EGFR" && f.type === "CNA")!;
      assert.equal(cna.overlap, 1, "one sample called both amplified and deleted");
      assert.deepEqual(cna.states.map((s) => [s.label, s.n]), [["Amplified", 6], ["Deleted", 3], ["Diploid", 72], ["Not profiled", 40]]);
    });

    test("drivers only labels the states as driver calls and puts the driver condition on every call", async () => {
      facetAnswers();
      geneAnswers();
      const r = await buildExplore({ study: S, skipBins: true, skipGenes: true, geneCharts: ["EGFR"], drivers: true, oncokbPin: "v7.5" });
      assert.equal(r.drivers, "v7.5");
      assert.deepEqual(r.geneFacets!.flatMap((f) => f.states.map((s) => s.label)),
        ["Driver mutation", "No driver mutation", "Not profiled", "Driver amplification", "Driver deletion", "No driver call", "Not profiled"]);
      for (const q of sent.filter((x) => /AS all_altered|cna_alteration AS c/.test(x))) assert.match(q, /oncokb_version = 'v7\.5'/);
    });

    test("a gene the draft filters on is counted without that clause, against that cohort's own size", async () => {
      facetAnswers();
      geneAnswers();
      on(/SELECT DISTINCT pid, sid FROM/, [{ pid: "P1", sid: "S1" }]);
      const draft = { all: [
        { not: { kind: "oql" as const, q: "EGFR: MUT" } },
        { kind: "profiled" as const, type: "MUTATION" as const, gene: "KRAS" },
        { kind: "clinical" as const, attribute: "SEX", values: ["Female"] },
      ] };
      const r = await buildExplore({ study: S, draft, skipBins: true, skipGenes: true, geneCharts: ["EGFR", "KRAS", "TP53"] });
      const total = (g: string) => r.geneFacets!.find((f) => f.gene === g)!.total;
      assert.equal(total("EGFR"), 70, "its base is recounted under the draft without its own clause");
      assert.equal(total("KRAS"), 70);
      assert.equal(total("TP53"), 1, "a gene the draft does not name keeps the draft's own size");
      assert.equal(sent.filter((q) => /^SELECT uniqExact\(sample_unique_id\) AS n FROM cbio_a\.sample_derived\nWHERE/.test(q)).length, 2);
    });

    test("a gene whose own clause is the whole draft is counted over the whole study", async () => {
      facetAnswers();
      geneAnswers();
      on(/SELECT DISTINCT pid, sid FROM/, [{ pid: "P1", sid: "S1" }]);
      await buildExplore({ study: S, draft: { all: [{ kind: "oql" as const, q: "EGFR: AMP" }] }, skipBins: true, skipGenes: true, geneCharts: ["EGFR"] });
      const base = sent.find((q) => /^SELECT uniqExact\(sample_unique_id\) AS n FROM cbio_a\.sample_derived\nWHERE/.test(q))!;
      assert.match(base, /WHERE cancer_study_identifier = 'st1'\nFORMAT JSON$/);
    });

    test("a merged multi-gene OQL clause is someone else's constraint and stays applied", async () => {
      facetAnswers();
      geneAnswers();
      on(/SELECT DISTINCT pid, sid FROM/, [{ pid: "P1", sid: "S1" }]);
      const r = await buildExplore({ study: S, draft: { all: [{ kind: "oql" as const, q: "EGFR: MUT; KRAS: MUT" }] }, skipBins: true, skipGenes: true, geneCharts: ["EGFR"] });
      assert.equal(r.geneFacets![0].total, 1);
    });
  });

  test("drivers only without the OncoKB store is refused", async () => {
    await assert.rejects(buildExploreFederated({ studies: [S], profilesByStudy: new Map(), drivers: true }), /OncoKB annotation store/);
    assert.equal(sent.length, 0);
  });
});

// ---- several studies ------------------------------------------------------------------------
describe("several studies", () => {
  const twoConnAnswers = () => {
    on(/AS pts, uniqExact\(sample_unique_id\) AS smp/, (q) => /cbio_b\./.test(q) ? [{ s: "st2", pts: 50, smp: 50 }] : [{ s: "st1", pts: 100, smp: 120 }]);
    on(/cam\.attr_id AS a/, (q) => /cbio_b\./.test(q) ? [] : [{ s: "st1", a: "AGE", datatype: "NUMBER", display_name: "Age", description: "", priority: "1" }]);
    on(/AS numratio/, (q) => {
      const s = /cbio_b\./.test(q) ? "st2" : "st1";
      return [{ s, type: "patient", a: "AGE", nv: 40, numratio: 1, np: s === "st1" ? 90 : 50, mn: 10, mx: 90, md: 50, na: 0 },
        { s, type: "patient", a: "SEX", nv: 2, numratio: 0, np: 10 }];
    });
    on(/AS vkey/, (q) => [{ s: /cbio_b\./.test(q) ? "st2" : "st1", type: "patient", a: "SEX", v: "Female", n: 7 }]);
    on(/attribute_value AS v, uniqExact/, (q) => /cbio_b\./.test(q) ? [{ type: "patient", a: "AGE", v: "40", n: 50 }] : [{ type: "patient", a: "AGE", v: "60", n: 90 }]);
    on(/AS altered/, (q) => /variant_type = 'mutation'/.test(q) ? [{ g: "KRAS", altered: 10, on_panel: 10, events: 12 }] : []);
    on(/gene_panel_id = 'WES'/, (q) => [{ n: /cbio_b\./.test(q) ? 50 : 100 }]);
  };
  const profiles = new Map([["st1", { profiles: ["mutations"], gaProfiles: [] }], ["st2", { profiles: ["mutations"], gaProfiles: [] }]]);
  const connByStudy = new Map([["st2", SECOND]]);

  test("each connection is asked once for all its studies, and the parts merge by name", async () => {
    twoConnAnswers();
    const r = await buildExploreFederated({ studies: ["st1", "st2"], profilesByStudy: profiles, connByStudy });
    assert.deepEqual(r.studies, ["st1", "st2"]);
    assert.deepEqual(r.totals, { patients: 150, samples: 170 });
    assert.equal(sent.filter((q) => /AS numratio/.test(q)).length, 2, "one classification per connection");
    assert.deepEqual(r.studyBreakdown!.map((b) => [b.study, b.instance]), [["st1", "a"], ["st2", "b"]]);
    const age = r.clinical.find((c) => c.attribute === "AGE")!;
    assert.ok(age.kind === "num");
    assert.equal(age.bins!.reduce((n, b) => n + b.count, 0), 140, "binned once over every study's values, pooled");
    assert.equal(age.naCount, 10, "150 patients, 140 with a value");
    const sex = r.clinical.find((c) => c.attribute === "SEX")!;
    assert.ok(sex.kind === "cat");
    assert.deepEqual(sex.values, [{ v: "Female", n: 14 }]);
    const kras = r.mutatedGenes!.find((g) => g.gene === "KRAS")!;
    assert.equal(kras.altered, 20, "the pooled gene table of each connection, summed");
    assert.equal(kras.profiled, 150);
  });

  test("a draft is pooled into one uploaded table per connection; a study past the bound joins it by its definition", async () => {
    twoConnAnswers();
    on(/SELECT DISTINCT pid, sid FROM/, (q) => /'st3'/.test(q)
      ? [1, 2, 3, 4].map((i) => ({ pid: "Q" + i, sid: "T" + i }))
      : [{ pid: "P1", sid: "S1" }]);
    on(/uniqExact\(pid\) AS n, uniqExact\(sid\) AS ns/, [{ n: 4, ns: 4 }]);
    const draft = { all: [{ kind: "clinical" as const, attribute: "SEX", values: ["Female"] }] };
    const r = await buildExploreFederated({ studies: ["st1", "st2", "st3"], draft, connByStudy,
      profilesByStudy: new Map([...profiles, ["st3", { profiles: [], gaProfiles: [] }]]) });
    assert.equal(r.draftCount, 1 + 1 + 4);
    const pooled = sent.filter((q) => /AS altered/.test(q));
    assert.ok(pooled.some((q) => q.includes("_cohorts_a_cbio_a") && /UNION ALL/.test(q)), "st3's definition beside st1's uploaded rows");
    assert.ok(pooled.some((q) => q.includes("_cohorts_b_cbio_b")));
    const sex = r.clinical.find((c) => c.attribute === "SEX")!;
    assert.equal((sex as { disjunctive?: boolean }).disjunctive, true, "the drafted attribute is counted without its clause, pooled");
  });

  test("drivers only is carried into the merged answer", async () => {
    twoConnAnswers();
    const r = await buildExploreFederated({ studies: ["st1", "st2"], profilesByStudy: profiles, connByStudy, drivers: true, oncokbPin: "v7.5" });
    assert.equal(r.drivers, "v7.5");
  });
});

// ---- generic-assay charts -------------------------------------------------------------------
describe("generic-assay charts", () => {
  const PT = "mutational_signature";
  const holders = new Map([["st1", { gaProfiles: [PT] }], ["st2", { gaProfiles: [PT] }], ["st3", { gaProfiles: [] }]]);
  const stats = (o: Row = {}) => ({ total_p: 10, total_s: 12, dt: "LIMIT-VALUE", pl: 0, nnum_p: 8, nnum_s: 10,
    mn: 0, mx: 100, q1: 25, q2: 50, q3: 75, nv: 10, allints: 1, ...o });

  test("a profile no selected study holds is refused by name", async () => {
    const [f] = await buildAssayFacets({ studies: ["st3"], profilesByStudy: holders, charts: [{ profileType: PT, entity: "SBS1" }] });
    assert.match(f.error!, /no selected study has the generic-assay profile 'mutational_signature'/);
    assert.equal(sent.length, 0);
  });

  test("a numeric entity: pooled range, size-weighted median, and the portal's (start, end] bars with outlier bars", async () => {
    on(/WITH ents AS/, [{ entity: "SBS1", name: "Clock-like" }]);
    on(/AS total_p/, (q) => [stats(/'st2_/.test(q) ? { mn: 10, mx: 60, q2: 30, nv: 30 } : {})]);
    on(/AS b,\n/, [{ b: -1, n: 1 }, { b: 0, n: 3 }, { b: -2, n: 2 }]);
    const [f] = await buildAssayFacets({ studies: ["st1", "st2", "st3"], profilesByStudy: holders, connByStudy: new Map([["st2", SECOND]]),
      charts: [{ profileType: PT, entity: "SBS1" }] });
    assert.deepEqual(f.studies, ["st1", "st2"]);
    assert.equal(f.kind, "num");
    assert.equal(f.unit, "sample");
    assert.equal(f.name, "Clock-like");
    assert.deepEqual([f.total, f.measured, f.min, f.max, f.median], [24, 20, 0, 100, 35]);
    assert.ok(f.kind === "num");
    const bins = f.bins!;
    assert.deepEqual(bins[0], { special: "<=", end: 5, count: 2 });
    assert.deepEqual(bins[1], { start: 5, end: 10, count: 6 });
    assert.deepEqual(bins.at(-1), { special: ">", start: 100, count: 4 });
  });

  test("a patient-level profile is counted in patients", async () => {
    on(/AS total_p/, [stats({ pl: 1 })]);
    const [f] = await buildAssayFacets({ studies: ["st1"], profilesByStudy: holders, charts: [{ profileType: PT, entity: "SBS1" }] });
    assert.deepEqual([f.unit, f.total, f.measured], ["patient", 10, 8]);
    assert.equal(f.name, undefined, "no name beyond the id");
    assert.match(sent.find((q) => /AS b,\n/.test(q))!, /uniqExact\(patient_unique_id\) AS n/);
  });

  test("a zero-inflated entity is binned over its whole range", async () => {
    on(/AS total_p/, [stats({ mn: 0, mx: 10, q1: 0, q2: 0, q3: 0 })]);
    const [f] = await buildAssayFacets({ studies: ["st1"], profilesByStudy: holders, charts: [{ profileType: PT, entity: "SBS1" }] });
    assert.ok(f.kind === "num" && f.bins!.length >= 2);
  });

  test("an entity with no numbers has no bars, and a single value has no histogram", async () => {
    on(/AS total_p/, [stats({ nv: 0 })]);
    const [none] = await buildAssayFacets({ studies: ["st1"], profilesByStudy: holders, charts: [{ profileType: PT, entity: "SBS1" }] });
    assert.ok(none.kind === "num");
    assert.deepEqual([none.measured, none.bins, none.min], [10, undefined, undefined]);
    answers = [];
    on(/AS total_p/, [stats({ mn: 3, mx: 3, q1: 3, q3: 3 })]);
    const [one] = await buildAssayFacets({ studies: ["st1"], profilesByStudy: holders, charts: [{ profileType: PT, entity: "SBS1" }] });
    assert.ok(one.kind === "num");
    assert.deepEqual([one.min, one.max, one.bins], [3, 3, undefined]);
  });

  test("a categorical entity: its values summed across connections, missing values never a category", async () => {
    on(/AS total_p/, [stats({ dt: "CATEGORICAL" })]);
    on(/trimBoth\(value\) AS v, uniqExact/, (q) => /cbio_b\./.test(q) ? [{ v: "High", n: 2 }, { v: "Low", n: 5 }] : [{ v: "High", n: 4 }]);
    on(/^SELECT uniqExact\(sample_unique_id\) AS n FROM cbio_\w\.generic_assay_data_derived/, [{ n: 6 }]);
    const [f] = await buildAssayFacets({ studies: ["st1", "st2"], profilesByStudy: holders, connByStudy: new Map([["st2", SECOND]]),
      charts: [{ profileType: PT, entity: "MSI" }] });
    assert.ok(f.kind === "cat");
    assert.deepEqual(f.values, [{ v: "High", n: 6 }, { v: "Low", n: 5 }]);
    assert.equal(f.measured, 12);
    for (const q of sent.filter((x) => /trimBoth\(value\) AS v/.test(x))) assert.match(q, /NOT IN \('','NA','N\/A'/);
  });

  test("a chart the draft filters on is counted without its own clause; at most six charts", async () => {
    on(/AS total_p/, [stats()]);
    const draft = { all: [{ not: { kind: "genericAssay" as const, profileType: PT, entity: "SBS1", range: { gte: 1 } } }] };
    const charts = Array.from({ length: ASSAY_CHART_LIMIT + 2 }, (_, i) => ({ profileType: PT, entity: i ? "SBS" + (i + 1) : "SBS1" }));
    const out = await buildAssayFacets({ studies: ["st1"], draft, profilesByStudy: holders, charts });
    assert.equal(out.length, ASSAY_CHART_LIMIT);
    assert.equal(out[0].disjunctive, true);
    assert.equal(out[1].disjunctive, undefined);
    const own = sent.filter((q) => /AS total_p/.test(q) && /entity_stable_id = 'SBS1' AND v IS NOT NULL/.test(q));
    assert.ok(own.every((q) => !/sample_unique_id IN/.test(q)), "its own chart reads no cohort condition");
    const other = sent.filter((q) => /AS total_p/.test(q) && /entity_stable_id = 'SBS2' AND v IS NOT NULL/.test(q));
    assert.ok(other.every((q) => /sample_unique_id IN/.test(q)), "another entity's chart is drawn under the draft");
  });
});
