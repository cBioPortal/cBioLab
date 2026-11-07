// The oncoprint engine end to end (lib/oncoprint.ts buildContract, studyOncoprintInputs), over a
// stand-in warehouse (setChTransport) holding two tiny studies. What the tests hold it to: a
// patient column is built only from its samples in the cohort, a column lands in the first group
// that holds it, federated columns are study-qualified and never deduplicated, a frequency is over
// the columns profiled for that gene, and every profile, assay, overlay or sort the data cannot
// answer is refused naming what is available (CLAUDE.md invariants 1, 3, 7).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "cbio";
process.env.CLICKHOUSE_USER = "u";
process.env.CLICKHOUSE_PASSWORD = "p";
process.env.STUDY_ID = "s1";
process.env.ONCOKB_PIN = "v-test";
for (const k of ["CLICKHOUSE2_URL", "FEDERATION_PEERS", "CH_RUN_CACHE", "AGGREGATE_ONLY_INSTANCES", "AGGREGATE_ONLY_STUDIES", "CBIOLAB_LOCAL"]) delete process.env[k];

const { setChTransport } = await import("../lib/ch.ts");
const op = await import("../lib/oncoprint.ts");
const { buildContract, studyOncoprintInputs, checkStudyInputs, specToQueries, cohortRowsSql, normalizeSpec,
  clinicalSql, vafSql, heatmapSql, assayHeatmapSql, genomicEventsSql, PIDS_SQL, PEER_STUDIES } = op;
const { PRIMARY } = await import("../lib/ch.ts");

type Row = Record<string, unknown>;
interface Sent { query: string; externals: Record<string, string> }
let sent: Sent[] = [];

