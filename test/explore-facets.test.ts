// Explore's facets (lib/explore.ts) beyond the gene tables (whose merge, GR2 and GP5, is here too): the portal's numeric bin edges, how
// participants' facets merge (counts summed before dividing, overlap not deduplicated), a single
// study's clinical / derived / per-gene facets with their disjunctive counting, the draft resolved
// once and shipped as a table (or inlined past the bound), the multi-study pass pooled per
// connection, and the generic-assay charts. The warehouse is a stand-in (setChTransport) that
// answers each statement by what it reads.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "cbio_a";
process.env.CLICKHOUSE_USER = "u";
process.env.CLICKHOUSE_PASSWORD = "p";
// a draft of more than three (patient, sample) rows is not shipped as a table
process.env.EXPLORE_COHORT_EXTERNAL_LIMIT = "3";
for (const k of ["CLICKHOUSE2_URL", "ONCOKB_PIN", "FEDERATION_PEERS", "CH_RUN_CACHE"]) delete process.env[k];

const { setChTransport, PRIMARY } = await import("../lib/ch.ts");
const { dataBins } = await import("../lib/data-binner.ts");
const CG29 = JSON.parse(readFileSync(new URL("./fixtures/assay-bins-brca-cg00000029.json", import.meta.url), "utf8")) as { values: string[]; portalBins: unknown[] };
const { discreteCnaProfileSql } = await import("../lib/cohort2.ts");
const { ASSAY_FREQ_TABLE_LIMIT } = await import("../lib/assay-frequency-table.ts");
const { finiteSql } = await import("../lib/sql-number.ts");
const { mergeExplore, buildExplore, buildExploreFederated, conflictingLevels, buildAssayFacets, ASSAY_CHART_LIMIT, buildAssayFreqTables, FACET_VALUE_LIMIT, buildTreatmentFacets, buildMutationTypeFacets, buildViolinFacets, VIOLIN_VALUE_LIMIT } = await import("../lib/explore.ts");
type ExploreResult = import("../lib/types.ts").ExploreResult;
type ChConn = import("../lib/ch.ts").ChConn;
type Row = Record<string, unknown>;

let sent: string[] = [];
/** the external tables each statement carried, as name and text */
let shipped: { query: string; name: string; text: Promise<string> }[] = [];
let answers: [RegExp, Row[] | ((q: string) => Row[])][] = [];
setChTransport(async ({ query, externals }) => {
  sent.push(query);
  for (const e of externals) shipped.push({ query, name: e.name, text: e.blob.text() });
  for (const [re, rows] of answers) if (re.test(query)) {
    const data = typeof rows === "function" ? rows(query) : rows;
    return JSON.stringify({ meta: [], data, rows: data.length });
  }
  return JSON.stringify({ meta: [], data: [], rows: 0 });
});
after(() => setChTransport(null));
beforeEach(() => { sent = []; answers = []; shipped = []; });
const on = (re: RegExp, rows: Row[] | ((q: string) => Row[])) => { answers.push([re, rows]); };
const fail = (re: RegExp) => on(re, () => { throw new Error("no such table"); });

const SECOND: ChConn = { id: "b", url: "http://second.invalid", user: "u", password: "p", db: "cbio_b", label: "second" } as ChConn;

