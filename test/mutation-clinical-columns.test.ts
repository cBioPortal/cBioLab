// MUT-COL-36 (docs/legacy-spec/05-mutations.md): the Mutations table's clinical-attribute columns.
// The portal (cbioportal-frontend cd8c6df, ResultsViewMutationTable generateColumns, RVPS
// mutationsTabClinicalAttributes) adds one hidden column per attribute of the queried studies but
// CANCER_TYPE_DETAILED and MUTATION_COUNT, each attribute once (the first entry wins), named by its
// display name; a sample attribute reads the row's sample, a patient attribute the row's patient.
// cBioLab also leaves out CANCER_TYPE (the Cancer Type column, cancerTypeAll, is that attribute) and
// any attribute whose id is already a column id; the hotspots view's `table` may name these columns.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { CLINICAL_SKIP, CLIN_PATIENT, CLIN_SAMPLE, clinicalColumns, clinicalQueryColumn, clinicalValue, type ClinicalColumn } from "../lib/mutation-clinical.ts";
import { MUTATION_COLUMNS, MUTATION_DEFAULT_COLUMNS } from "../lib/mutation-table.ts";
import { runMutations } from "../lib/views/mutations/run.ts";
import { runHotspots } from "../lib/views/hotspots/run.ts";
import { Untimed, type ViewRun, type EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult } from "../lib/types.ts";
import type { MutationsView } from "../lib/views/mutations/types.ts";
import type { ProfileInfo } from "../lib/profile-catalog.ts";
import type { TableQuery } from "../lib/table-query.ts";

process.env.GENOME_NEXUS_PIN = "gn-hg19";
process.env.GENOME_NEXUS_GRCH38_PIN = "gn-hg38";

const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch; });
after(() => { globalThis.fetch = realFetch; });

/** an attribute row as tableAttributesSql returns it (name null: the row has none) */
const attr = (id: string, datatype: "STRING" | "NUMBER", patient: 0 | 1, name: string | null, priority = 1) =>
  ({ id, ...(name === null ? {} : { name }), datatype, patient, priority });
const SEX = attr("SEX", "STRING", 1, "Sex");
const AGE = attr("AGE", "NUMBER", 1, "Diagnosis Age");

// ---- K: the pure helpers -------------------------------------------------------------------------

test("K1 clinicalColumns over two studies: each attribute once, per and numeric as given, the three skipped absent", () => {
  assert.deepEqual([...CLINICAL_SKIP].sort(), ["CANCER_TYPE", "CANCER_TYPE_DETAILED", "MUTATION_COUNT"]);
  const s1 = [SEX, AGE, attr("CANCER_TYPE", "STRING", 0, "Cancer Type"), attr("CANCER_TYPE_DETAILED", "STRING", 0, "Cancer Type Detailed"),
    attr("MUTATION_COUNT", "NUMBER", 0, "Mutation Count"), attr("SAMPLE_TYPE", "STRING", 0, "Sample Type")];
  const s2 = [attr("SEX", "STRING", 1, "Gender"), attr("TMB", "NUMBER", 0, "TMB (nonsynonymous)")];
  const got = clinicalColumns([s1, s2], new Set());
  assert.deepEqual(got.map((c) => ({ ...c })), [
    { id: "SEX", name: "Sex", per: "patient", numeric: false },
    { id: "AGE", name: "Diagnosis Age", per: "patient", numeric: true, unsearched: true },
    { id: "SAMPLE_TYPE", name: "Sample Type", per: "sample", numeric: false },
    { id: "TMB", name: "TMB (nonsynonymous)", per: "sample", numeric: true, unsearched: true },
  ]);
});

test("K2 an attribute whose id the table already uses as a column id is left out", () => {
  const taken = new Set(MUTATION_COLUMNS.map((c) => c.id));
  assert.ok(taken.has("sample"));
  const got = clinicalColumns([[attr("sample", "STRING", 0, "Sample"), SEX]], taken);
  assert.deepEqual(got.map((c) => c.id), ["SEX"]);
});

test("K3 an attribute with no name is named by its id", () => {
  const got = clinicalColumns([[attr("SMOKING_HISTORY", "STRING", 1, null)]], new Set());
  assert.equal(got.length, 1);
  assert.equal(got[0].name, "SMOKING_HISTORY");
});