// ---- the stand-in warehouse: two studies -------------------------------------------------------
// s1: P1 (samples S1a, S1b), P2 (S2), P3 (S3). s2: P1 (T1), P9 (T9).
const PATIENTS: Record<string, [string, string][]> = {
  s1: [["P1", "S1a"], ["P1", "S1b"], ["P2", "S2"], ["P3", "S3"]],
  s2: [["P1", "T1"], ["P9", "T9"]],
};
// a cohort clause's value picks which (pid, sid) rows it holds
const COHORT_ROWS: Record<string, [string, string][]> = {
  F: [["P1", "S1a"], ["P2", "S2"]],
  M: [["P2", "S2"], ["P3", "S3"]],
  NOBODY: [],
  // more column samples than are shipped as an external table: 100,001 patients of 2 samples each
  BIG: Array.from({ length: 200_002 }, (_, i): [string, string] => ["Q" + (i >> 1), "X" + i]),
};
const studyOf = (q: string) => /'(s[12])'/.exec(q)?.[1] ?? /-- study (s[12])/.exec(q)?.[1] ?? "s1";
const cohortRows = (q: string): [string, string][] => {
  const v = /attribute_value[^']*'([A-Z]+)'/.exec(q)?.[1] ?? /-- cohort ([A-Z]+)/.exec(q)?.[1];
  return v && COHORT_ROWS[v] ? COHORT_ROWS[v] : PATIENTS[studyOf(q)];
};
function warehouse(q: string): Row[] {
  const s = studyOf(q);
  if (/AS id, name/.test(q)) return [{ id: "s1", name: "Study one" }, { id: "s2", name: "Study two" }];
  if (/genetic_alteration_type = 'GENERIC_ASSAY'/.test(q))
    return s === "s1" ? [{ pt: "sig", datatype: "LIMIT-VALUE", pl: 0 }, { pt: "arm", datatype: "CATEGORICAL", pl: 0 }, { pt: "plsig", datatype: "LIMIT-VALUE", pl: 1 }] : [];
  if (/gp\.genetic_alteration_type AS type/.test(q))
    return s === "s1" ? [{ pt: "mrna", type: "MRNA_EXPRESSION" }, { pt: "rppa", type: "PROTEIN_LEVEL" }, { pt: "mutations", type: "MUTATION_EXTENDED" }]
      : [{ pt: "mrna", type: "MRNA_EXPRESSION" }];
  if (/tumorAltCount > 0 LIMIT 1/.test(q)) return s === "s1" ? [{ x: 1 }] : [];
  const unitSample = /SELECT DISTINCT sid AS pid/.test(q);
  if (/^SELECT DISTINCT (sid AS pid|pid), sid FROM/.test(q)) return cohortRows(q).map(([p, sid]) => ({ pid: unitSample ? sid : p, sid }));
  if (/^SELECT DISTINCT (sid AS pid|pid) FROM/.test(q)) return [...new Set(cohortRows(q).map(([p, sid]) => unitSample ? sid : p))].map((pid) => ({ pid }));
  if (/genomic_event_derived/.test(q))
    return s === "s1" ? [{ pid: "P1", gene: "TP53", vt: "mutation", mt: "Missense_Mutation", mv: "R175H", cna: "" }, { pid: "P2", gene: "KRAS", vt: "cna", mt: "", mv: "", cna: "2" }]
      : [{ pid: "P9", gene: "TP53", vt: "mutation", mt: "Nonsense_Mutation", mv: "R213*", cna: "" }];
  if (/AS mask/.test(q) && /gene_panel_to_gene_derived/.test(q))
    return s === "s1" ? [{ pid: "P1", mask: 3 }, { pid: "P2", mask: 3 }, { pid: "P3", mask: 1 }] : [{ pid: "P1", mask: 3 }, { pid: "P9", mask: 3 }];
  if (/AS samples/.test(q)) return PATIENTS[s].map(([p]) => p).filter((p, i, a) => a.indexOf(p) === i).map((pid) => ({ pid, samples: pid === "P1" && s === "s1" ? 2 : 1, mask: pid === "P1" ? 15 : 7 }));
  if (/attribute_name AS k/.test(q)) return [{ pid: "P1", k: "SEX", v: "Female" }, { pid: "P2", k: "SEX", v: "Male" }, { pid: "P1", k: "UNASKED", v: "x" }];
  if (/generic_assay_data_derived g/.test(q)) return [{ pid: "P1", gene: "SBS1", v: 0.4 }, { pid: "P2", gene: "SBS1", v: 0.1 }];
  if (/genetic_alteration_derived ga/.test(q)) return [{ pid: "P1", gene: "TP53", v: 2.5 }, { pid: "P2", gene: "TP53", v: -2.5 }, { pid: "P3", gene: "TP53", v: 0.2 }, { pid: "P2", gene: "KRAS", v: 1 }];
  if (/max\(tumorAltCount/.test(q)) return [{ pid: "P1", gene: "TP53", v: 0.42 }];
  if (/variant_annotation/.test(q)) return [{ t: "MUTATION", gene: "TP53", alteration: "R175H", is_driver: 1 }];
  if (/sync_run/.test(q)) return [{ study: "s1" }];
  return [];
}
setChTransport(async ({ query, format, externals }) => {
  const body = query.replace(/\nFORMAT \w+$/, "");
  const ext: Record<string, string> = {};
  for (const e of externals) ext[e.name] = await e.blob.text();
  sent.push({ query: body, externals: ext });
  const rows = warehouse(body);
  return format === "JSONCompact"
    ? JSON.stringify({ meta: Object.keys(rows[0] ?? {}).map((name) => ({ name })), data: rows.map((r) => Object.values(r)) })
    : JSON.stringify({ meta: [], data: rows, rows: rows.length });
});
after(() => setChTransport(null));
beforeEach(() => { sent = []; });

const OFF = { annotate: "none" } as const;
const spec = (x: Record<string, unknown>) => ({ study: "s1", genes: ["TP53", "KRAS"], display: OFF, ...x }) as never;
const female = { all: [{ kind: "clinical", attribute: "SEX", op: "=", value: "F" }] };
const male = { all: [{ kind: "clinical", attribute: "SEX", op: "=", value: "M" }] };
const track = (c: { tracks: { label: string }[] }, label: string) => c.tracks.find((t) => t.label === label) as Record<string, any>;
const queriesLike = (re: RegExp) => sent.filter((s) => re.test(s.query));

describe("columns", () => {
  test("no cohort: every patient of the study, each gene's frequency over the columns profiled for it", async () => {
    const c = await buildContract(spec({}));
    assert.deepEqual([...c.columns].sort(), ["P1", "P2", "P3"]);
    assert.equal(c.stats.nColumns, 3);
    const tp53 = track(c, "TP53"), kras = track(c, "KRAS");
    assert.equal(tp53.profiled, 3);
    assert.equal(tp53.altered, 1);
    assert.equal(kras.profiled, 2, "P3's panel does not cover KRAS: not profiled, not wild-type");
    assert.equal(kras.altered, 1);
    assert.equal(kras.freqPct, 50);
    assert.equal(queriesLike(/_op_samples_/).length, 0, "no cohort: every sample counts, nothing to narrow");
  });

  test("a cohort: its patients, and each data query reads only their samples in the cohort, shipped once as a table", async () => {
    const c = await buildContract(spec({ cohort: { dsl: female } }));
    assert.deepEqual(c.columns, ["P1", "P2"]);
    const ev = queriesLike(/genomic_event_derived/)[0];
    assert.match(ev.query, /IN \(SELECT sid FROM _op_samples_s1\)/);
    assert.deepEqual(ev.externals._op_samples_s1.trim().split("\n").sort(), ["S1a", "S2"], "P1's other sample S1b is not in the cohort");
  });

  test("past the most column samples shipped as a table, the data queries read the cohort's definition instead", async () => {
    const c = await buildContract(spec({ cohort: { dsl: { all: [{ kind: "clinical", attribute: "X", op: "=", value: "BIG" }] } } }));
    assert.equal(c.columns.length, 100_001);
    const ev = queriesLike(/genomic_event_derived/)[0];
    assert.equal(Object.keys(ev.externals).length, 0, "nothing shipped");
    assert.match(ev.query, /IN \(SELECT sid FROM \(\n\(SELECT replaceOne/, "the cohort's own rows narrow the samples");
  });

  test("an empty cohort is refused rather than drawn as an empty figure", async () => {
    await assert.rejects(buildContract(spec({ cohort: { dsl: { all: [{ kind: "clinical", attribute: "X", op: "=", value: "NOBODY" }] } } })), /cohort is empty/);
  });

  test("groups: a column is drawn in the first group that holds it, and each gene row breaks down by group", async () => {
    const c = await buildContract(spec({ layout: { groupBy: { kind: "cohorts", groups: [{ name: "Women", dsl: female }, { dsl: male }] } } }));
    assert.deepEqual(c.groups.map((g) => [g.name, g.count]), [["Women", 2], ["group 2", 1]]);
    assert.deepEqual([...c.columns].sort(), ["P1", "P2", "P3"]);
    assert.ok(c.columns.indexOf("P3") > Math.max(c.columns.indexOf("P1"), c.columns.indexOf("P2")), "P2 stays in the first group");
    assert.equal(track(c, "KRAS").byGroup.length, 2);
  });

  test("sample columns: one per sample, and nothing is narrowed (a sample column is its sample already)", async () => {
    const c = await buildContract(spec({ unit: "sample", cohort: { dsl: female } }));
    assert.equal(c.unit, "sample");
    assert.deepEqual(c.columns.slice().sort(), ["S1a", "S2"]);
    assert.equal(queriesLike(/_op_samples_/).length, 0);
  });

  test("a group carrying pre-compiled per-study SQL is read study by study, in study order, ids qualified", async () => {
    const dsl = { [PIDS_SQL]: { s1: "SELECT 'x' -- study s1 -- cohort F", s2: "SELECT 'y' -- study s2" } };
    const c = await buildContract(spec({ studies: ["s1", "s2"], layout: { groupBy: { kind: "cohorts", groups: [{ name: "g", dsl }] } } }));
    assert.deepEqual(c.columns.slice().sort(), ["s1_P1", "s1_P2", "s2_P1", "s2_P9"]);
    const cols = queriesLike(/^SELECT DISTINCT pid, sid FROM/);
    assert.ok(cols.some((x) => x.query.includes("-- study s1 -- cohort F")) && cols.some((x) => x.query.includes("-- study s2")));
  });

  test("several studies with no groups: every patient of each, qualified, overlap not deduplicated", async () => {
    const c = await buildContract(spec({ studies: ["s1", "s2"] }));
    assert.deepEqual(c.columns.slice().sort(), ["s1_P1", "s1_P2", "s1_P3", "s2_P1", "s2_P9"]);
    assert.equal(c.groups[0].name, "all patients");
    assert.equal(track(c, "TP53").altered, 2, "each study's TP53 calls count");
  });

  test("several studies and a cohort but no groups is refused", async () => {
    await assert.rejects(buildContract(spec({ studies: ["s1", "s2"], cohort: { dsl: female } })), /multi-study oncoprint with a cohort requires cohort groups/);
  });
});

describe("rows beside the gene tracks", () => {
  test("clinical tracks take the values of the attributes asked for, and nothing else", async () => {
    const c = await buildContract(spec({ clinical: ["SEX"] }));
    const sex = track(c, "SEX");
    assert.ok(sex, "a SEX track");
    assert.deepEqual([...sex.categories].sort(), ["Female", "Male"]);
    assert.equal(track(c, "UNASKED"), undefined);
  });

  test("a gene-profile heatmap reads the profile's values per column and gene", async () => {
    const c = await buildContract(spec({ heatmap: [{ profileType: "mrna", genes: ["TP53"] }] }));
    const h = c.tracks.find((t) => t.kind === "heatmap" && t.profileType === "mrna") as Record<string, any>;
    assert.ok(h);
    assert.equal(h.cells.filter((v: number) => v >= 0).length, 3, "every column has a value");
    assert.match(queriesLike(/genetic_alteration_derived ga/)[0].query, /ga\.profile_type = 'mrna'/);
  });

  test("a profile the study lacks is refused, naming its profiles, VAF, and its numeric assays", async () => {
    await assert.rejects(buildContract(spec({ heatmap: [{ profileType: "methylation" }] })),
      /heatmap: profile 'methylation' not in s1 \(available: mrna, rppa, VAF, sig \(generic assay: name its entities\), plsig \(generic assay/);
  });

  test("VAF: drawn from allele counts where loaded; refused for a study without them", async () => {
    const c = await buildContract(spec({ heatmap: [{ profileType: "VAF", genes: ["TP53"] }] }));
    assert.ok(queriesLike(/max\(tumorAltCount/).length === 1);
    assert.ok(c.tracks.some((t) => t.kind === "heatmap"));
    await assert.rejects(buildContract(spec({ study: "s2", heatmap: [{ profileType: "vaf" }] })), /'VAF' needs mutation allele counts, which s2 did not load/);
  });

  test("a numeric generic assay draws its named entities", async () => {
    const c = await buildContract(spec({ heatmap: [{ profileType: "sig", entities: ["SBS1"] }] }));
    assert.ok(c.tracks.some((t) => t.kind === "heatmap" && t.profileType === "sig"));
    assert.match(queriesLike(/generic_assay_data_derived g/)[0].query, /g\.entity_stable_id IN \('SBS1'\)/);
  });

  test("generic assays refused: genes instead of entities, a categorical one, a federation reference, entities of a gene profile", async () => {
    await assert.rejects(buildContract(spec({ heatmap: [{ profileType: "sig" }] })), /'sig' is a generic assay; name the entities to draw/);
    await assert.rejects(buildContract(spec({ heatmap: [{ profileType: "arm", entities: ["1p"] }] })), /'arm' is categorical; a heatmap track draws numbers/);
    await assert.rejects(buildContract(spec({ heatmap: [{ profileType: "sig", entities: ["SBS1"], reference: "federation" }] })), /federation reference z-scores a gene's values/);
    await assert.rejects(buildContract(spec({ heatmap: [{ profileType: "mrna", entities: ["SBS1"] }] })), /entities name a generic assay's tracks; 'mrna' is not a generic-assay profile of s1/);
  });

  test("overlays threshold a profile into the gene cells; a missing profile is refused naming what exists", async () => {
    const c = await buildContract(spec({ overlays: [{ kind: "mrna", profileType: "mrna" }] }));
    assert.equal(c.columns.length, 3);
    assert.ok(queriesLike(/genetic_alteration_derived ga/).length >= 1);
    assert.ok(c.tracks.some((t) => (t as { profiledFor?: string }).profiledFor === "MRNA_EXPRESSION"), "the overlay's type gets a Profiled-for row");
    await assert.rejects(buildContract(spec({ overlays: [{ kind: "protein", profileType: "nope" }] })),
      /overlay: profile 'nope' not in s1 \(available: mrna, rppa\)/);
  });

  test("derived-event rows: the cohort's patients, single-study and patient columns only", async () => {
    const c = await buildContract(spec({ derivedEvents: [{ label: "women", expression: female }] }));
    const d = c.tracks.find((t) => t.kind === "derivedEvent") as Record<string, any>;
    assert.ok(d, "a derived row");
    assert.equal(d.cells.filter((v: number) => v > 0).length, 2);
    await assert.rejects(buildContract(spec({ studies: ["s1", "s2"], derivedEvents: [{ label: "w", expression: female }] })), /derived-event tracks are single-study/);
    await assert.rejects(buildContract(spec({ unit: "sample", derivedEvents: [{ label: "w", expression: female }] })), /cohort rows are patient-level/);
  });
});

describe("sort by cluster", () => {
  test("needs its profile as a heatmap on the figure, naming the ones it has", async () => {
    await assert.rejects(buildContract(spec({ sort: ["cluster:mrna"] })), /cluster needs 'mrna' as a heatmap profile on this oncoprint \(it has none\)/);
    await assert.rejects(buildContract(spec({ sort: ["cluster:mrna"], heatmap: [{ profileType: "rppa" }] })), /\(it has rppa\)/);
  });
  test("orders the columns by the profile's values, computed once in the contract", async () => {
    const c = await buildContract(spec({ sort: ["cluster:mrna"], heatmap: [{ profileType: "mrna", genes: ["TP53", "KRAS"] }] }));
    assert.equal(c.columns.length, 3);
    assert.ok(c.conventions.sort.some((s) => /cluster/.test(s)), c.conventions.sort.join());
  });
});

describe("driver annotation and provenance", () => {
  test("the pinned OncoKB store calls the drivers, and the contract says which release", async () => {
    const c = await buildContract(spec({ display: {} }));
    assert.match(c.conventions.annotation, /OncoKB v-test \(pinned\)/);
    assert.equal(track(c, "TP53").driverAltered, 1);
  });
  test("asked for provenance, the contract carries every query it ran, each with its study", async () => {
    const log: { label: string; sql: string; study?: string }[] = [];
    const c = await buildContract(spec({ clinical: ["SEX"] }), { log, provenance: true });
    const labels = c.queries!.map((q) => q.label);
    for (const l of ["oncoprint:columns", "oncoprint:alterations", "oncoprint:coverage", "oncoprint:profiledTypes", "oncoprint:clinicalTracks"]) assert.ok(labels.includes(l), l);
    assert.ok(c.queries!.every((q) => q.study === "s1"));
    assert.equal(typeof c.stats.queryMs, "number");
  });
});

describe("one study's share, as a federation peer reads it", () => {
  const req = (x: Record<string, unknown> = {}) => ({ groups: null, genes: ["TP53", "KRAS"], clinical: [], heatmap: [], overlays: [], unit: "patient" as const, lineGap: 90, ...x });

  test("no groups: every column, and the rows the contract is assembled from", async () => {
    const r = await studyOncoprintInputs("s1", PRIMARY, req({ clinical: ["SEX"] }), null);
    assert.deepEqual(r.genes, ["TP53", "KRAS"]);
    assert.deepEqual(r.groups, [["P1", "P2", "P3"]]);
    assert.equal(r.events.length, 2);
    assert.equal(r.coverage.length, 3);
    assert.equal(r.clinical.length, 3);
    assert.deepEqual(r.profileTypes.sort(), ["mrna", "rppa"]);
    assert.deepEqual(r.assays.sort(), ["plsig", "sig"], "only numeric assays: a categorical one cannot be a track");
    assert.ok(r.queries!.some((q) => q.label === "oncoprint:alterations" && typeof q.ms === "number"));
  });

  test("groups: a group the study is not in is empty, and a column lands in the first group holding it", async () => {
    const r = await studyOncoprintInputs("s1", PRIMARY, req({ groups: [female, false, male] }), null);
    assert.deepEqual(r.groups, [["P1", "P2"], [], ["P3"]]);
    assert.match(r.queries!.find((q) => q.label === "oncoprint:alterations")!.sql, /_op_samples_s1/);
  });

  test("heatmaps: an assay's values only when entities name a numeric one; a gene profile's or VAF's when available", async () => {
    const r = await studyOncoprintInputs("s1", PRIMARY, req({ heatmap: [
      { profileType: "sig", entities: ["SBS1"] }, { profileType: "arm", entities: ["1p"] }, { profileType: "mrna" },
      { profileType: "VAF" }] }), null);
    assert.deepEqual(r.heatmap.map((h) => [h.assay?.datatype ?? null, h.available, h.values.length]),
      [["LIMIT-VALUE", false, 2], ["CATEGORICAL", false, 0], [null, true, 4], [null, true, 1]]);
    const more = await studyOncoprintInputs("s2", PRIMARY, req({ heatmap: [{ profileType: "nope" }, { profileType: "mrna", entities: ["SBS1"] }, { profileType: "vaf" }] }), null);
    assert.deepEqual(more.heatmap.map((h) => [h.assay, h.available, h.values.length]), [[null, false, 0], [null, true, 0], [null, false, 0]],
      "a profile it lacks, a gene profile named by entities, VAF without allele counts: no values");
  });

  test("overlays: values where the study has the profile", async () => {
    const r = await studyOncoprintInputs("s2", PRIMARY, req({ overlays: [{ kind: "mrna", profileType: "mrna" }, { kind: "protein", profileType: "rppa" }] }), null);
    assert.deepEqual(r.overlays.map((o) => o.available), [true, false]);
    assert.deepEqual(r.overlays[1].values, []);
  });
});

describe("checking a peer's share", () => {
  const ok = { genes: ["TP53"], groups: [["P1"]], events: [], coverage: [["P1", 1]], facts: [["P1", 1, 7]], clinical: [],
    heatmap: [{ assay: { datatype: "LIMIT-VALUE", patientLevel: true }, available: "yes", values: [["P1", "SBS1", 0.4]] }, { assay: null, values: [] }],
    overlays: [{ available: true, values: [] }], profileTypes: ["mrna"], assays: [], queries: [{ label: "x", sql: "SELECT 1" }] };

  test("a well-formed share is read field by field, flags only when exactly true, and its SQL is not kept", () => {
    const r = checkStudyInputs(ok, 1);
    assert.deepEqual(r.heatmap, [{ assay: { datatype: "LIMIT-VALUE", patientLevel: true }, available: false, values: [["P1", "SBS1", 0.4]] }, { assay: null, available: false, values: [] }]);
    assert.deepEqual(r.overlays, [{ available: true, values: [] }]);
    assert.equal("queries" in r, false);
  });

  test("anything malformed is refused, naming the part", () => {
    assert.throws(() => checkStudyInputs(null, 1), /oncoprint rows this instance cannot read/);
    assert.throws(() => checkStudyInputs({ ...ok, heatmap: "x" }, 1), /heatmap tracks/);
    assert.throws(() => checkStudyInputs({ ...ok, heatmap: [{ values: [["P1", "g"]] }] }, 1), /heatmap values/);
    assert.throws(() => checkStudyInputs({ ...ok, overlays: null }, 1), /overlays/);
    assert.throws(() => checkStudyInputs({ ...ok, overlays: [{ values: [[1, 2, 3]] }] }, 1), /overlay values/);
    assert.throws(() => checkStudyInputs({ ...ok, genes: [1] }, 1), /genes/);
    assert.throws(() => checkStudyInputs({ ...ok, profileTypes: "mrna" }, 1), /profile types/);
    assert.throws(() => checkStudyInputs({ ...ok, groups: [["x".repeat(201)]] }, 1), /column ids/);
  });
});

describe("the SQL a spec compiles to, for provenance", () => {
  test("no cohort, a cohort, and groups: the column queries are labelled for what they read", () => {
    assert.equal(specToQueries(spec({})).queries[0].label, "all study patients");
    const c = specToQueries(spec({ cohort: { dsl: female }, unit: "sample", clinical: ["SEX"] }));
    assert.equal(c.queries[0].label, "cohort samples");
    assert.ok(c.queries.some((q) => q.label === "clinical attribute tracks"));
    assert.doesNotMatch(c.queries.find((q) => /genomic events/.test(q.label))!.sql, /SELECT sid FROM/, "sample columns are not narrowed");
    const g = specToQueries(spec({ layout: { groupBy: { kind: "cohorts", groups: [{ name: "W", dsl: female }, { dsl: male }] } },
      derivedEvents: [{ expression: male }] }));
    assert.deepEqual(g.queries.slice(0, 2).map((q) => q.label), ["column group “W” — cohort patients", "column group “group” — cohort patients"]);
    assert.match(g.queries.find((q) => /genomic events/.test(q.label))!.sql, /WHERE pid NOT IN/, "patients of the second group not already in the first");
    assert.ok(g.queries.some((q) => q.label === "derived-event track “derived event” — cohort-DSL patients"));
  });
  test("a study listed alone in `studies` is the study drawn, its name cleaned", () => {
    assert.match(specToQueries({ studies: ["s2'; x"], genes: ["TP53"] } as never).queries[0].sql, /'s2x'/);
  });
});

describe("SQL builders", () => {
  test("cohortRowsSql: pre-compiled SQL verbatim, a v1 timeline expression as every sample of its patients", () => {
    assert.equal(cohortRowsSql({ [PIDS_SQL]: "PRECOMPILED" } as never), "PRECOMPILED");
    const v1 = cohortRowsSql({ a: { eventType: "TREATMENT" }, rel: { type: "NONE" } } as never, "s1", "cbio");
    assert.match(v1, /AND replaceOne\(patient_unique_id, 's1_', ''\) IN \(SELECT pid FROM \(/);
    assert.equal(typeof PEER_STUDIES, "symbol");
  });
  test("clinicalSql: sample columns broadcast a patient's value to each sample, a sample's own value winning", () => {
    const sql = clinicalSql(["STAGE"], "s1", "cbio", "sample");
    assert.match(sql, /JOIN cbio\.sample_derived sd ON sd\.patient_unique_id = cd\.patient_unique_id/);
    assert.match(sql, /argMax\(cd\.attribute_value, cd\.type = 'sample'\)/);
    assert.match(clinicalSql(["STAGE"], "s1", "cbio", "patient", "SELECT sid FROM t"), /type = 'patient' OR replaceOne\(sample_unique_id, 's1_', ''\) IN \(SELECT sid FROM t\)/);
  });
  test("VAF and heatmap SQL per unit, narrowed to the column samples when given", () => {
    assert.match(vafSql(["TP53"], "s1", "cbio", "sample", "SELECT sid FROM t"), /^SELECT sampleId AS pid[\s\S]*AND sampleId IN \(SELECT sid FROM t\)/);
    assert.match(vafSql(["TP53"], "s1", "cbio"), /^SELECT patientId AS pid/);
    const h = heatmapSql("mrna", ["TP53"], "s1", "cbio", "sample");
    assert.doesNotMatch(h, /sample_derived/, "sample columns need no join to patients");
    assert.match(heatmapSql("mrna", ["TP53"], "s1", "cbio", "patient", "SELECT sid FROM t"), /replaceOne\(ga\.sample_unique_id, 's1_', ''\) IN \(SELECT sid FROM t\)/);
    assert.doesNotMatch(assayHeatmapSql("p", ["e"], "s1", "cbio", "patient", true, "SELECT sid FROM t"), /SELECT sid FROM t/, "a patient-level row has no sample to test");
    assert.match(assayHeatmapSql("p", ["e"], "s1", "cbio", "patient", false, "SELECT sid FROM t"), /SELECT sid FROM t/);
    assert.match(genomicEventsSql(["TP53"], "s1", "cbio", "sample"), /mutation_status != 'UNCALLED'/);
  });
  test("normalizeSpec: defaults and limits", () => {
    const n = normalizeSpec({ genes: ["tp53"], conventions: { lineGap: 30 }, unit: "sample",
      heatmap: [{ profileType: "" }, { profileType: "mrna", reference: "federation", genes: ["kras", "bad gene"] }],
      overlays: [{ kind: "protein", profileType: "rppa", threshold: 1.5 }, { profileType: "mrna", threshold: -1 }, { profileType: "x" }] } as never);
    assert.equal(n.lineGap, 30);
    assert.equal(n.unit, "sample");
    assert.deepEqual(n.heatmap, [{ profileType: "mrna", reference: "federation", assay: false, genes: ["KRAS"] }]);
    assert.deepEqual(n.overlays, [{ kind: "protein", profileType: "rppa", threshold: 1.5 }, { kind: "mrna", profileType: "mrna", threshold: 2 }], "at most 2; a threshold that is not positive is the ±2 rule");
    assert.equal(normalizeSpec({ genes: ["TP53"] } as never).lineGap, 90);
    assert.throws(() => normalizeSpec({ genes: [] } as never), /at least one valid gene symbol required/);
  });
});