describe("merging participants' facets", () => {
  const part = (o: Partial<ExploreResult>): ExploreResult => ({
    study: "s", draftCount: null, clinical: [], events: [], caseLists: [], profiles: [], gaProfiles: [], stats: { ms: 0 }, ...o,
  } as ExploreResult);

  test("one participant is returned as it is", () => {
    const p = part({ study: "only" });
    assert.equal(mergeExplore([p]), p);
  });

  test("STS-STM-1: values spelled differently across studies are one row, under the greatest spelling, as the portal's", () => {
    const sex = (study: string, values: { v: string; n: number }[]) => part({ study, totals: { patients: 1000, samples: 1000 },
      clinical: [{ attribute: "SEX", per: "patient", kind: "cat", patients: values.reduce((n, x) => n + x.n, 0), values }] });
    // coadread writes "Female", brca_mbcproject_2022 "FEMALE": cbioportal.org lists Female 536
    const m = mergeExplore([sex("coadread", [{ v: "Female", n: 264 }, { v: "Male", n: 312 }]), sex("mbc", [{ v: "FEMALE", n: 272 }, { v: " male ", n: 1 }])]);
    const c = m.clinical.find((x) => x.attribute === "SEX")!;
    assert.ok(c.kind === "cat");
    assert.deepEqual(c.values, [{ v: "Female", n: 536 }, { v: "Male", n: 313 }]);
  });

  // the user's answer (2026-11-19): a chart carries every value in practice, so Summary Data is whole;
  // the warehouse's largest categorical list is 5,033 values (pancan_mimsi_msk_2024 SAMPLE_DISPLAY_NAME)
  test("SD13: the bound on a chart's values is about 20,000, above every list the warehouse holds", () => {
    assert.ok(FACET_VALUE_LIMIT >= 20_000 && FACET_VALUE_LIMIT <= 50_000, String(FACET_VALUE_LIMIT));
  });

  describe("SD15: values cut across studies", () => {
    const cat = (study: string, vals: string[], distinct: number, base = 1000): ExploreResult => part({
      study, totals: { patients: 10000, samples: 10000 },
      clinical: [{ attribute: "SUBTYPE", per: "patient", kind: "cat", patients: vals.length * 10, distinct,
        values: vals.map((v, i) => ({ v, n: base - i })) }],
    });
    const range = (pfx: string, from: number, n: number) => Array.from({ length: n }, (_, i) => pfx + String(from + i).padStart(4, "0"));
    const merged = (...ps: ExploreResult[]) => {
      const f = mergeExplore(ps).clinical.find((c) => c.attribute === "SUBTYPE")!;
      assert.ok(f.kind === "cat");
      return f;
    };

    // the bound is FACET_VALUE_LIMIT: a union past it keeps that many, the most frequent
    const L = FACET_VALUE_LIMIT, half = Math.ceil(L * 0.75);
    test("SD15 a union past the bound keeps that many, the most frequent, and distinct counts the whole union", () => {
      const f = merged(cat("s1", range("v", 0, half), half), cat("s2", range("v", half, half), half, 999));
      assert.equal(f.values.length, L);
      assert.ok(f.distinct! >= 2 * half, `distinct ${f.distinct} must be at least the union's ${2 * half}`);
      assert.ok(f.distinct! > f.values.length, "the cut shows");
    });

    test("SD15 a mostly-different union past the bound still reports at least its size", () => {
      const shared = Math.floor(L * 0.1), a = range("v", 0, half), b = [...range("v", 0, shared), ...range("w", 0, half - shared)];
      const f = merged(cat("s1", a, half), cat("s2", b, half, 999));
      assert.equal(f.values.length, L);
      assert.ok(f.distinct! >= 2 * half - shared);
    });

    test("SD15 a union within the bound is not cut, and distinct is not below the values shown", () => {
      // 2 × 50 overlapping by 25: a union of 75
      const f = merged(cat("s1", range("v", 0, 50), 50), cat("s2", range("v", 25, 50), 50));
      assert.equal(f.values.length, 75);
      assert.ok(f.distinct! >= f.values.length, `distinct ${f.distinct} below ${f.values.length} values`);
    });

    test("SD15 a study's own larger distinct is kept", () => {
      const f = merged(cat("s1", range("v", 0, half), 5 * L), cat("s2", range("v", half, half), half, 999));
      assert.equal(f.values.length, L);
      assert.ok(f.distinct! >= 5 * L);
    });
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

  // docs/legacy-spec/parity/empty-caselists-cases.md, Case Lists rows CL5, CL6, CL8
  describe("CL5/CL6/CL8: case lists merged across studies", () => {
    test("CL6: lists of one kind are one row, counts added, named after the first study's list", () => {
      const m = mergeExplore([
        part({ study: "s1", caseLists: [{ id: "all", name: "All samples", n: 30 }, { id: "cna", name: "CNA", n: 5 }] }),
        part({ study: "s2", caseLists: [{ id: "all", name: "All tumors", n: 20 }, { id: "rppa", name: "RPPA", n: 7 }] }),
      ]);
      assert.deepEqual(m.caseLists, [
        { id: "all", name: "All samples", n: 50 },
        { id: "rppa", name: "RPPA", n: 7 },
        { id: "cna", name: "CNA", n: 5 },
      ]);
    });

    test("CL5: no cap on the number of rows (twelve lists in one study, all kept)", () => {
      const twelve = Array.from({ length: 12 }, (_, i) => ({ id: "l" + String(i).padStart(2, "0"), name: "List " + i, n: 100 - i }));
      const m = mergeExplore([
        part({ study: "s1", caseLists: twelve }),
        part({ study: "s2", caseLists: [{ id: "all", name: "All samples", n: 1 }] }),
      ]);
      assert.equal(m.caseLists.length, 13, "every list of every study is a row");
      assert.deepEqual(m.caseLists.slice(0, 12).map((l) => l.id), twelve.map((l) => l.id));
      assert.deepEqual(m.caseLists[12], { id: "all", name: "All samples", n: 1 });
    });

    test("CL8: by count descending, ties by id A to Z", () => {
      const m = mergeExplore([
        part({ study: "s1", caseLists: [
          { id: "sv", name: "SV", n: 4 }, { id: "cna", name: "CNA", n: 4 }, { id: "zeta", name: "Zeta", n: 9 },
        ] }),
        part({ study: "s2", caseLists: [
          { id: "sequenced", name: "Sequenced", n: 4 }, { id: "all", name: "All", n: 4 }, { id: "beta", name: "Beta", n: 1 },
        ] }),
      ]);
      assert.deepEqual(m.caseLists.map((l) => [l.id, l.n]),
        [["zeta", 9], ["all", 4], ["cna", 4], ["sequenced", 4], ["sv", 4], ["beta", 1]]);
    });

    test("CL8: a tie formed by summing is ordered by id too", () => {
      const m = mergeExplore([
        part({ study: "s1", caseLists: [{ id: "mrna", name: "mRNA", n: 6 }, { id: "cnaseq", name: "CNA seq", n: 3 }] }),
        part({ study: "s2", caseLists: [{ id: "cnaseq", name: "CNA seq", n: 3 }] }),
      ]);
      assert.deepEqual(m.caseLists.map((l) => [l.id, l.n]), [["cnaseq", 6], ["mrna", 6]]);
    });
  });

  // ---- docs/legacy-spec/parity/gene-tables-cases.md GP4–GP5: a row's gene panels across connections ----
  const prow = (gene: string, panels?: string[], extra: Record<string, unknown> = {}) =>
    ({ gene, altered: 1, alteredOnPanel: 1, events: 1, profiled: 10, freqPct: 10, ...(panels ? { panels } : {}), ...extra });

  for (const key of ["mutatedGenes", "cnaGenes", "svGenes"] as const) {
    const extra = key === "cnaGenes" ? { cna: 2, cytoband: "1p" } : {};
    test(`GP5: ${key} — a gene in both parts holds every part's panels, each once, A to Z`, () => {
      const m = mergeExplore([
        part({ study: "x", [key]: [prow("KRAS", ["B", "WES"], extra)] } as never),
        part({ study: "y", [key]: [prow("KRAS", ["A", "B"], extra)] } as never),
      ]);
      const kras = m[key]!.find((g) => g.gene === "KRAS")!;
      assert.deepEqual((kras as { panels?: string[] }).panels, ["A", "B", "WES"]);
    });

    test(`GP5: ${key} — a part whose row has no panels keeps the other part's`, () => {
      for (const order of [0, 1]) {
        const ps = [part({ study: "x", [key]: [prow("TP53", undefined, extra)] } as never),
          part({ study: "y", [key]: [prow("TP53", ["P1", "P2"], extra)] } as never)];
        const m = mergeExplore(order ? ps.reverse() : ps);
        const tp53 = m[key]!.find((g) => g.gene === "TP53")!;
        assert.deepEqual((tp53 as { panels?: string[] }).panels, ["P1", "P2"], order ? "panel-less part second" : "panel-less part first");
      }
    });
  }

  test("GP5: panels do not leak between genes, or between a CNA gene's AMP and HOMDEL rows", () => {
    const m = mergeExplore([
      part({ study: "x", mutatedGenes: [prow("KRAS", ["K"]), prow("TP53", ["T"])], cnaGenes: [prow("MYC", ["AMP1"], { cna: 2 })] } as never),
      part({ study: "y", mutatedGenes: [prow("KRAS", ["K2"])], cnaGenes: [prow("MYC", ["DEL1"], { cna: -2 })] } as never),
    ]);
    const panelsOf = (rows: unknown[] | undefined, gene: string, cna?: number) =>
      (rows as { gene: string; cna?: number; panels?: string[] }[]).find((g) => g.gene === gene && g.cna === cna)!.panels;
    assert.deepEqual(panelsOf(m.mutatedGenes, "KRAS"), ["K", "K2"]);
    assert.deepEqual(panelsOf(m.mutatedGenes, "TP53"), ["T"]);
    assert.deepEqual(panelsOf(m.cnaGenes, "MYC", 2), ["AMP1"]);
    assert.deepEqual(panelsOf(m.cnaGenes, "MYC", -2), ["DEL1"]);
  });

  test("GP5: merging leaves the parts' own panel lists unchanged", () => {
    const a = prow("KRAS", ["B", "WES"]), b = prow("KRAS", ["A", "B"]);
    mergeExplore([part({ study: "x", mutatedGenes: [a] } as never), part({ study: "y", mutatedGenes: [b] } as never)]);
    assert.deepEqual(a.panels, ["B", "WES"]);
    assert.deepEqual(b.panels, ["A", "B"]);
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
    assert.deepEqual(r.studyBreakdown, [{ study: S, n: 120, instance: "a", instanceLabel: "primary" }], "samples, not patients (100)");
    // SEX's database priority 1 is the default, so the portal's table gives it 9 (above AGE's 5)
    assert.deepEqual(r.clinical.map((c) => [c.attribute, c.kind, c.priority]), [["SEX", "cat", 9], ["AGE", "num", 5], ["CODE", "cat", undefined], ["TMB", "num", undefined]]);
    const age = r.clinical[1];
    assert.ok(age.kind === "num");
    assert.deepEqual([age.displayName, age.description, age.priority, age.min, age.max, age.median], ["Age", "at diagnosis", 5, 20, 80, 55]);
    assert.equal(age.bins!.reduce((n, b) => n + b.count, 0), 90);
    assert.equal(age.naCount, 10, "the cohort's patients without a value: 100 − 90");
    const tmb = r.clinical[3];
    assert.ok(tmb.kind === "num");
    assert.equal(tmb.naCount, 20, "a sample attribute's NA is counted against samples: 120 − 100");
    const sex = r.clinical[0];
    assert.ok(sex.kind === "cat");
    assert.deepEqual(sex.values, [{ v: "Female", n: 60 }, { v: "Male", n: 40 }]);
    assert.equal(sex.disjunctive, undefined);
    assert.deepEqual(r.events, [{ type: "Treatment", n: 50 }]);
    assert.deepEqual(r.caseLists, [{ id: "all", name: "All samples", n: 100 }]);
    assert.deepEqual(r.dataTypes, [{ profile: "mutations", label: "Mutations", alterationType: "MUTATION_EXTENDED", n: 110 }]);
    assert.deepEqual(r.derived, []);
    assert.deepEqual(r.geneFacets, []);
  });

  test("every numeric chart gets its bars, past the 14th too (STS-BAR-1: coadread's 19)", async () => {
    const attrs = Array.from({ length: 19 }, (_, i) => "NUM_" + String(i).padStart(2, "0"));
    on(/AS pts, uniqExact\(sample_unique_id\) AS smp/, [{ s: S, pts: 100, smp: 120 }]);
    on(/cam\.attr_id AS a/, attrs.map((a, i) => ({ s: S, a, datatype: "NUMBER", display_name: a, description: "", priority: String(100 - i) })));
    on(/AS numratio/, attrs.map((a) => ({ s: S, type: "patient", a, nv: 2, numratio: 1, np: 90, mn: 1, mx: 9, md: 5, na: 10 })));
    on(/attribute_value AS v, uniqExact/, attrs.flatMap((a) => [{ type: "patient", a, v: "1", n: 40 }, { type: "patient", a, v: "9", n: 50 }]));
    const r = await buildExplore({ study: S, conn: PRIMARY, skipGenes: true });
    const num = r.clinical.filter((c) => c.kind === "num");
    assert.equal(num.length, 19);
    const unbinned = num.filter((c) => !c.bins?.length).map((c) => c.attribute);
    assert.deepEqual(unbinned, [], "every numeric chart is binned");
    for (const c of num) assert.equal(c.bins!.reduce((n, b) => n + b.count, 0), 90, c.attribute + ": its 90 patients with a value");
    const reads = sent.filter((q) => /attribute_value AS v, uniqExact/.test(q));
    assert.equal(reads.length, 1, "one statement counts every chart's values");
    for (const a of attrs) assert.ok(reads[0].includes("('patient', '" + a + "')"), a + " in the statement");
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
      on(/^SELECT cancer_study_identifier AS s, uniqExact\(patient_unique_id\) AS pts[\s\S]*_cohort_st1/, [{ s: S, pts: 2, smp: 3 }]);
      facetAnswers();
      on(/SELECT DISTINCT pid, sid FROM/, [{ pid: "P1", sid: "S1" }, { pid: "P2", sid: "S2" }, { pid: "P2", sid: "S3" }]);
      const r = await buildExplore({ study: S, draft: female, skipGenes: true });
      assert.equal(r.draftCount, 2);
      assert.equal(sent.filter((q) => /SELECT DISTINCT pid, sid FROM/.test(q)).length, 1);
      assert.ok(!sent.some((q) => /uniqExact\(pid\) AS n, uniqExact\(sid\) AS ns/.test(q)), "its size came from the rows");
      assert.ok(sent.filter((q) => /^SELECT cancer_study_identifier AS s, uniqExact\(patient_unique_id\) AS pts/.test(q)).every((q) => q.includes("_cohort_st1")));
      assert.equal(r.studyBreakdown![0].n, 3, "the study's samples in the draft (2 patients, 3 samples), as the portal's Cancer Studies chart counts");
      const sex = r.clinical.find((c) => c.attribute === "SEX")!;
      assert.equal((sex as { disjunctive?: boolean }).disjunctive, true);
      // the disjunctive value count has no draft left: every SEX value of the study
      const disj = sent.filter((q) => /AS vkey/.test(q) && /IN \('SEX'\)/.test(q) && !/_cohort_st1/.test(q));
      assert.equal(disj.length, 1);
    });

    test("a drafted numeric attribute's values are not counted without its clause, as no facet draws them", async (t) => {
      // three filter groups would be scanned; this is the chart-by-chart path
      process.env.EXPLORE_SCAN = "off";
      t.after(() => { delete process.env.EXPLORE_SCAN; });
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

    test("a drafted numeric attribute is binned without its own clauses, its NA against that cohort, so its other bars stay", async () => {
      on(/^SELECT uniqExact\(patient_unique_id\) AS pts/, [{ pts: 95, smp: 110 }]);
      facetAnswers();
      on(/SELECT DISTINCT pid, sid FROM/, [{ pid: "P1", sid: "S1" }, { pid: "P2", sid: "S2" }]);
      answers = answers.filter(([re]) => !/attribute_value AS v/.test(re.source));
      on(/attribute_value AS v, uniqExact/, (q) => q.includes("_cohort_st1")
        ? [{ type: "sample", a: "TMB", v: "5", n: 2 }]
        : [{ type: "patient", a: "AGE", v: "30", n: 40 }, { type: "patient", a: "AGE", v: "60", n: 50 }]);
      const age = (lo: number, hi: number) => ({ kind: "clinical" as const, attribute: "AGE", range: { gt: lo, lte: hi } });
      const draft = { all: [{ kind: "clinical" as const, attribute: "SEX", values: ["Female"] }, { any: [age(50, 60), age(70, 75)] }] };
      const r = await buildExplore({ study: S, draft, skipGenes: true });
      const a = r.clinical.find((c) => c.attribute === "AGE")!;
      assert.ok(a.kind === "num");
      assert.equal(a.disjunctive, true);
      assert.equal(a.bins!.reduce((n, b) => n + b.count, 0), 90, "every AGE value of the rest of the draft, not only the chosen ranges");
      assert.equal(a.naCount, 5, "95 patients in the rest of the draft, 90 with an age");
      assert.deepEqual([a.min, a.median, a.max], [30, 60, 60], "its range and median read from the same values (position 45 of 90)");
      const own = sent.find((q) => /attribute_value AS v, uniqExact/.test(q) && /'AGE'/.test(q) && /'Female'/.test(q));
      assert.ok(own, "AGE's values are counted under the rest of the draft");
      assert.doesNotMatch(own!, /_cohort_st1/, "the draft's own table holds the AGE ranges, so it is not read");
      const layout = sent.filter((q) => /attribute_value AS v, uniqExact/.test(q) && /'AGE'/.test(q) && !/_cohort_st1|'Female'/.test(q));
      assert.equal(layout.length, 1, "the bars are laid out over the unfiltered study, once");
      const tmb = r.clinical.find((c) => c.attribute === "TMB")!;
      assert.ok(tmb.kind === "num" && tmb.disjunctive === undefined, "an attribute the draft does not filter on is drawn under it");
    });

    test("a filtered attribute no study declares is reported, at any depth; a declared one is not", async () => {
      facetAnswers();
      on(/SELECT DISTINCT pid, sid FROM/, []);
      const draft = { all: [{ kind: "clinical" as const, attribute: "SEX", values: ["Female"] },
        { not: { kind: "clinical" as const, attribute: "FOO", values: ["x"] } }, { any: [{ kind: "clinical" as const, attribute: "BAR", range: { gt: 1 } }] }] };
      const r = await buildExplore({ study: S, draft, skipGenes: true, skipBins: true });
      assert.deepEqual(r.unknownAttributes, ["FOO", "BAR"]);
      const ok = await buildExplore({ study: S, draft: female, skipGenes: true, skipBins: true });
      assert.equal(ok.unknownAttributes, undefined);
    });

    test("NA: a categorical chart's cases without a value, against the cohort its values are counted in", async () => {
      on(/^SELECT uniqExact\(patient_unique_id\) AS pts/, [{ pts: 100, smp: 120 }]);
      on(/^SELECT type, uniqExact\(if\(type = 'sample', sample_unique_id, patient_unique_id\)\) AS n\nFROM/, (q) => /'SEX'/.test(q) ? [{ type: "patient", n: 97 }] : []);
      facetAnswers();
      answers = answers.filter(([re]) => !/numratio/.test(re.source));
      on(/AS numratio/, [
        { s: S, type: "patient", a: "SEX", nv: 2, numratio: 0, np: 40 },
        { s: S, type: "patient", a: "RACE", nv: 3, numratio: 0, np: 1 },
      ]);
      on(/SELECT DISTINCT pid, sid FROM/, [{ pid: "P1", sid: "S1" }, { pid: "P2", sid: "S2" }]);
      const r = await buildExplore({ study: S, draft: female, skipGenes: true, skipBins: true });
      const sexF = r.clinical.find((c) => c.attribute === "SEX")!, race = r.clinical.find((c) => c.attribute === "RACE")!;
      assert.ok(sexF.kind === "cat" && race.kind === "cat");
      assert.equal(sexF.na, 3, "counted without its own filter: 100 patients, 97 with a value");
      assert.equal(race.na, 99, "under the draft: the draft's patients as its totals query counts them (100 here), 1 with a value");
    });

    test("bins are laid out over the unfiltered study and counted over the selection (STATIC)", async () => {
      facetAnswers();
      on(/SELECT DISTINCT pid, sid FROM/, [{ pid: "P1", sid: "S1" }, { pid: "P2", sid: "S2" }]);
      answers = answers.filter(([re]) => !/attribute_value AS v/.test(re.source));
      const all = Array.from({ length: 40 }, (_, i) => ({ type: "patient", a: "AGE", v: String(20 + i * 1.5), n: 2 }));
      on(/attribute_value AS v, uniqExact/, (q) => q.includes("_cohort_st1") ? [{ type: "patient", a: "AGE", v: "50", n: 1 }] : all);
      const r = await buildExplore({ study: S, draft: female, skipGenes: true });
      const age = r.clinical.find((c) => c.attribute === "AGE")!;
      assert.ok(age.kind === "num");
      const { dataBins } = await import("../lib/data-binner.ts");
      const layout = dataBins(all.map((x) => ({ value: x.v, count: x.n })), "AGE");
      assert.deepEqual(age.bins!.map((b) => [b.special, b.start, b.end]), layout.map((b) => [b.special, b.start, b.end]), "the unfiltered study's bars");
      assert.equal(age.bins!.reduce((n, b) => n + b.count, 0), 1, "counted over the selection");
      assert.equal(age.bins!.filter((b) => b.count === 0).length, layout.length - 1, "empty bars are kept");
    });

    test("a chart's menu settings lay out its bars, filtered or not; the MSI scores start on the portal's edges", async () => {
      facetAnswers();
      on(/SELECT DISTINCT pid, sid FROM/, [{ pid: "P1", sid: "S1" }, { pid: "P2", sid: "S2" }]);
      answers = answers.filter(([re]) => !/attribute_value AS v/.test(re.source));
      const all = Array.from({ length: 40 }, (_, i) => ({ type: "patient", a: "AGE", v: String(20 + i * 1.5), n: 2 }));
      on(/attribute_value AS v, uniqExact/, (q) => q.includes("_cohort_st1") ? [{ type: "patient", a: "AGE", v: "50", n: 1 }] : all);
      const edges = (r: Awaited<ReturnType<typeof buildExplore>>) => {
        const a = r.clinical.find((c) => c.attribute === "AGE")!;
        assert.ok(a.kind === "num");
        return a.bins!.map((b) => [b.special, b.start, b.end]);
      };
      const custom = { AGE: { bins: { method: "custom" as const, edges: [40, 60] } } };
      assert.deepEqual(edges(await buildExplore({ study: S, skipGenes: true, bins: custom })), [["<=", undefined, 40], [undefined, 40, 60], [">", 60, undefined]]);
      assert.deepEqual(edges(await buildExplore({ study: S, draft: female, skipGenes: true, bins: custom })), [["<=", undefined, 40], [undefined, 40, 60], [">", 60, undefined]], "kept under a filter");
      assert.deepEqual(edges(await buildExplore({ study: S, skipGenes: true, bins: { AGE: { bins: { method: "median" } } } })).map((b) => b[0]), ["<=", ">"]);
      const { dataBins } = await import("../lib/data-binner.ts");
      const vals = Array.from({ length: 30 }, (_, i) => ({ value: (0.2 + i * 0.02).toFixed(2), count: 1 }));
      const { INITIAL_BIN_EDGES } = await import("../lib/study-view-config.ts");
      assert.deepEqual(INITIAL_BIN_EDGES.MSI_SCORE_MANTIS, [0.4, 0.6]);
      assert.notDeepEqual(dataBins(vals, "MSI_SCORE_MANTIS", { bins: { method: "custom", edges: [0.4, 0.6] } }), dataBins(vals, "MSI_SCORE_MANTIS"));
    });

    describe("the single scan (three filter groups or more)", () => {
      const age = { kind: "clinical" as const, attribute: "AGE", range: { gt: 40, lte: 70 } };
      const tmb = { kind: "clinical" as const, attribute: "TMB", range: { gt: 1 } };
      const three = { all: [female.all[0], age, tmb] };

      test("one mask statement replaces resolving the draft and every per-chart count; patients carry the OR of their samples' masks", async () => {
        // bits: 0 = all but SEX, 1 = all but AGE, 2 = all but TMB, 3 = the draft
        on(/^SELECT st, s, p, pm FROM/, [{ st: S, s: S + "_S1", p: S + "_P1", pm: "15" }, { st: S, s: S + "_S2", p: S + "_P1", pm: "1" },
          { st: S, s: S + "_S3", p: S + "_P2", pm: "8" }]);
        on(/maxIf\(c\.val/, [{ s: S, type: "patient", a: "SEX", v: "Female", vkey: "female", n: 2 }, { s: S, type: "patient", a: "SEX", v: "Male", vkey: "male", n: 1 },
          { s: S, type: "sample", a: "CODE", v: "1", vkey: "1", n: 2 }]);
        on(/AS n_all/, [{ type: "patient", a: "AGE", v: "30", n: 1, n_all: 40 }, { type: "patient", a: "AGE", v: "60", n: 2, n_all: 50 }, { type: "sample", a: "TMB", v: "5", n: 2, n_all: 100 }]);
        on(/ARRAY JOIN range\(3\)/, [{ lvl: "patient", k: 0, n: 3 }, { lvl: "sample", k: 0, n: 3 }, { lvl: "patient", k: 1, n: 3 }, { lvl: "sample", k: 1, n: 3 }]);
        on(/GROUP BY type, a\s*(FORMAT|$)/, [{ type: "patient", a: "SEX", n: 3 }, { type: "patient", a: "AGE", n: 3 }]);
        facetAnswers();
        const r = await buildExplore({ study: S, draft: three, skipGenes: true });
        assert.equal(r.draftCount, 2, "the samples with bit 3 (S1, S3) and their two owners");
        assert.ok(!sent.some((q) => /SELECT DISTINCT pid, sid FROM/.test(q)), "the draft is not resolved again");
        assert.ok(!sent.some((q) => /AS vkey/.test(q) && !/_scan_/.test(q)), "no value list counted chart by chart");
        assert.ok(!sent.some((q) => /attribute_value AS v, uniqExact/.test(q)), "no histogram counted chart by chart");
        assert.equal(sent.filter((q) => /^SELECT st, s, p, pm FROM/.test(q)).length, 1);
        const mask = sent.find((q) => /^SELECT st, s, p, pm FROM/.test(q))!;
        assert.match(mask, /'Female'/);
        assert.match(mask, /\* 8 AS pm/, "bit 3, every filter, is the last term");
        const table = await shipped.find((x) => x.name.startsWith("_scan_"))!.text;
        assert.match(table, /^patient\tst1_P1\t15$/m, "P1 owns S1 (15) and S2 (1)");
        assert.match(table, /^sample\tst1_S2\t1$/m);
        const sex = r.clinical.find((c) => c.attribute === "SEX")!;
        assert.ok(sex.kind === "cat" && sex.disjunctive);
        assert.deepEqual(sex.values, [{ v: "Female", n: 2 }, { v: "Male", n: 1 }]);
        assert.equal(sex.na, 0, "3 patients without SEX's own filter, 3 with a value");
        const a = r.clinical.find((c) => c.attribute === "AGE")!;
        assert.ok(a.kind === "num" && a.disjunctive);
        assert.equal(a.bins!.reduce((n, b) => n + b.count, 0), 3, "counted at its own bit");
        assert.deepEqual([a.min, a.median, a.max], [30, 60, 60]);
      });

      test("past the external-table bound the page counts chart by chart", async () => {
        on(/^SELECT st, s, p, pm FROM/, [1, 2, 3, 4].map((i) => ({ st: S, s: S + "_S" + i, p: S + "_P" + i, pm: "8" })));
        on(/SELECT DISTINCT pid, sid FROM/, [{ pid: "P1", sid: "S1" }]);
        facetAnswers();
        const r = await buildExplore({ study: S, draft: three, skipGenes: true, skipBins: true });
        assert.ok(sent.some((q) => /SELECT DISTINCT pid, sid FROM/.test(q)), "the draft resolved as before");
        assert.ok(!shipped.some((x) => x.name.startsWith("_scan_")));
        assert.equal(r.draftCount, 1);
      });

      test("two groups are counted chart by chart", async () => {
        facetAnswers();
        on(/SELECT DISTINCT pid, sid FROM/, [{ pid: "P1", sid: "S1" }]);
        await buildExplore({ study: S, draft: { all: [female.all[0], age] }, skipGenes: true });
        assert.ok(!sent.some((q) => /^SELECT st, s, p, pm FROM/.test(q)));
      });
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
      on(/^SELECT alteration_value AS v, uniqExact/, [{ v: "2", n: 6 }, { v: "1", n: 28 }, { v: "0", n: 50 }, { v: "-1", n: 17 }, { v: "-2", n: 1 }]);
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
      assert.deepEqual(mut.states.map((s) => [s.label, s.n]), [["Mutated", 10], ["Not Mutated", 80], ["Not Profiled", 30]]);
      const cna = r.geneFacets!.find((f) => f.gene === "EGFR" && f.type === "CNA")!;
      assert.equal(cna.overlap, undefined, "one value per sample: the levels partition the cohort");
      assert.equal(cna.profiled, 102, "samples with a value in the profile");
      assert.deepEqual(cna.states.map((s) => [s.state, s.label, s.n]), [
        ["amp", "Amplified", 6], ["gain", "Gained", 28], ["diploid", "Diploid", 50],
        ["hetloss", "Heterozygously deleted", 17], ["del", "Homozygously deleted", 1], ["notProfiled", "Not profiled", 18]]);
    });

    test("the copy-number levels read the study's discrete profile under the cohort, the values the portal counts", async () => {
      facetAnswers();
      geneAnswers();
      const r = await buildExplore({ study: S, skipBins: true, skipGenes: true, geneCharts: ["KRAS"] });
      const cna = r.geneFacets!.find((f) => f.type === "CNA")!;
      assert.equal(cna.states.find((s) => s.state === "notProfiled")!.n, 18, "the cohort (120) less the samples with a level (102)");
      const reads = sent.filter((q) => /FROM cbio_a\.genetic_alteration_derived/.test(q));
      assert.equal(reads.length, 1, "one read: the levels, whose sum is the samples with one");
      for (const q of reads) {
        assert.ok(q.includes("AND profile_type = " + discreteCnaProfileSql(S, "cbio_a")));
        assert.match(q, /hugo_gene_symbol = 'KRAS'/);
        assert.match(q, /alteration_value IN \('2', '1', '0', '-1', '-2'\)/);
      }
      assert.ok(!sent.some((q) => /cna_alteration AS c/.test(q)), "no read of the called ±2 events");
    });

    test("drivers only labels the states as driver calls and puts the driver condition on every call", async () => {
      facetAnswers();
      geneAnswers();
      const r = await buildExplore({ study: S, skipBins: true, skipGenes: true, geneCharts: ["EGFR"], drivers: true, oncokbPin: "v7.5" });
      assert.equal(r.drivers, "v7.5");
      assert.deepEqual(r.geneFacets!.flatMap((f) => f.states.map((s) => s.label)),
        ["Driver mutation", "No driver mutation", "Not Profiled", "Driver amplification", "Driver deletion", "No driver call", "Not profiled"]);
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

    test("each of a gene's charts leaves out its own clauses only: a copy-number click still narrows the mutation chart", async () => {
      facetAnswers();
      geneAnswers();
      on(/SELECT DISTINCT pid, sid FROM/, [{ pid: "P1", sid: "S1" }]);
      const draft = { all: [
        { kind: "genomicData" as const, gene: "KRAS", profileType: "CNA", values: ["1"], ifHeld: true as const },
        { kind: "clinical" as const, attribute: "SEX", values: ["Female"] },
      ] };
      const r = await buildExplore({ study: S, draft, skipBins: true, skipGenes: true, geneCharts: ["KRAS"] });
      const total = (type: string) => r.geneFacets!.find((f) => f.type === type)!.total;
      assert.equal(total("CNA"), 70, "the copy-number chart is counted without its own click");
      assert.equal(total("MUTATION"), 1, "the mutation chart keeps it: the draft's own size");
    });

    test("a typed copy-number range, or an OQL copy-number call, is the copy-number chart's; a mutation call the mutation chart's", async () => {
      for (const [clause, own] of [
        [{ kind: "genomicData", gene: "KRAS", profileType: "CNA", range: { lte: -1 } }, null],
        [{ kind: "oql", q: "KRAS: AMP HOMDEL" }, "CNA"],
        [{ not: { kind: "oql", q: "KRAS: AMP" } }, "CNA"],
        [{ kind: "oql", q: "KRAS: MUT" }, "MUTATION"],
        [{ kind: "profiled", type: "CNA", gene: "KRAS" }, "CNA"],
        [{ kind: "oql", q: "KRAS:" }, "both"],
        [{ kind: "oql", q: "KRAS: MUT AMP" }, "both"],
      ] as const) {
        sent = []; answers = [];
        facetAnswers();
        geneAnswers();
        on(/SELECT DISTINCT pid, sid FROM/, [{ pid: "P1", sid: "S1" }]);
        const r = await buildExplore({ study: S, draft: { all: [clause as never, { kind: "clinical" as const, attribute: "SEX", values: ["Female"] }] }, skipBins: true, skipGenes: true, geneCharts: ["KRAS"] });
        const total = (type: string) => r.geneFacets!.find((f) => f.type === type)!.total;
        const label = JSON.stringify(clause);
        assert.equal(total("CNA"), own === "CNA" || own === "both" ? 70 : 1, label + ": copy-number chart");
        assert.equal(total("MUTATION"), own === "MUTATION" || own === "both" ? 70 : 1, label + ": mutation chart");
      }
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

  test("STS-MD-5: an attribute patient-level in one study and sample-level in another is read per sample everywhere", async () => {
    on(/groupUniqArray\(lower\(toString\(cam\.patient_attribute\)\)\) AS lv/, (q) => /cbio_b\./.test(q)
      ? [{ a: "GRADE", lv: ["0"] }, { a: "SEX", lv: ["1"] }] : [{ a: "GRADE", lv: ["1"] }, { a: "SEX", lv: ["true"] }]);
    assert.deepEqual(await conflictingLevels(["st1", "st2"], connByStudy), ["GRADE"], "SEX is patient-level in both");
    assert.deepEqual(await conflictingLevels(["st1"], connByStudy), [], "one study has nothing to reconcile");
    twoConnAnswers();
    await buildExploreFederated({ studies: ["st1", "st2"], profilesByStudy: profiles, connByStudy, attributes: ["GRADE", "SEX"] });
    const lifted = sent.filter((q) => /attribute_name IN \('GRADE'\)\)/.test(q));
    assert.ok(lifted.some((q) => /AS numratio/.test(q)), "the facets read GRADE per sample");
    assert.ok(lifted.some((q) => /cbio_b\./.test(q)) && lifted.some((q) => /cbio_a\./.test(q)), "on every connection");
  });

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

  test("three filter groups: one scan per connection, its cohort each study's, no value list counted per study", async () => {
    // two filtered attributes (bits 0, 1) and the OQL clause as the rest: bit 2 is every filter
    on(/^SELECT st, s, p, pm FROM/, (q) => /cbio_b\./.test(q) ? [{ st: "st2", s: "st2_X1", p: "st2_Y1", pm: "4" }]
      : [{ st: "st1", s: "st1_S1", p: "st1_P1", pm: "7" }, { st: "st1", s: "st1_S2", p: "st1_P2", pm: "1" }]);
    on(/maxIf\(c\.val/, (q) => [{ s: /cbio_b\./.test(q) ? "st2" : "st1", type: "patient", a: "SEX", v: "Female", vkey: "female", n: 1 }]);
    on(/AS n_all/, (q) => [{ type: "patient", a: "AGE", v: /cbio_b\./.test(q) ? "40" : "60", n: 1, n_all: 5 }]);
    twoConnAnswers();
    const draft = { all: [{ kind: "clinical" as const, attribute: "SEX", values: ["Female"] }, { kind: "clinical" as const, attribute: "AGE", range: { gt: 1 } },
      { kind: "oql" as const, q: "KRAS: MUT" }] };
    const r = await buildExploreFederated({ studies: ["st1", "st2"], draft, connByStudy, profilesByStudy: profiles });
    assert.equal(sent.filter((q) => /^SELECT st, s, p, pm FROM/.test(q)).length, 2, "one per connection");
    assert.equal(r.draftCount, 2, "st1's S1 and st2's X1, from the scans");
    assert.ok(!sent.some((q) => /SELECT DISTINCT pid, sid FROM/.test(q)));
    assert.ok(!sent.some((q) => /AS vkey/.test(q) && !/_scan_/.test(q)), "every value list from a scan");
    const age = r.clinical.find((c) => c.attribute === "AGE")!;
    assert.ok(age.kind === "num" && age.disjunctive);
    assert.equal(age.bins!.reduce((n, b) => n + b.count, 0), 2, "both connections' values at AGE's own bit, pooled");
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
    mn: 0, mx: 100, q2: 50, nv: 10, ...o });

  test("a profile no selected study holds is refused by name", async () => {
    const [f] = await buildAssayFacets({ studies: ["st3"], profilesByStudy: holders, charts: [{ profileType: PT, entity: "SBS1" }] });
    assert.match(f.error!, /no selected study has the generic-assay profile 'mutational_signature'/);
    assert.equal(sent.length, 0);
  });

  test("a numeric entity: pooled range and size-weighted median, its bars the DataBinner's over the values of every connection", async () => {
    on(/WITH ents AS/, [{ entity: "SBS1", name: "Clock-like" }]);
    on(/AS total_p/, (q) => [stats(/'st2_/.test(q) ? { mn: 10, mx: 60, q2: 30, nv: 30 } : {})]);
    // st1's values on the primary, st2's on the second connection: binned together
    on(/trimBoth\(value\) AS raw, uniqExact/, (q) => /cbio_b\./.test(q)
      ? Array.from({ length: 10 }, (_, i) => ({ raw: String(10 * i + 5), n: 1 }))
      : Array.from({ length: 10 }, (_, i) => ({ raw: String(10 * i), n: 1 })));
    const [f] = await buildAssayFacets({ studies: ["st1", "st2", "st3"], profilesByStudy: holders, connByStudy: new Map([["st2", SECOND]]),
      charts: [{ profileType: PT, entity: "SBS1" }] });
    assert.deepEqual(f.studies, ["st1", "st2"]);
    assert.equal(f.kind, "num");
    assert.equal(f.unit, "sample");
    assert.equal(f.name, "Clock-like");
    assert.deepEqual([f.total, f.measured, f.min, f.max, f.median], [24, 20, 0, 100, 35]);
    assert.ok(f.kind === "num");
    const values = [...Array.from({ length: 10 }, (_, i) => ({ value: String(10 * i), count: 1 })), ...Array.from({ length: 10 }, (_, i) => ({ value: String(10 * i + 5), count: 1 }))];
    assert.deepEqual(f.bins, dataBins(values), "the pooled values, binned once");
    assert.equal(f.bins!.reduce((n, b) => n + b.count, 0), 20);
  });

  test("STS-BAR-1: a generic-assay entity's bars are the portal's (brca methylation cg00000029, every bar and count)", async () => {
    on(/AS total_p/, [stats({ total_s: 1084, nnum_s: 776, mn: 0.0419244, mx: 0.9, q2: 0.17, nv: 776 })]);
    on(/trimBoth\(value\) AS raw, uniqExact/, CG29.values.map((raw) => ({ raw, n: 1 })));
    const [f] = await buildAssayFacets({ studies: ["st1"], profilesByStudy: holders, charts: [{ profileType: PT, entity: "cg00000029" }] });
    assert.ok(f.kind === "num");
    assert.deepEqual(f.bins, CG29.portalBins, "21 bars, the last \">0.44\" (49) as the portal's");
    assert.equal(f.total - f.measured, 308, "the portal's NA");
  });

  test("a patient-level profile is counted in patients", async () => {
    on(/AS total_p/, [stats({ pl: 1 })]);
    on(/trimBoth\(value\) AS raw, uniqExact/, [{ raw: "1", n: 3 }, { raw: "9", n: 5 }]);
    const [f] = await buildAssayFacets({ studies: ["st1"], profilesByStudy: holders, charts: [{ profileType: PT, entity: "SBS1" }] });
    assert.deepEqual([f.unit, f.total, f.measured], ["patient", 10, 8]);
    assert.equal(f.name, undefined, "no name beyond the id");
    assert.match(sent.find((q) => /AS raw, uniqExact/.test(q))!, /uniqExact\(patient_unique_id\) AS n/);
  });

  test("a zero-inflated entity is binned over its whole range", async () => {
    on(/AS total_p/, [stats({ mn: 0, mx: 10, q2: 0 })]);
    on(/trimBoth\(value\) AS raw, uniqExact/, [{ raw: "0", n: 90 }, { raw: "4", n: 3 }, { raw: "10", n: 2 }]);
    const [f] = await buildAssayFacets({ studies: ["st1"], profilesByStudy: holders, charts: [{ profileType: PT, entity: "SBS1" }] });
    assert.ok(f.kind === "num" && f.bins!.length >= 2);
    assert.equal(f.bins!.reduce((n, b) => n + b.count, 0), 95);
  });

  test("an entity with no numbers has no bars, and a single value has no histogram", async () => {
    on(/AS total_p/, [stats({ nv: 0 })]);
    const [none] = await buildAssayFacets({ studies: ["st1"], profilesByStudy: holders, charts: [{ profileType: PT, entity: "SBS1" }] });
    assert.ok(none.kind === "num");
    assert.deepEqual([none.measured, none.bins, none.min], [10, undefined, undefined]);
    answers = [];
    on(/AS total_p/, [stats({ mn: 3, mx: 3 })]);
    on(/trimBoth\(value\) AS raw, uniqExact/, [{ raw: "3", n: 10 }]);
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

  test("SD16: a categorical entity keeps its values up to the clinical charts' bound, and reports how many it has", async () => {
    const past = FACET_VALUE_LIMIT + 15;
    on(/AS total_p/, [stats({ dt: "CATEGORICAL" })]);
    on(/trimBoth\(value\) AS v, uniqExact/, Array.from({ length: past }, (_, i) => ({ v: "V" + String(i).padStart(6, "0"), n: past + 100 - i })));
    on(/^SELECT uniqExact\(sample_unique_id\) AS n FROM cbio_\w\.generic_assay_data_derived/, [{ n: past }]);
    const [many] = await buildAssayFacets({ studies: ["st1"], profilesByStudy: holders, charts: [{ profileType: PT, entity: "MSI" }] });
    assert.ok(many.kind === "cat");
    assert.equal(many.values!.length, FACET_VALUE_LIMIT, "ASSAY_VALUE_LIMIT, the clinical charts' bound");
    assert.equal(many.distinct, past, "the true number of distinct values, so the cut shows");
    answers = [];
    on(/AS total_p/, [stats({ dt: "CATEGORICAL" })]);
    on(/trimBoth\(value\) AS v, uniqExact/, Array.from({ length: 12 }, (_, i) => ({ v: "W" + i, n: 20 - i })));
    on(/^SELECT uniqExact\(sample_unique_id\) AS n FROM cbio_\w\.generic_assay_data_derived/, [{ n: 12 }]);
    const [few] = await buildAssayFacets({ studies: ["st1"], profilesByStudy: holders, charts: [{ profileType: PT, entity: "MSI" }] });
    assert.ok(few.kind === "cat");
    assert.equal(few.values!.length, 12);
    assert.equal(few.distinct, few.values!.length, "nothing cut");
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

// ---- gene tables hold every gene (docs/legacy-spec/parity/gene-tables-cases.md GR1, GR2) ----
// The portal's alteration-count queries have no LIMIT (ClickhouseAlterationMapper.xml:32, 59, 82),
// so a table holds every gene with an event of its type, and a merge keeps every row it is given.
describe("gene tables hold every gene", () => {
  const gpart = (o: Partial<ExploreResult>): ExploreResult => ({
    study: "", studies: [], draftCount: null, clinical: [], events: [], caseLists: [], profiles: [], gaProfiles: [], stats: { ms: 0 }, ...o,
  } as ExploreResult);
  const geneRows = (prefix: string, n: number, extra: Record<string, unknown> = {}) =>
    Array.from({ length: n }, (_, i) => ({ gene: prefix + String(i).padStart(4, "0"), altered: 1, alteredOnPanel: 1, events: 1, profiled: 10, freqPct: 10, ...extra }));

  for (const key of ["mutatedGenes", "cnaGenes", "svGenes"] as const) {
    test(`GR2: ${key} of two parts with 400 different genes each merge to all 800`, () => {
      const extra = key === "cnaGenes" ? { cna: 2, cytoband: "1p" } : {};
      const m = mergeExplore([gpart({ [key]: geneRows("A", 400, extra) } as never), gpart({ [key]: geneRows("B", 400, extra) } as never)]);
      const got = m[key]!;
      assert.equal(got.length, 800);
      assert.equal(new Set(got.map((g) => g.gene)).size, 800);
    });
  }

  test("GR2: a gene in both parts is summed, among 800 others", () => {
    const shared = (altered: number, onPanel: number, events: number, profiled: number) =>
      ({ gene: "KRAS", altered, alteredOnPanel: onPanel, events, profiled, freqPct: null });
    const m = mergeExplore([
      gpart({ mutatedGenes: [...geneRows("A", 400), shared(3, 2, 5, 30)] as never }),
      gpart({ mutatedGenes: [...geneRows("B", 400), shared(4, 4, 6, 70)] as never }),
    ]);
    assert.equal(m.mutatedGenes!.length, 801);
    const kras = m.mutatedGenes!.find((g) => g.gene === "KRAS")!;
    assert.deepEqual([kras.altered, kras.alteredOnPanel, kras.events, kras.profiled], [7, 6, 11, 100]);
  });

  test("GR2: a CNA gene's two calls stay two rows; the same call in both parts is summed", () => {
    const m = mergeExplore([
      gpart({ cnaGenes: [...geneRows("A", 400, { cna: 2 }), { gene: "MYC", altered: 1, alteredOnPanel: 1, events: 1, profiled: 10, freqPct: 10, cna: 2, cytoband: "8q24.21" }] as never }),
      gpart({ cnaGenes: [...geneRows("B", 400, { cna: 2 }), { gene: "MYC", altered: 2, alteredOnPanel: 2, events: 2, profiled: 20, freqPct: 10, cna: 2, cytoband: "8q24.21" },
        { gene: "MYC", altered: 5, alteredOnPanel: 5, events: 5, profiled: 20, freqPct: 25, cna: -2, cytoband: "8q24.21" }] as never }),
    ]);
    assert.equal(m.cnaGenes!.length, 802);
    const amp = m.cnaGenes!.find((g) => g.gene === "MYC" && g.cna === 2)!;
    assert.deepEqual([amp.altered, amp.events, amp.profiled], [3, 3, 30]);
    assert.ok(m.cnaGenes!.some((g) => g.gene === "MYC" && g.cna === -2));
  });

  const answer600 = () => {
    facetAnswers();
    on(/AS altered/, (q) => /variant_type = 'mutation'/.test(q)
      ? Array.from({ length: 600 }, (_, i) => ({ g: "G" + String(i).padStart(4, "0"), altered: 1, on_panel: 1, events: 1 }))
      : []);
    on(/gene_panel_id = 'WES'/, [{ n: 100 }]);
  };

  test("GR1: one study's mutated-gene table holds all 600 genes the statement returns", async () => {
    answer600();
    const r = await buildExplore({ study: S, conn: PRIMARY, skipBins: true });
    assert.equal(r.mutatedGenes!.length, 600);
  });

  test("GR1: the gene-table statement asks for every row (no LIMIT)", async () => {
    answer600();
    await buildExplore({ study: S, conn: PRIMARY, skipBins: true });
    // The stand-in answers by matching text and cannot apply a LIMIT, so the 600 rows above come
    // back whatever the statement says; whether the warehouse would cut them is only visible here.
    const geneStmts = sent.filter((q) => /AS altered/.test(q) && /genomic_event_derived/.test(q));
    assert.equal(geneStmts.length, 3, "one per table: mutation, CNA, SV");
    for (const q of geneStmts) assert.ok(!/\bLIMIT\b/i.test(q), "no LIMIT in:\n" + q);
  });

  test("GR1: the multi-study path keeps all 600 genes of a connection's pooled table", async () => {
    answer600();
    const r = await buildExploreFederated({ studies: [S], skipBins: true,
      profilesByStudy: new Map([[S, { profiles: ["mutations"], gaProfiles: [] }]]) } as never);
    assert.equal(r.mutatedGenes!.length, 600);
  });
});

describe("review of #276 (multi-study Freq): one attribute charted as different kinds", () => {
  const part = (o: Partial<ExploreResult>): ExploreResult => ({
    study: "s", draftCount: null, clinical: [], events: [], caseLists: [], profiles: [], gaProfiles: [], stats: { ms: 0 }, ...o,
  } as ExploreResult);
  const num = (samples?: number) => part({ study: "n", totals: { patients: 100, samples: 100 },
    clinical: [{ attribute: "GRADE", per: "sample", kind: "num", patients: 30, min: 1, max: 3, median: 2, ...(samples != null ? { samples } : {}) }] });
  const cat = (samples?: number) => part({ study: "c", totals: { patients: 100, samples: 100 },
    clinical: [{ attribute: "GRADE", per: "sample", kind: "cat", patients: 10, values: [{ v: "G1", n: 10 }], ...(samples != null ? { samples } : {}) }] });
  const grade = (ps: ExploreResult[]) => mergeExplore(ps).clinical.filter((c) => c.attribute === "GRADE");

  test("the merged facet's samples is the sum over both studies", () => {
    const f = grade([num(30), cat(12)]);
    assert.equal(f.length, 1);
    assert.equal(f[0].samples, 42);
  });
  test("when either study lacks samples, the merged facet has none", () => {
    assert.equal(grade([num(30), cat()])[0].samples, undefined);
    assert.equal(grade([num(), cat(12)])[0].samples, undefined);
  });
});

// ---- the treatment tables (STS-OT-6) --------------------------------------------------------
describe("treatment tables", () => {
  const profiles = new Map([["st1", {}], ["st2", {}]]);
  // the two statements, told apart by what they read
  const PATIENTS = /GROUP BY agent WITH TOTALS/, SAMPLES = /GROUP BY agent, time WITH TOTALS/, ANY = /SELECT count\(\) AS n FROM \(SELECT 1 FROM/;

  test("patients per agent, most first; samples per agent and time; the totals as the database counts them", async () => {
    // chQuery hands back the database's JSON, totals included; the stand-in carries them on the reply
    setChTransport(async ({ query }) => {
      sent.push(query);
      const body = ANY.test(query) ? { data: [{ n: 1 }] } : PATIENTS.test(query) ? { data: [{ agent: "Leucovorin", n: 137 }, { agent: "Fluorouracil", n: 156 }], totals: { n: 214 } }
        : SAMPLES.test(query) ? { data: [{ agent: "Fluorouracil", time: "Pre", n: 155 }, { agent: "Fluorouracil", time: "Post", n: 1 }], totals: { n: 214 } }
        : { data: [] };
      return JSON.stringify({ meta: [], rows: body.data.length, ...body });
    });
    try {
      const t = await buildTreatmentFacets({ studies: ["st1"], profilesByStudy: profiles });
      assert.deepEqual(t, { patients: [{ agent: "Fluorouracil", n: 156 }, { agent: "Leucovorin", n: 137 }],
        samples: [{ agent: "Fluorouracil", time: "Pre", n: 155 }, { agent: "Fluorouracil", time: "Post", n: 1 }], totalPatients: 214, totalSamples: 214 });
      const s = sent.find((q) => SAMPLES.test(q))!;
      // only the study's own samples, each agent's first start, no id projected
      assert.match(s, /concat\(cancer_study_identifier, '_', value\) IN \(SELECT sample_unique_id FROM cbio_a\.sample_derived/);
      assert.match(s, /arrayMin\(arrayMap\(x -> x\.2, arrayFilter\(x -> x\.1 = a, t\)\)\)/);
      assert.match(s, /if\(sa\.2 <= tx\.2, 'Pre', 'Post'\)/);
      assert.doesNotMatch(s, /(patient|sample)_unique_id AS|SELECT (patient|sample)_unique_id,/, "no id is projected; ids are only grouped on or tested for membership");
      // the grouping reads only the rows it keeps, and an empty AGENT is no treatment
      assert.match(s, /GROUP BY patient_unique_id/);
      assert.match(s, /AND \(\(lower\(event_type\) = 'treatment' AND key = 'AGENT' AND value != ''\) OR \(lower\(event_type\) IN \('sample acquisition','specimen'\) AND key = 'SAMPLE_ID'\)\)/);
      assert.match(sent.find((q) => PATIENTS.test(q))!, /AND value != ''/);
    } finally {
      setChTransport(async ({ query }) => { sent.push(query); for (const [re, rows] of answers) if (re.test(query)) { const data = typeof rows === "function" ? rows(query) : rows; return JSON.stringify({ meta: [], data, rows: data.length }); } return JSON.stringify({ meta: [], data: [], rows: 0 }); });
    }
  });

  test("two connections add up, agent by agent", async () => {
    on(ANY, [{ n: 1 }]);
    on(PATIENTS, (q) => /cbio_b\./.test(q) ? [{ agent: "Fluorouracil", n: 4 }] : [{ agent: "Fluorouracil", n: 6 }, { agent: "Cisplatin", n: 1 }]);
    on(SAMPLES, (q) => /cbio_b\./.test(q) ? [{ agent: "Fluorouracil", time: "Post", n: 2 }] : [{ agent: "Fluorouracil", time: "Post", n: 3 }]);
    const t = await buildTreatmentFacets({ studies: ["st1", "st2"], profilesByStudy: profiles, connByStudy: new Map([["st2", SECOND]]) });
    assert.deepEqual(t!.patients, [{ agent: "Fluorouracil", n: 10 }, { agent: "Cisplatin", n: 1 }]);
    assert.deepEqual(t!.samples, [{ agent: "Fluorouracil", time: "Post", n: 5 }]);
  });

  test("the tables are counted under every filter, their own included, as the portal's", async () => {
    on(ANY, [{ n: 1 }]);
    const draft = { all: [{ kind: "treatment", agents: ["Fluorouracil"], ifHeld: true }] } as never;
    await buildTreatmentFacets({ studies: ["st1"], profilesByStudy: profiles, draft });
    assert.ok(sent.filter((q) => PATIENTS.test(q) || SAMPLES.test(q)).every((q) => /value IN \('Fluorouracil'\)/.test(q)),
      "the draft's treatment clause narrows both tables");
  });

  test("no table without treatments; a peer's treated studies are named, also when they are all there is", async () => {
    assert.equal(await buildTreatmentFacets({ studies: ["st1"], profilesByStudy: profiles }), null);
    sent = [];
    assert.deepEqual(await buildTreatmentFacets({ studies: [], profilesByStudy: profiles, leftOut: ["peer_study"] }),
      { patients: [], samples: [], totalPatients: 0, totalSamples: 0, leftOut: ["peer_study"] });
    assert.equal(sent.length, 0);
    assert.equal(await buildTreatmentFacets({ studies: [], profilesByStudy: profiles }), null);
    on(ANY, [{ n: 1 }]);
    on(PATIENTS, [{ agent: "Cisplatin", n: 1 }]);
    const t = await buildTreatmentFacets({ studies: ["st1"], profilesByStudy: profiles, leftOut: ["peer_study"] });
    assert.deepEqual(t!.leftOut, ["peer_study"]);
  });

  test("a study without treatments is not asked; one with them gets its tables even when a filter empties them", async () => {
    assert.equal(await buildTreatmentFacets({ studies: ["st1"], profilesByStudy: profiles }), null);
    assert.deepEqual(sent.filter((q) => PATIENTS.test(q) || SAMPLES.test(q)), [], "only the existence check ran");
    on(ANY, [{ n: 1 }]);
    const draft = { all: [{ kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] } as never;
    assert.deepEqual(await buildTreatmentFacets({ studies: ["st1"], profilesByStudy: profiles, draft }),
      { patients: [], samples: [], totalPatients: 0, totalSamples: 0 }, "empty tables, which say so, rather than none");
  });
});

// ---- a gene's Mutation Type Counts table (STS-OT-3) -----------------------------------------
describe("mutation-type tables", () => {
  const profiles = new Map([["st1", { profiles: ["mutations"] }], ["st2", { profiles: ["mutations"] }]]);
  // cbioportal.org, msk_impact_2017 TP53: /api/mutation-data-counts/fetch?categorization=MUTATION_TYPE, label · count (# Mut) · uniqueCount (#)
  const PORTAL_TP53: [string, string, number, number][] = [
    ["Frame_Shift_Del", "Frame Shift Del", 517, 510], ["Frame_Shift_Ins", "Frame Shift Ins", 157, 157],
    ["In_Frame_Del", "In Frame Del", 91, 91], ["In_Frame_Ins", "In Frame Ins", 25, 25],
    ["Missense_Mutation", "Missense Mutation", 3154, 2967], ["Nonsense_Mutation", "Nonsense Mutation", 683, 674],
    ["Nonstop_Mutation", "Nonstop Mutation", 2, 2], ["Splice_Site", "Splice Site", 325, 324],
  ];

  test("each type's mutations and samples as the portal's, its label, most samples first; Freq over the selected samples", async () => {
    on(/FROM cbio_a\.sample_derived/, [{ n: 10945 }]);
    on(/GROUP BY t/, PORTAL_TP53.map(([t, , m, n]) => ({ t, m, n })));
    const [f] = await buildMutationTypeFacets({ studies: ["st1"], profilesByStudy: profiles, genes: ["tp53"] });
    assert.equal(f.gene, "TP53");
    assert.equal(f.total, 10945);
    assert.deepEqual(f.rows.map((r) => [r.type, r.label, r.mutations, r.samples]),
      [...PORTAL_TP53].sort((a, b) => b[3] - a[3]));
    assert.equal(f.disjunctive, undefined);
    const q = sent.find((s) => /GROUP BY t/.test(s))!;
    assert.match(q, /variant_type = 'mutation' AND hugo_gene_symbol = 'TP53'/);
    assert.doesNotMatch(q, /mutation_status|driver/, "every mutation, uncalled ones and passengers included, as the portal counts");
  });

  test("studies on two connections add up, type by type", async () => {
    on(/sample_derived/, (q) => [{ n: /cbio_b\./.test(q) ? 50 : 100 }]);
    on(/GROUP BY t/, (q) => /cbio_b\./.test(q) ? [{ t: "Missense_Mutation", m: 4, n: 3 }] : [{ t: "Missense_Mutation", m: 10, n: 8 }, { t: "Splice_Site", m: 1, n: 1 }]);
    const [f] = await buildMutationTypeFacets({ studies: ["st1", "st2"], profilesByStudy: profiles, connByStudy: new Map([["st2", SECOND]]), genes: ["KRAS"] });
    assert.equal(f.total, 150);
    assert.deepEqual(f.rows.map((r) => [r.type, r.mutations, r.samples]), [["Missense_Mutation", 14, 11], ["Splice_Site", 1, 1]]);
  });

  test("a peer's studies are named on every table, never counted silently; with only a peer's, no query runs", async () => {
    const none = await buildMutationTypeFacets({ studies: [], profilesByStudy: profiles, genes: ["KRAS"], leftOut: ["peer_study"] });
    assert.deepEqual(none, [{ gene: "KRAS", total: 0, rows: [], leftOut: ["peer_study"] }]);
    assert.equal(sent.length, 0);
    on(/sample_derived/, [{ n: 100 }]);
    const [mixed] = await buildMutationTypeFacets({ studies: ["st1"], profilesByStudy: profiles, genes: ["KRAS"], leftOut: ["peer_study"] });
    assert.deepEqual([mixed.total, mixed.leftOut], [100, ["peer_study"]]);
  });

  test("genes without a filter of their own share one count of the selection", async () => {
    on(/sample_derived/, [{ n: 100 }]);
    const fs = await buildMutationTypeFacets({ studies: ["st1"], profilesByStudy: profiles, genes: ["KRAS", "TP53", "EGFR"] });
    assert.deepEqual(fs.map((f) => f.total), [100, 100, 100]);
    assert.equal(sent.filter((q) => /FROM cbio_a\.sample_derived/.test(q) && !/genomic_event_derived/.test(q)).length, 1);
  });

  test("the table is counted without its own filter, and with every other one", async () => {
    const draft = { all: [
      { not: { kind: "genomicData", gene: "TP53", profileType: "MUTATION_TYPE", values: ["Nonsense_Mutation"] } },
      { kind: "genomicData", gene: "KRAS", profileType: "MUTATION_TYPE", values: ["Missense_Mutation"] },
    ] } as never;
    const [tp53, kras] = await buildMutationTypeFacets({ studies: ["st1"], profilesByStudy: profiles, draft, genes: ["TP53", "KRAS"] });
    assert.equal(tp53.disjunctive, true);
    assert.equal(kras.disjunctive, true);
    // the table's own count reads the gene on the line it filters mutations by; a filter's subquery on its own line
    const count = (gene: string) => sent.find((s) => /GROUP BY t/.test(s) && s.includes("variant_type = 'mutation' AND hugo_gene_symbol = '" + gene + "'"))!;
    assert.match(count("TP53"), /mutation_type IN \('Missense_Mutation'\)/, "KRAS's filter narrows TP53's table");
    assert.doesNotMatch(count("TP53"), /'Nonsense_Mutation'/, "TP53's own filter does not");
    assert.match(count("KRAS"), /mutation_type IN \('Nonsense_Mutation'\)/);
    assert.doesNotMatch(count("KRAS"), /'Missense_Mutation'/);
  });
});

// ---- the generic-assay frequency tables (STS-OT-5) ------------------------------------------
describe("generic-assay frequency tables", () => {
  const holders = new Map([["st1", { gaProfiles: ["armlevel_cna", "mutational_signature"] }], ["st2", { gaProfiles: ["armlevel_cna"] }]]);
  const catalog = [
    { profile: "armlevel_cna", type: "GENERIC_ASSAY", datatype: "CATEGORICAL", name: "Putative arm-level copy-number from GISTIC", assayType: "ARMLEVEL_CNA" },
    { profile: "mutational_signature", type: "GENERIC_ASSAY", datatype: "LIMIT-VALUE", name: "Signatures" },
    { profile: "loh", type: "GENERIC_ASSAY", datatype: "BINARY", name: "LOH", patientLevel: true },
  ];

  test("a table per categorical profile held: (entity, value) counts summed over connections, names, the profile's unit, own filter left out", async () => {
    // the counts first: with a draft they embed the cohort's SQL, which reads sample_derived too
    on(/GROUP BY e, v/, (q) => /cbio_b\./.test(q) ? [{ e: "1p_status", v: "Loss", n: 2 }]
      : [{ e: "1p_status", v: "Loss", n: 148 }, { e: "8q_status", v: "Gain", n: 270 }, { e: "8q_status", v: "NA", n: 51 }, { e: "1p_status", v: "", n: 3 }]);
    on(/WITH ents AS/, [{ entity: "1p_status", name: "1p" }, { entity: "8q_status", name: "8q" }]);
    on(/FROM cbio_a\.sample_derived/, [{ n: 594 }]);
    on(/FROM cbio_b\.sample_derived/, [{ n: 100 }]);
    const draft = { all: [{ kind: "genericAssay", profileType: "armlevel_cna", entity: "1p_status", values: ["Loss"] }, { kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] } as never;
    const { tables: ts } = await buildAssayFreqTables({ studies: ["st1", "st2"], profilesByStudy: holders, connByStudy: new Map([["st2", SECOND]]), catalog, draft });
    assert.equal(ts.length, 1, "the numeric profile has no table; the binary one no selected study holds");
    const t = ts[0];
    assert.deepEqual([t.profileType, t.unit, t.binary, t.total, t.disjunctive, t.studies], ["armlevel_cna", "sample", false, 694, true, ["st1", "st2"]]);
    assert.deepEqual(t.rows.map((r) => [r.name, r.value, r.n]), [["1p", "Loss", 150], ["8q", "Gain", 270]], "NA and empty values dropped");
    const counts = sent.filter((q) => /GROUP BY e, v/.test(q));
    assert.ok(counts.every((q) => !/'1p_status'/.test(q)), "the table's own filter does not narrow it");
    assert.ok(counts.every((q) => /'Female'/.test(q)), "another filter does");
  });

  test("a patient-level binary profile is counted in patients, its absent values dropped", async () => {
    const h = new Map([["st1", { gaProfiles: ["loh"] }]]);
    on(/WITH ents AS/, []);
    on(/sample_derived/, [{ n: 10 }]);
    on(/GROUP BY e, v/, [{ e: "HLA-A", v: "1", n: 4 }, { e: "HLA-A", v: "0", n: 6 }]);
    const { tables: [t] } = await buildAssayFreqTables({ studies: ["st1"], profilesByStudy: h, catalog });
    assert.deepEqual([t.unit, t.binary, t.rows], ["patient", true, [{ entity: "HLA-A", value: "1", n: 4, name: "HLA-A" }]]);
    assert.ok(sent.filter((q) => /GROUP BY e, v/.test(q)).every((q) => /uniqExact\(patient_unique_id\)/.test(q)));
  });

  test("the table's own Union of several entities (an any) is its own filter too, left out and said", async () => {
    on(/GROUP BY e, v/, [{ e: "1p_status", v: "Loss", n: 148 }]);
    on(/WITH ents AS/, []);
    on(/sample_derived/, [{ n: 594 }]);
    const own = { any: [{ kind: "genericAssay", profileType: "armlevel_cna", entity: "1p_status", values: ["Loss"] },
      { kind: "genericAssay", profileType: "armlevel_cna", entity: "8q_status", values: ["Gain"] }] };
    const { tables: [t] } = await buildAssayFreqTables({ studies: ["st1"], profilesByStudy: holders, catalog, draft: { all: [own] } as never });
    assert.equal(t.disjunctive, true);
    assert.ok(sent.filter((q) => /GROUP BY e, v/.test(q)).every((q) => !/'8q_status'/.test(q)), "its any does not narrow it");
  });

  test("Freq's denominator is every selected case, a selected study without the profile included, as the portal divides", async () => {
    const h = new Map([["st1", { gaProfiles: ["armlevel_cna"] }], ["st3", {}]]);
    on(/GROUP BY e, v/, (q) => /'st3_armlevel_cna'/.test(q) ? [] : [{ e: "1p_status", v: "Loss", n: 148 }]);
    on(/WITH ents AS/, []);
    on(/sample_derived/, (q) => [{ n: /'st3'/.test(q) ? 594 + 400 : 594 }]);
    const { tables: [t] } = await buildAssayFreqTables({ studies: ["st1", "st3"], profilesByStudy: h, catalog });
    assert.equal(t.total, 994, "st3's 400 samples count in the denominator");
    assert.deepEqual(t.studies, ["st1"], "the studies holding the profile, for the note");
    assert.ok(sent.filter((q) => /GROUP BY e, v/.test(q)).every((q) => !/st3_armlevel_cna/.test(q)), "only holders are read for values");
  });

  test("every selected peer study is named, not counted, as on the mutation-type tables; a profile only a peer holds still has its table", async () => {
    // peer2 does not hold the profile (or its list went unanswered): its cases are not in Freq either
    const h = new Map([["st1", { gaProfiles: ["armlevel_cna"] }], ["peer1", { gaProfiles: ["armlevel_cna", "loh"] }], ["peer2", {}]]);
    on(/GROUP BY e, v/, [{ e: "1p_status", v: "Loss", n: 148 }]);
    on(/WITH ents AS/, []);
    on(/sample_derived/, [{ n: 594 }]);
    const { tables } = await buildAssayFreqTables({ studies: ["st1"], peers: ["peer1", "peer2"], profilesByStudy: h, catalog });
    const arm = tables.find((t) => t.profileType === "armlevel_cna")!, loh = tables.find((t) => t.profileType === "loh")!;
    assert.deepEqual([arm.leftOut, arm.rows.length], [["peer1", "peer2"], 1]);
    assert.deepEqual([loh.leftOut, loh.rows, loh.studies], [["peer1", "peer2"], [], []]);
  });

  test("past the table limit the rest are named, the limit counted over profiles some selected study holds", async () => {
    const many = Array.from({ length: ASSAY_FREQ_TABLE_LIMIT + 2 }, (_, i) => ({ profile: "p" + i, type: "GENERIC_ASSAY", datatype: "CATEGORICAL", name: "Profile " + i }));
    // p0 is held by nobody: it is not a table and does not use a place
    const h = new Map([["st1", { gaProfiles: many.slice(1).map((p) => p.profile) }]]);
    on(/WITH ents AS/, []);
    on(/sample_derived/, [{ n: 10 }]);
    const { tables, notShown } = await buildAssayFreqTables({ studies: ["st1"], profilesByStudy: h, catalog: many });
    assert.deepEqual(tables.map((t) => t.profileType), many.slice(1, 1 + ASSAY_FREQ_TABLE_LIMIT).map((p) => p.profile));
    assert.deepEqual(notShown, ["Profile " + (ASSAY_FREQ_TABLE_LIMIT + 1)]);
  });
});

// STS-VI-1: the clinical violin table's counts (scripts/check-violin.ts runs the SQL against data)
describe("violin tables", () => {
  const profiles = new Map([["st1", {}], ["st2", {}]]);
  const chart = { categorical: "SEX", numeric: "AGE" };

  test("per category, each value with the samples holding it and those the selection keeps; spellings folded, peers named", async () => {
    on(/GROUP BY ck, v/, [
      { cat: "Female", ck: "female", v: 50, n: 3, sel: 2 }, { cat: "female", ck: "female", v: 61, n: 1, sel: 1 },
      { cat: "Male", ck: "male", v: 50, n: 2, sel: 0 },
    ]);
    const [f] = await buildViolinFacets({ studies: ["st1"], profilesByStudy: profiles, charts: [chart], leftOut: ["peer_study"] });
    assert.deepEqual(f, { categorical: "SEX", numeric: "AGE", leftOut: ["peer_study"], categories: [
      { category: "female", values: [{ v: 50, n: 3, sel: 2 }, { v: 61, n: 1, sel: 1 }] },
      { category: "Male", values: [{ v: 50, n: 2, sel: 0 }] },
    ] });
    const q = sent.find((x) => /GROUP BY ck, v/.test(x))!;
    assert.match(q, /type = 'sample' AND attribute_name IN \('SEX', 'AGE'\)/);
    assert.ok(q.includes(finiteSql("anyIf(attribute_value, attribute_name = 'AGE')") + " AS x"), "a number as finiteSql reads it: nan and inf are missing");
    assert.match(q, /WHERE c != '' AND x IS NOT NULL/, "a sample without both values is not counted");
    assert.match(q, /1 AS kept/, "no filter: every sample kept");
  });

  test("two connections' samples add, value by value", async () => {
    on(/GROUP BY ck, v/, (q) => /cbio_b\./.test(q) ? [{ cat: "Female", ck: "female", v: 50, n: 4, sel: 4 }] : [{ cat: "Female", ck: "female", v: 50, n: 1, sel: 1 }]);
    const [f] = await buildViolinFacets({ studies: ["st1", "st2"], profilesByStudy: profiles, connByStudy: new Map([["st2", SECOND]]), charts: [chart] });
    assert.deepEqual(f.categories, [{ category: "Female", values: [{ v: 50, n: 5, sel: 5 }] }]);
  });

  test("drawn without the numeric attribute's own filter, # counted with it; another filter narrows both", async () => {
    const own = { kind: "clinical", attribute: "AGE", range: { gt: 50, lte: 60 } }, other = { kind: "clinical", attribute: "SEX", op: "=", value: "Female" };
    await buildViolinFacets({ studies: ["st1"], profilesByStudy: profiles, charts: [chart], draft: { all: [own, other] } as never });
    const q = sent.find((x) => /GROUP BY ck, v/.test(x))!;
    const [kept, drawn] = [q.slice(q.indexOf("sample_unique_id IN"), q.indexOf("AS kept")), q.slice(q.indexOf("AND sample_unique_id IN"))];
    assert.match(kept, /50/, "# keeps the AGE range");
    assert.match(drawn.slice(0, drawn.indexOf("GROUP BY sample_unique_id")), /'Female'/, "the values drawn keep the other filter");
    assert.doesNotMatch(drawn.slice(0, drawn.indexOf("GROUP BY sample_unique_id")), /60/, "and not the numeric one's");
  });

  test("past the value limit the table is refused, naming it; a bad attribute or a pair of one is not asked", async () => {
    on(/GROUP BY ck, v/, Array.from({ length: VIOLIN_VALUE_LIMIT + 1 }, (_, i) => ({ cat: "A", ck: "a", v: i, n: 1, sel: 1 })));
    const [f] = await buildViolinFacets({ studies: ["st1"], profilesByStudy: profiles, charts: [chart, { categorical: "A B", numeric: "AGE" }, { categorical: "AGE", numeric: "AGE" }] });
    assert.match(f.error!, /more than 50,000 distinct/);
    assert.deepEqual(f.categories, []);
    assert.equal((await buildViolinFacets({ studies: ["st1"], profilesByStudy: profiles, charts: [{ categorical: "A B", numeric: "AGE" }] })).length, 0);
  });
});
