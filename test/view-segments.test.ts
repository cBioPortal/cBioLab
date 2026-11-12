// The segments view (lib/views/segments/): a cohort's samples as copy-number segment tracks —
// cBioPortal's CN Segments tab. The runner is driven with hand-made participants whose segments live
// in memory (their queries are read for the region, order and limit they ask, and answered as the
// database would); the colour scale, the gene loci, the SQL and the figure are checked on their own.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runSegments, parseRegion, SEGMENTS_ROWS_MAX, SEGMENTS_MAX, OVERVIEW_MUTATIONS_MAX } from "../lib/views/segments/run.ts";
import { segmentSamplesRows, segmentRows, overviewMutationRows, overviewPanelRows, SEGMENT_CHROMS } from "../lib/views/segments/sql.ts";
import { segmentsSvg } from "../lib/views/segments/figure.ts";
import { segmentsKind } from "../lib/views/segments/kind.ts";
import { igvLocus, igvSegFeatures, overviewTrackHeight, overviewSegFeatures, overviewMutFeatures, trackSamples, cnaAlteredPct, panelIcons, OVERVIEW_ROW } from "../lib/views/segments/igv.ts";
import { regionSegs } from "../lib/views/segments/figure.ts";
import { segmentColor } from "../lib/chart/style.ts";
import { geneLocus, decodeLoci } from "../lib/gene-loci.ts";
import { encodeLoci, spansOf } from "../scripts/gen-gene-loci.ts";
import { lintSvg } from "../lib/chart/lint.ts";
import * as federation from "../lib/federation.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult, PatientEvent } from "../lib/types.ts";
import type { SegmentsView, SegmentsResult } from "../lib/views/segments/types.ts";

type Seg = { sid: number; sample: string; patient: string; stype: string; chrom: string; st: number; en: number; m: number };