const SAMPLE_TYPE: ClinicalColumn = { id: "SAMPLE_TYPE", name: "Sample Type", per: "sample", numeric: false };
const AGE_COL: ClinicalColumn = { id: "AGE", name: "Diagnosis Age", per: "patient", numeric: true };

// the row maps are ClickHouse Map(String, String) values, which arrive as plain JSON objects
test("K4 clinicalValue: a sample STRING attribute from the sample map, a patient NUMBER one from the patient map as a number; missing → null", () => {
  assert.equal(CLIN_SAMPLE, "clinS");
  assert.equal(CLIN_PATIENT, "clinP");
  const row = { [CLIN_SAMPLE]: { SAMPLE_TYPE: "Primary", AGE: "7" }, [CLIN_PATIENT]: { AGE: "42", SAMPLE_TYPE: "wrong map" } };
  assert.equal(clinicalValue(row, SAMPLE_TYPE), "Primary");
  assert.equal(clinicalValue(row, AGE_COL), 42);
  assert.equal(clinicalValue({ [CLIN_SAMPLE]: { OTHER: "x" }, [CLIN_PATIENT]: {} }, SAMPLE_TYPE), null, "a missing key");
  assert.equal(clinicalValue({ [CLIN_SAMPLE]: { SAMPLE_TYPE: "" } }, SAMPLE_TYPE), null, "''");
  assert.equal(clinicalValue({ [CLIN_PATIENT]: { AGE: "" } }, AGE_COL), null, "'' of a NUMBER attribute");
  assert.equal(clinicalValue({}, SAMPLE_TYPE), null, "no sample map");
  assert.equal(clinicalValue({}, AGE_COL), null, "no patient map");
});

test("K5 clinicalValue of a NUMBER attribute holding 'NA': kept as text", () => {
  assert.equal(clinicalValue({ [CLIN_PATIENT]: { AGE: "NA" } }, AGE_COL), "NA");
});

test("K6 clinicalQueryColumn: num only for NUMBER; the text reads the sample map for a sample attribute, the patient map for a patient one", () => {
  const s = clinicalQueryColumn(SAMPLE_TYPE);
  assert.equal(s.id, "SAMPLE_TYPE");
  assert.equal(s.name, "Sample Type");
  assert.equal(s.numeric, false);
  assert.equal(s.num, undefined);
  assert.match(s.text, /\bclinS\b/);
  assert.doesNotMatch(s.text, /\bclinP\b/);
  assert.match(s.text, /SAMPLE_TYPE/);
  const p = clinicalQueryColumn(AGE_COL);
  assert.equal(p.numeric, true);
  assert.equal(typeof p.num, "string");
  assert.ok(p.num!.length > 0);
  assert.match(p.text, /\bclinP\b/);
  assert.doesNotMatch(p.text, /\bclinS\b/);
  assert.match(p.text, /AGE/);
  const ps = clinicalQueryColumn({ id: "SEX", name: "Sex", per: "patient", numeric: false });
  assert.equal(ps.num, undefined);
  assert.match(ps.text, /\bclinP\b/);
  const sn = clinicalQueryColumn({ id: "TMB", name: "TMB", per: "sample", numeric: true });
  assert.equal(typeof sn.num, "string");
  assert.match(sn.text, /\bclinS\b/);
});

// Legacy (cbioportal-frontend cd8c6df, ClinicalAttributeColumnFormatter): a column carries ONE attribute
// description (the first queried study's) and every row is read at that level —
// `entityId: attribute.patientAttribute ? d[0].patientId : d[0].sampleId` — so a row of a study that
// records the attribute at the other level is blank.
test("K7 a column reads only its description's level: a row recording the attribute at the other level is blank", () => {
  const ageSample: ClinicalColumn = { ...AGE_COL, per: "sample" };
  assert.equal(clinicalValue({ [CLIN_SAMPLE]: {}, [CLIN_PATIENT]: { AGE: "42" } }, ageSample), null, "K7a");
  assert.equal(clinicalValue({ [CLIN_SAMPLE]: { AGE: "7" }, [CLIN_PATIENT]: {} }, ageSample), 7, "K7b");
  assert.equal(clinicalValue({ [CLIN_SAMPLE]: { AGE: "7" }, [CLIN_PATIENT]: {} }, AGE_COL), null, "K7c");
  const s = clinicalQueryColumn(ageSample);
  assert.match(s.text, /\bclinS\b/, "K7d sample");
  assert.doesNotMatch(s.text, /\bclinP\b/, "K7d sample");
  const p = clinicalQueryColumn(AGE_COL);
  assert.match(p.text, /\bclinP\b/, "K7d patient");
  assert.doesNotMatch(p.text, /\bclinS\b/, "K7d patient");
});