/** answers a segments query the way ClickHouse would, from the region, order and limit it names */
function answer(sql: string, segs: Seg[]): Record<string, unknown>[] {
  const range = /\(chrom = '([^']+)' AND en >= (\d+) AND st <= (\d+)\)/.exec(sql);
  const axisM = /indexOf\(\[([^\]]*)\]/.exec(sql) || /countIf\(has\(\[([^\]]*)\]/.exec(sql);
  const axis = range ? [range[1]] : (axisM ? axisM[1].split(",").map((x) => x.replace(/'/g, "")) : []);
  const inR = (s: Seg) => range ? s.chrom === range[1] && s.en >= +range[2] && s.st <= +range[3] : axis.includes(s.chrom);
  const bases = (s: Seg) => range ? Math.max(0, Math.min(s.en, +range[3]) - Math.max(s.st, +range[2]) + 1) : s.en - s.st + 1;
  const ids = /internal_id IN \(([^)]*)\)/.exec(sql);
  if (ids) {
    const want = new Set(ids[1].split(",").map(Number));
    return segs.filter((s) => want.has(s.sid) && inR(s)).sort((a, b) => a.sid - b.sid || axis.indexOf(a.chrom) - axis.indexOf(b.chrom) || a.st - b.st)
      .map((s) => ({ sid: s.sid, c: axis.indexOf(s.chrom), st: s.st, en: s.en, m: s.m }));
  }
  const by = new Map<number, Seg[]>();
  for (const s of segs) { const l = by.get(s.sid); if (l) l.push(s); else by.set(s.sid, [s]); }
  let rows = [...by.values()].map((list) => {
    const inside = list.filter(inR), w = inside.reduce((a, s) => a + bases(s), 0);
    return { sid: list[0].sid, sample: list[0].sample, patient: list[0].patient, stype: list[0].stype, segs: inside.length, allSegs: list.filter((s) => SEGMENT_CHROMS.includes(s.chrom)).length,
      score: w ? inside.reduce((a, s) => a + s.m * bases(s), 0) / w : null, other: list.filter((s) => !SEGMENT_CHROMS.includes(s.chrom)).length };
  });
  const segmented = rows.length, otherChrom = rows.reduce((a, r) => a + r.other, 0);
  const dir = /score DESC/.test(sql) ? -1 : /score ASC/.test(sql) ? 1 : 0;
  rows.sort((a, b) => dir ? ((a.score == null ? 1 : 0) - (b.score == null ? 1 : 0) || (a.score != null && b.score != null ? dir * (a.score - b.score) : 0) || a.sid - b.sid) : a.sid - b.sid);
  rows = rows.slice(0, Number(/LIMIT (\d+)/.exec(sql)![1]));
  return rows.map((r) => ({ ...r, segmented, otherChrom }));
}

type Mut = { sid: number; sample: string; patient: string; stype: string; chrom: string; st: number; en: number; gene: string; change: string; mtype: string };
type Panel = { sample: string; type: string; panel: string };

function local(segs: Seg[], opts: { build?: string; events?: PatientEvent[]; timeline?: boolean; muts?: Mut[]; panels?: Panel[] } = {}) {
  const asked: string[] = [];
  return {
    asked,
    instance: { id: "a", mode: "patient-level", label: "Local", conn: { id: "a", db: "a" } },
    cohortSql: () => "SELECT 1",
    viewAggregate: async () => [],
    viewMeta: async () => [{ build: opts.build ?? "hg19" }],
    viewRows: async (label: string, _def: unknown, build: (c: string, s: string, d: string) => string) => {
      asked.push(label);
      const sql = build("SELECT '' AS pid, '' AS sid", "s1", "db");
      if (/mutation_derived/.test(sql)) return (opts.muts ?? []).map(({ st, en, ...m }) => ({ ...m, st, en }));
      if (/sample_to_gene_panel_derived/.test(sql)) return opts.panels ?? [];
      return answer(sql, segs);
    },
    ...(opts.timeline === false ? {} : {
      patientTimeline: async (patient: string) => ({ study: "s1", patient, source: { label: "Local" },
        samples: [...new Map(segs.filter((s) => s.patient === patient).map((s) => [s.sample, { id: s.sample, type: s.stype }])).values()], events: opts.events ?? [] }),
    }),
  };
}
const aggregate = () => ({ instance: { id: "agg", mode: "aggregate-only", label: "agg", conn: { id: "agg" } } });
const cohort = (samples: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(samples),
  perStudy: Object.fromEntries(Object.entries(samples).map(([st, n]) => [st, { sql: "", count: n, samples: n, mode: "" }])),
  count: 0, samples: Object.values(samples).reduce((a, b) => a + b, 0), text: "",
});
function ctx(cohorts: Record<string, EvaluatedCohort>, resolvers: Record<string, unknown>): ViewRun {
  const vNames = Object.keys(cohorts);
  return {
    doc: { study: "s1", cohorts: Object.fromEntries(vNames.map((n) => [n, { study: cohorts[n].studies[0] }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies: [...new Set(vNames.flatMap((n) => cohorts[n].studies))],
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
}
const run = (view: Partial<SegmentsView>, c: ViewRun) => runSegments({ kind: "segments", ...view } as SegmentsView, c);
const seg = (v: ViewResult) => (v as ViewResult & { segments: SegmentsResult }).segments;

// three samples of three patients; S2 is ERBB2-amplified, S3 lost there; S1 has no segment on 17 at all, and one on chromosome "MT"
const ERBB2 = geneLocus("ERBB2", "hg19")!;
const COHORT: Seg[] = [
  { sid: 10, sample: "S1", patient: "P1", stype: "Primary", chrom: "1", st: 1000, en: 200000000, m: 0.3 },
  { sid: 10, sample: "S1", patient: "P1", stype: "Primary", chrom: "MT", st: 1, en: 16000, m: 0 },
  { sid: 11, sample: "S2", patient: "P2", stype: "Primary", chrom: "1", st: 1000, en: 200000000, m: 0.01 },
  { sid: 11, sample: "S2", patient: "P2", stype: "Primary", chrom: "17", st: 30000000, en: 40000000, m: 2.1 },
  { sid: 12, sample: "S3", patient: "P3", stype: "Primary", chrom: "17", st: 1000, en: ERBB2.start + 20000, m: -0.8 },
  { sid: 12, sample: "S3", patient: "P3", stype: "Primary", chrom: "17", st: ERBB2.start + 20001, en: 81000000, m: 0.2 },
];

describe("segment colour: IGV's seg-track scale", () => {
  test("white within ±0.1, saturated red/blue at ±1.5 and beyond, linear (floored) between", () => {
    for (const v of [0, 0.1, -0.1, 0.05]) assert.equal(segmentColor(v), "rgb(255,255,255)");
    assert.equal(segmentColor(1.5), "rgb(255,0,0)");
    assert.equal(segmentColor(4), "rgb(255,0,0)");
    assert.equal(segmentColor(-1.5), "rgb(0,0,255)");
    assert.equal(segmentColor(-9), "rgb(0,0,255)");
    // igv.js: frac = (0.8 - 0.1) / 1.4 = 0.5 → floor(255 - 127.5) = 127
    assert.equal(segmentColor(0.8), "rgb(255,127,127)");
    assert.equal(segmentColor(-0.8), "rgb(127,127,255)");
    assert.equal(segmentColor(NaN), "rgb(255,255,255)");
  });
});

describe("gene loci", () => {
  test("refGene spans for both builds, case-insensitive; a symbol without an mRNA is null", () => {
    assert.deepEqual(geneLocus("erbb2", "hg19"), { gene: "ERBB2", chrom: "17", start: 37844336, end: 37884915 });
    assert.deepEqual(geneLocus("TP53", "hg38"), { gene: "TP53", chrom: "17", start: 7668401, end: 7687550 });
    assert.equal(geneLocus("NOT_A_GENE", "hg19"), null);
  });
  test("the generator's encoding decodes to what it read, and a gene on X and Y keeps X", () => {
    const ref = [
      "585\tNM_1\tchr1\t+\t100\t500\t0\t0\t1\t\t\t0\tAAA",
      "585\tNM_2\tchr1\t+\t50\t300\t0\t0\t1\t\t\t0\tAAA",
      "585\tNR_9\tchr1\t+\t1\t9000\t0\t0\t1\t\t\t0\tAAA",
      "585\tNM_3\tchrY\t+\t10\t20\t0\t0\t1\t\t\t0\tPAR",
      "585\tNM_4\tchrX\t+\t30\t40\t0\t0\t1\t\t\t0\tPAR",
      "585\tNM_5\tchr1_alt\t+\t1\t2\t0\t0\t1\t\t\t0\tALT",
      "585\tNM_6\tchr2\t+\t700\t800\t0\t0\t1\t\t\t0\tBBB",
    ].join("\n");
    const m = decodeLoci(encodeLoci(spansOf(ref)));
    assert.deepEqual(m.get("AAA"), { gene: "AAA", chrom: "1", start: 50, end: 500 });
    assert.deepEqual(m.get("PAR"), { gene: "PAR", chrom: "X", start: 30, end: 40 });
    assert.deepEqual(m.get("BBB"), { gene: "BBB", chrom: "2", start: 700, end: 800 });
    assert.equal(m.has("ALT"), false);
  });
});

describe("parseRegion", () => {
  test("a chromosome, or a stretch of one, with commas; refused otherwise", () => {
    assert.deepEqual(parseRegion("chr17", "hg19"), { chrom: "17", start: 1, end: 81195210, whole: true });
    assert.deepEqual(parseRegion("x", "hg38"), { chrom: "X", start: 1, end: 156040895, whole: true });
    assert.deepEqual(parseRegion("chr17:37,000,000-38,000,000", "hg19"), { chrom: "17", start: 37000000, end: 38000000, whole: false });
    assert.deepEqual(parseRegion("17:80,000,000-99,000,000", "hg19"), { chrom: "17", start: 80000000, end: 81195210, whole: false });
    assert.match(String(parseRegion("chr23", "hg19")), /region is a chromosome/);
    assert.match(String(parseRegion("17:5-1", "hg19")), /larger one/);
    assert.match(String(parseRegion("17:90,000,000-99,000,000", "hg19")), /past its end/);
  });
});

describe("segments SQL", () => {
  const where = { axis: SEGMENT_CHROMS };
  test("names samples, so it is a patient-level statement outside the aggregate builders", () => {
    const a = segmentSamplesRows("SELECT 1", "s1", "db", { ...where, sort: "gained", limit: 300 });
    assert.match(a, /sample_stable_id AS sample/);
    assert.match(a, /ORDER BY score DESC NULLS LAST, sid\nLIMIT 300/);
    assert.match(a, /count\(\) OVER \(\) AS segmented/);
    for (const name of ["segmentSamplesRows", "segmentRows"]) {
      assert.doesNotMatch(name, /Sql$/, name + " must not be swept as an aggregate");
      assert.equal(name in (federation as Record<string, unknown>), false);
    }
  });
  test("a zoom reads the bases inside the stretch; the segment query takes only integer ids", () => {
    const z = { axis: ["17"], range: { chrom: "17", start: 100, end: 200 } };
    assert.match(segmentSamplesRows("SELECT 1", "s1", "db", { ...z, sort: "order", limit: 5 }), /least\(en, 200\) - greatest\(st, 100\)/);
    assert.match(segmentRows("SELECT 1", "s1", "db", z, [3, 4]), /internal_id IN \(3,4\)/);
    assert.match(segmentRows("SELECT 1", "s1", "db", z, []), /internal_id IN \(-1\)/);
    assert.throws(() => segmentRows("SELECT 1", "s1", "db", z, [1.5]), /not an integer/);
    assert.match(segmentSamplesRows("SELECT 1", "x'y", "db", { ...z, sort: "order", limit: 5 }), /'x\\'y'/);
  });
});

describe("runSegments", () => {
  const one = () => ({ c: ctx({ A: cohort({ s1: 4 }) }, { s1: local(COHORT) }) });
  test("whole genome: every segmented sample in the study's order, segments on the axis, the rest counted", async () => {
    const { c } = one();
    const v = await run({ cohorts: ["A"] }, c);
    assert.equal(v.error, undefined);
    const s = seg(v);
    assert.deepEqual(s.samples.map((x) => x.sample), ["S1", "S2", "S3"]);
    assert.equal(s.segmented, 3); assert.equal(s.cohortSamples, 4); assert.equal(s.leftOut, 0); assert.equal(s.otherChrom, 1);
    assert.equal(s.chroms.length, 24);
    assert.deepEqual(s.samples[0].segs, [0, 1000, 200000000, 0.3]);
    assert.match(v.caveat!, /All 3 samples with segments are drawn/);
    assert.match(v.caveat!, /1 of the cohort's 4 samples have no segments/);
    assert.match(v.caveat!, /1 segment on chromosomes other than/);
  });
  test("a gene zoom: the refGene span ± 1 kb; sorted by the mean over it; a sample with nothing there is a grey row, said", async () => {
    const { c } = one();
    const v = await run({ cohorts: ["A"], gene: "ERBB2", sort: "gained" }, c);
    const s = seg(v);
    assert.deepEqual(s.region, { label: "ERBB2 (chr17:37,844,337-37,884,915)", chrom: "17", start: 37843337, end: 37885915, gene: { name: "ERBB2", start: 37844337, end: 37884915 } });
    assert.deepEqual(s.samples.map((x) => [x.sample, x.score]), [["S2", 2.1], ["S3", Math.round(((-0.8) * 21001 + 0.2 * (37885915 - (ERBB2.start + 20001) + 1)) / (37885915 - 37843337 + 1) * 10000) / 10000], ["S1", null]]);
    assert.equal(s.noSegment, 1);
    assert.match(v.caveat!, /1 drawn sample has no segment in this region/);
    assert.doesNotMatch(v.caveat!, /chromosome X reads low/);
    const lost = seg(await run({ cohorts: ["A"], gene: "ERBB2", sort: "lost" }, one().c));
    assert.deepEqual(lost.samples.map((x) => x.sample), ["S3", "S2", "S1"]);
  });
  test("a zoom still carries each drawn sample's whole genome, for the browser to pan; the figure and text keep to the region", async () => {
    const v = await run({ cohorts: ["A"], gene: "ERBB2" }, one().c);
    const s = seg(v);
    const s1 = s.samples.find((x) => x.sample === "S1")!;
    assert.deepEqual(s1.segs, [0, 1000, 200000000, 0.3]);
    assert.deepEqual(regionSegs(s, s1.segs), []);
    assert.equal(s.segChroms[s1.segs[0]], "1");
    assert.equal(igvLocus(s), "chr17:37843337-37885915");
    assert.equal(igvLocus(seg(await run({ cohorts: ["A"] }, one().c))), "all");
    const f = igvSegFeatures(s);
    assert.deepEqual(f[0], { chr: "chr1", start: 999, end: 200000000, value: 0.3, sample: f[0].sample });
    assert.equal(f.length, s.samples.reduce((n, x) => n + x.segs.length / 4, 0));
  });
  test("the row limit draws the first rows and names how many it left out", async () => {
    const v = await run({ cohorts: ["A"], rows: 2 }, one().c);
    const s = seg(v);
    assert.equal(s.samples.length, 2); assert.equal(s.leftOut, 1);
    assert.match(v.caveat!, /ROW LIMIT: 2 of 3 samples with segments are drawn; 1 are left out/);
    const svg = segmentsSvg(v as never, { width: 700 });
    assert.match(svg, /Row limit 2: 1 samples with segments are not drawn/);
  });
  test("one patient's samples are numbered and ordered by collection, as the patient's other views", async () => {
    const P: Seg[] = [
      { sid: 1, sample: "T-A", patient: "P", stype: "Metastasis", chrom: "1", st: 1, en: 10, m: 1 },
      { sid: 2, sample: "T-B", patient: "P", stype: "Primary", chrom: "1", st: 1, en: 10, m: -1 },
    ];
    const v = await run({ cohorts: ["A"] }, ctx({ A: cohort({ s1: 2 }) }, { s1: local(P) }));
    assert.deepEqual(seg(v).samples.map((x) => [x.sample, x.mark?.label]), [["T-B", "1"], ["T-A", "2"]]);
    assert.deepEqual(igvSegFeatures(seg(v)).map((f) => f.sample), ["1. T-B", "2. T-A"]);
    assert.match(v.caveat!, /collection order/);
    const noTl = await run({ cohorts: ["A"] }, ctx({ A: cohort({ s1: 2 }) }, { s1: local(P, { timeline: false }) }));
    assert.deepEqual(seg(noTl).samples.map((x) => x.sample), ["T-B", "T-A"]);
  });
  test("refusals name what is wrong", async () => {
    const c = one().c;
    const err = async (view: Partial<SegmentsView>, cc = c) => (await run(view, cc)).error || "";
    assert.match(await err({ cohorts: ["A"], gene: "ERBB2", region: "17" }), /not both/);
    assert.match(await err({ cohorts: ["A"], gene: "bad gene!" }), /gene symbol/);
    assert.match(await err({ cohorts: ["A"], gene: "NOPE1" }), /no RefSeq mRNA on hg19/);
    assert.match(await err({ cohorts: ["A"], region: "chr99" }), /region is a chromosome/);
    assert.match(await err({ cohorts: ["A"], region: 17 as never }), /region is text/);
    assert.match(await err({ cohorts: ["A"], rows: SEGMENTS_ROWS_MAX + 1 }), /rows .* is 1 to 2000/);
    assert.match(await err({ cohorts: ["A"], sort: "up" as never }), /sort is/);
    assert.match(await err({ cohorts: ["A", "B"] }, ctx({ A: cohort({ s1: 1 }), B: cohort({ s1: 1 }) }, { s1: local(COHORT) })), /draws one cohort's samples/);
    assert.match(await err({ cohorts: ["A"] }, ctx({ A: cohort({ s1: 1 }) }, { s1: aggregate() })), /no study here may draw/);
    assert.match(await err({ cohorts: ["A"] }, ctx({ A: cohort({ s1: 2 }) }, { s1: local([]) })), /no sample of this cohort has copy-number segments.*s1: no copy-number segments/);
    assert.match(await err({ cohorts: ["A"] }, ctx({ A: cohort({ s1: 1 }) }, { s1: local(COHORT, { build: "mm10" }) })), /no chromosome lengths for reference genome s1 \(mm10\)/);
    assert.match(await err({ cohorts: ["A"] }, ctx({ A: cohort({ s1: 1, s2: 1 }) }, { s1: local(COHORT), s2: local(COHORT, { build: "hg38" }) })), /different reference genomes/);
  });
  test("past the segment limit the figure is refused, naming it", async () => {
    const many: Seg[] = Array.from({ length: SEGMENTS_MAX + 1 }, (_, i) => ({ sid: 1, sample: "S", patient: "P", stype: "", chrom: "1", st: i * 10 + 1, en: i * 10 + 5, m: 0.5 }));
    assert.match((await run({ cohorts: ["A"] }, ctx({ A: cohort({ s1: 1 }) }, { s1: local(many) }))).error || "", /past the 250,000 one view carries — lower rows/);
  });
  test("two studies: each study's order in turn; an aggregate-only one is named as left out", async () => {
    const c = ctx({ A: cohort({ s1: 4, s2: 2 }) }, { s1: local(COHORT), s2: aggregate() });
    const v = await run({ cohorts: ["A"] }, c);
    assert.deepEqual(seg(v).excluded, [{ study: "s2", reason: "does not disclose samples" }]);
    assert.match(v.caveat!, /Left out: s2/);
  });
});

describe("segments figure and text", () => {
  test("lints clean at every card width; a gene zoom marks the gene and gives each segment a tip", async () => {
    const v = await run({ cohorts: ["A"], gene: "ERBB2" }, ctx({ A: cohort({ s1: 3 }) }, { s1: local(COHORT) }));
    for (const w of [560, 936, 1352]) {
      const svg = segmentsSvg(v as never, { width: w });
      assert.deepEqual(lintSvg(svg), [], "width " + w);
    }
    const svg = segmentsSvg(v as never, { width: 936 });
    assert.match(svg, />ERBB2</);
    assert.match(svg, /<title>S2 · chr17:30,000,000-40,000,000 · mean log2 ratio 2\.1<\/title>/);
    assert.match(svg, /Mb/);
    assert.match(svg, /no segment here/);
  });
  test("whole genome names the chromosomes; many rows drop the labels and merge same-coloured runs", async () => {
    // 1,500 samples × 3 segments: past the per-segment tips, so each colour is one path across rows
    const segs: Seg[] = Array.from({ length: 4500 }, (_, k) => { const i = Math.floor(k / 3), j = k % 3;
      return { sid: i + 1, sample: "S" + i, patient: "P" + i, stype: "", chrom: "8", st: 1 + j * 40000000, en: (j + 1) * 40000000, m: j === 1 ? 0 : i % 2 ? 1.6 : -1.6 }; });
    const v = await run({ cohorts: ["A"], rows: 1500 }, ctx({ A: cohort({ s1: 1500 }) }, { s1: local(segs) }));
    const svg = segmentsSvg(v as never, { width: 936 });
    assert.doesNotMatch(svg, />S12</);
    assert.equal((svg.match(/<path d="[^"]*" fill="rgb\(255,0,0\)"/g) || []).length, 1);
    assert.match(svg, />8</);
    assert.deepEqual(lintSvg(svg), []);
  });
  test("results text and title", async () => {
    const v = await run({ cohorts: ["A"], gene: "ERBB2", sort: "gained" }, ctx({ A: cohort({ s1: 3 }) }, { s1: local(COHORT) }));
    const out: string[] = [];
    segmentsKind.text!(v as never, { out, pFmt: String, caveatOf: () => "", noteOf: () => "", plotUnit: () => "", methodOf: () => "" });
    assert.match(out[0], /3 of 3 samples with segments drawn/);
    assert.match(out[0], /S2: \+2\.10 \(1 segment\)/);
    assert.match(out[0], /S1: no segment in the region/);
    assert.equal(segmentsKind.title!(v as never), "Copy-number segments — ERBB2 (chr17:37,844,337-37,884,915)");
    assert.equal(segmentsKind.figure!({ ...v, segments: { ...seg(v), samples: [] } } as never, {}), null);
  });
});

describe("the patient page's genomic overview (overview: true)", () => {
  // one patient: T-A has segments and mutations, T-B segments only, T-C mutations only (no segments)
  const P: Seg[] = [
    { sid: 1, sample: "T-A", patient: "P", stype: "Primary", chrom: "1", st: 1, en: 1000000, m: 0.5 },
    { sid: 1, sample: "T-A", patient: "P", stype: "Primary", chrom: "2", st: 1, en: 1000000, m: 0.05 },
    { sid: 2, sample: "T-B", patient: "P", stype: "Metastasis", chrom: "1", st: 1, en: 40000, m: -1 },
  ];
  const M: Mut[] = [
    { sid: 1, sample: "T-A", patient: "P", stype: "Primary", chrom: "17", st: 7577094, en: 7577094, gene: "TP53", change: "R282G", mtype: "Missense_Mutation" },
    { sid: 3, sample: "T-C", patient: "P", stype: "Recurrence", chrom: "5", st: 1295228, en: 1295228, gene: "TERT", change: "Promoter", mtype: "5'Flank" },
  ];
  const PN: Panel[] = [
    { sample: "T-A", type: "MUTATION_EXTENDED", panel: "IMPACT410" }, { sample: "T-A", type: "COPY_NUMBER_ALTERATION", panel: "WES" },
    { sample: "T-C", type: "MUTATION_EXTENDED", panel: "IMPACT341" },
  ];
  const c = (muts = M, segs = P) => ctx({ A: cohort({ s1: 3 }) }, { s1: local(segs, { muts, panels: PN, timeline: false }) });

  test("mutations ride along in row order; a sample with mutations but no segments gets a row; panels per sample", async () => {
    const v = await run({ cohorts: ["A"], overview: true }, c());
    const s = seg(v);
    assert.deepEqual(s.samples.map((x) => [x.sample, x.segs.length / 4]), [["T-A", 2], ["T-B", 1], ["T-C", 0]]);
    assert.deepEqual(s.mutations, [
      { s: 0, chrom: "17", start: 7577094, end: 7577094, gene: "TP53", change: "R282G", type: "Missense_Mutation" },
      { s: 2, chrom: "5", start: 1295228, end: 1295228, gene: "TERT", change: "Promoter", type: "5'Flank" }]);
    assert.deepEqual(s.samples.map((x) => x.panels), [{ mutation: "IMPACT410", cna: "WES" }, {}, { mutation: "IMPACT341" }]);
    assert.equal(s.noSegment, 1);
    assert.match(v.caveat!, /each sample's 2 called mutations/);
    assert.equal(v.method!.steps.at(-1)!.title, "Read the samples' mutations and gene panels");
    // without overview: no mutations and no panels asked for
    const plain = seg(await run({ cohorts: ["A"] }, c()));
    assert.equal(plain.mutations, undefined); assert.equal(plain.samples[0].panels, undefined);
  });
  test("mutations alone are enough; neither is refused, naming both; a bad flag and too many mutations are refused", async () => {
    const mutOnly = await run({ cohorts: ["A"], overview: true }, c(M, []));
    assert.equal(seg(mutOnly).samples.length, 2);
    assert.equal(seg(mutOnly).excluded, undefined, "a study drawn by its mutations is not named as left out");
    assert.match((await run({ cohorts: ["A"], overview: true }, c([], []))).error || "", /has copy-number segments or mutations.*genomic overview/);
    assert.match((await run({ cohorts: ["A"], overview: "yes" as never }, c())).error || "", /overview is true/);
    const many = Array.from({ length: OVERVIEW_MUTATIONS_MAX + 1 }, () => M[0]);
    assert.match((await run({ cohorts: ["A"], overview: true }, c(many))).error || "", /past the 50,000 one view carries/);
  });
  test("the SQL: called mutations only, the cohort's samples; panels for mutations and copy number", () => {
    const m = overviewMutationRows("SELECT 1", "s1", "db");
    assert.match(m, /molecularProfileId NOT LIKE '%uncalled%'/);
    assert.match(m, /JOIN samp ON samp\.sample = m\.sampleId/);
    assert.match(m, /multiIf\(m\.chr IN/);
    assert.match(overviewPanelRows("SELECT 1", "s1", "db"), /alteration_type IN \('MUTATION_EXTENDED', 'COPY_NUMBER_ALTERATION'\)/);
  });
  test("IGV tracks as the portal builds them: heights, samples, features, popups", async () => {
    const s = seg(await run({ cohorts: ["A"], overview: true }, c()));
    assert.deepEqual([overviewTrackHeight(1), overviewTrackHeight(4), overviewTrackHeight(100)], [25, 4 * OVERVIEW_ROW, 600]);
    assert.deepEqual(trackSamples(s, "cna"), ["T-A", "T-B"]);
    assert.deepEqual(trackSamples(s, "mut"), ["T-A", "T-C"]);
    const seg0 = overviewSegFeatures(s)[0];
    assert.deepEqual({ ...seg0, popupData: undefined }, { chr: "chr1", start: 0, end: 1000000, value: 0.5, sample: "T-A", popupData: undefined });
    assert.deepEqual(seg0.popupData(), [{ name: "Sample", value: "T-A" }, { name: "Mean CN log2 value", value: 0.5 }, { name: "Location", value: "chr1:1-1,000,000" }]);
    const mut = overviewMutFeatures(s, (t) => t === "Missense_Mutation" ? "green" : "pink");
    assert.deepEqual(mut.map((f) => [f.sample, f.chr, f.start, f.end, f.color]), [["T-A", "chr17", 7577093, 7577094, "green"], ["T-C", "chr5", 1295227, 1295228, "pink"]]);
    assert.deepEqual(mut[0].popupData(), [{ name: "Sample", value: "T-A" }, { name: "Gene", value: "TP53" }, { name: "Protein Change", value: "R282G" },
      { name: "Location", value: "chr17:7,577,094-7,577,094" }]);
    assert.deepEqual(overviewMutFeatures({ samples: s.samples }, () => ""), []);
  });
  test("CNA altered share: segments of 50 kb or more at |mean| ≥ 0.2, over the measured genome", () => {
    assert.equal(cnaAlteredPct([]), null);
    // 1 Mb at 0.5 (altered), 1 Mb at 0.05 (not), 40 kb at -1 (too short)
    const pct = cnaAlteredPct([0, 1, 1000001, 0.5, 1, 1, 1000001, 0.05, 0, 1, 40001, -1])!;
    assert.equal(Math.round(pct * 1000) / 1000, Math.round(100 * 1000000 / 2040000 * 1000) / 1000);
  });
  test("gene panel badges: P1, P2 … in name order across both tracks, W for no panel; none for an all-whole-exome track", () => {
    const icons = panelIcons([
      { sample: "a", panels: { mutation: "IMPACT468", cna: "WES" } },
      { sample: "b", panels: { mutation: "IMPACT341" } },
      { sample: "c", panels: {} },
    ]);
    assert.deepEqual([...icons.mut].map(([id, i]) => [id, i.label, i.panel]), [["a", "P2", "IMPACT468"], ["b", "P1", "IMPACT341"], ["c", "W", null]]);
    assert.equal(icons.cna.size, 0);
    assert.equal(icons.show, true);
    assert.equal(panelIcons([{ sample: "a", panels: { mutation: "WES", cna: "WGS" } }, { sample: "b" }]).show, false);
  });
});

test("igv: with several studies a row is named by study and sample, so the same id in two studies stays two rows", () => {
  const smp = (study: string, sample: string) => ({ study, patient: "P", sample, segs: [0, 1, 10, 0.5] });
  const one = igvSegFeatures({ segChroms: ["1"], samples: [smp("a", "S1")] } as never);
  assert.deepEqual(one.map((f) => f.sample), ["S1"]);
  const two = igvSegFeatures({ segChroms: ["1"], samples: [smp("a", "S1"), smp("b", "S1")] } as never);
  assert.deepEqual(two.map((f) => f.sample), ["a:S1", "b:S1"]);
});