// ---- R: runMutations / runHotspots over stand-in resolvers ---------------------------------------

const DISCRETE_CNA: ProfileInfo = { profile: "gistic", type: "COPY_NUMBER_ALTERATION", datatype: "DISCRETE", name: "Putative copy-number alterations from GISTIC", order: 0 };
const MUTATIONS: ProfileInfo = { profile: "mutations", type: "MUTATION_EXTENDED", datatype: "MAF", name: "Mutations", order: 4 };
const ALL = ["sample", "cancerType", "proteinChange", "annotation", "mutationType", "copyNumber", "vaf", "mutCount"];

type Call = { label: string; q: TableQuery; defaults: string[]; column?: string };
type Calls = { values: Call[]; page: Call[]; counts: Call[]; lollipop?: unknown[][]; meta: string[] };
const newCalls = (): Calls => ({ values: [], page: [], counts: [], meta: [] });

/** rowsValues' answers that keep every data-dependent default (a non-zero frequency, two tumour types) */
const keepAll = (column: string) => column === "vaf" ? [{ lo: 0.003, hi: 0.31, n: 4 }]
  : column === "cancerType" ? [{ v: "Colon Adenocarcinoma", n: 3 }, { v: "Rectal Adenocarcinoma", n: 2 }] : [];

const ROWS: Record<string, unknown>[] = [
  { sid: "S1", patient: "P1", vaf: 0.3, vafText: "0.30", clinS: { X: "y" }, clinP: { SEX: "Female", AGE: "61" } },
  { sid: "S2", patient: "P2", vaf: 0.2, vafText: "0.20", clinS: {}, clinP: { SEX: "Male" } },
];

function standIn(cohort: string, study: string, calls: Calls, attrs: Record<string, unknown>[], rows = ROWS) {
  return {
    instance: { id: "c1", mode: "patient-level", label: "Local c1", conn: { id: "c1", db: "c1" } },
    cohortSql: () => "SELECT 1",
    viewMeta: async (label: string, build: (study: string, db: string) => unknown) => {
      calls.meta.push(label);
      assert.equal(typeof build, "function");
      return label === "table:attributes" ? attrs : [];
    },
    lollipopCounts: async (...args: unknown[]) => { (calls.lollipop ??= []).push(args); return { changes: [], types: [], totals: [], cohortSamples: 10, minCount: 1, annotated: true }; },
    rowsPage: async (label: string, _src: unknown, q: TableQuery, defaults: string[]) => {
      calls.page.push({ label, q, defaults });
      return { rows: rows.map((r) => ({ cohort, study, ...r })), total: rows.length };
    },
    rowsCounts: async (label: string, _src: unknown, q: TableQuery, defaults: string[]) => {
      calls.counts.push({ label, q, defaults });
      return [{ cohort, study, n: rows.length, all: rows.length }];
    },
    rowsValues: async (label: string, _src: unknown, q: TableQuery, defaults: string[], column: string) => {
      calls.values.push({ label, q, defaults, column });
      return keepAll(column);
    },
    rowsRank: async () => null,
  };
}

function ctxFor(calls: Calls, attrs: Record<string, unknown>[] = [SEX, AGE]): ViewRun {
  const cohort: EvaluatedCohort = { studies: ["s1"], perStudy: { s1: { sql: "", count: 10, samples: 10, mode: "" } }, count: 10, samples: 10, text: "" };
  return {
    doc: { study: "s1", cohorts: { Q: { study: "s1" } }, views: [] } as never,
    cohorts: { Q: cohort },
    resolvers: { s1: standIn("Q", "s1", calls, attrs) } as never,
    vNames: ["Q"], vStudies: ["s1"],
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: "v7",
    studyProfiles: async () => ({ profiles: ["mutations"], gaProfiles: [], catalog: [MUTATIONS, DISCRETE_CNA] }),
  };
}

type Col = { id: string; name: string; numeric: boolean };
type Mutations = { columns: Col[]; shown: string[]; defaults: string[]; rows: { sample: string; values: (string | number | null)[] }[] };
async function mutations(view: Partial<MutationsView> = {}, calls = newCalls()) {
  const r = await runMutations({ kind: "mutations", gene: "KRAS", cohorts: ["Q"], rows: 100, ...view } as MutationsView, ctxFor(calls));
  return { res: (r instanceof Untimed ? r.result : r) as ViewResult & { mutations?: Mutations; error?: string }, calls };
}

test("R1 runMutations: the clinical columns follow the 35 built-in ones, each row's values read the maps, the defaults leave them hidden", async () => {
  const { res, calls } = await mutations();
  assert.equal(res.error, undefined, JSON.stringify(res).slice(0, 300));
  assert.ok(calls.meta.includes("table:attributes"), "viewMeta asked for the attributes: " + JSON.stringify(calls.meta));
  const m = res.mutations!;
  assert.equal(MUTATION_COLUMNS.length, 35);
  assert.deepEqual(m.columns.map((c) => c.id), [...MUTATION_COLUMNS.map((c) => c.id), "SEX", "AGE"]);
  const [sex, age] = m.columns.slice(35);
  assert.deepEqual([sex.name, sex.numeric, age.name, age.numeric], ["Sex", false, "Diagnosis Age", true]);
  for (const r of m.rows) assert.equal(r.values.length, m.columns.length, r.sample + ": a value per column");
  const at = (sample: string, id: string) => { const r = m.rows.find((x) => x.sample === sample)!; return r.values[m.columns.findIndex((c) => c.id === id)]; };
  assert.equal(at("S1", "SEX"), "Female");
  assert.equal(at("S1", "AGE"), 61);
  assert.equal(at("S2", "SEX"), "Male");
  assert.equal(at("S2", "AGE"), null);
  assert.deepEqual(m.defaults, ALL);
  assert.deepEqual(MUTATION_DEFAULT_COLUMNS, ALL);
  assert.deepEqual(m.shown, ALL);
  assert.ok(!m.shown.includes("SEX") && !m.shown.includes("AGE"));
});

test("R2 a view naming columns [sample, SEX] shows exactly those", async () => {
  const { res, calls } = await mutations({ columns: ["sample", "SEX"] });
  assert.equal(res.error, undefined, JSON.stringify(res).slice(0, 300));
  assert.deepEqual(res.mutations!.shown, ["sample", "SEX"]);
  assert.ok(calls.page.length && calls.page.every((c) => JSON.stringify(c.q.columns) === JSON.stringify(["sample", "SEX"])), JSON.stringify(calls.page.map((c) => c.q)));
});

test("R3 a filter on an attribute the studies do not have is refused, naming it", async () => {
  const { res, calls } = await mutations({ filters: { NOPE: { values: ["x"] } } });
  assert.equal(res.mutations, undefined);
  assert.equal(typeof res.error, "string");
  assert.match(res.error!, /filters\.NOPE: not a column/);
  assert.equal(calls.page.length, 0, "no page asked");
});

test("R4 runHotspots with a table filtering SEX: accepted; lollipopCounts' rows carry the filter and the clinical columns", async () => {
  const calls = newCalls();
  const table = { gene: "KRAS", filters: { SEX: { values: ["Female"] } } };
  const r = await runHotspots({ kind: "hotspots", genes: ["KRAS"], cohorts: ["Q"], table } as never, ctxFor(calls));
  const res = (r instanceof Untimed ? r.result : r) as ViewResult & { error?: string };
  assert.equal(res.error, undefined, JSON.stringify(res).slice(0, 300));
  assert.equal(calls.lollipop?.length, 1, "lollipopCounts asked once");
  const rows = calls.lollipop![0][5] as { gene: string; filters?: Record<string, unknown>; clinical?: ClinicalColumn[] };
  assert.equal(rows.gene, "KRAS");
  assert.deepEqual(rows.filters?.SEX, { values: ["Female"] });
  const sex = rows.clinical?.find((c) => c.id === "SEX");
  assert.ok(sex, "clinical carries SEX: " + JSON.stringify(rows.clinical));
  assert.deepEqual({ ...sex }, { id: "SEX", name: "Sex", per: "patient", numeric: false });
});
