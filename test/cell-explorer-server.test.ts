// The server half of the Cell Explorer links (lib/cell-explorer-server.ts): a cohort's patients as
// the dataset's donor ids, and donor ids (a link or a pasted list) back to the study's patients.
// Both directions name patients, so both run only against a patient-level instance of the study.
//
// The warehouse is a stand-in (setChTransport): instance "a" (patient-level) holds the SPECTRUM
// study (donor id = the PATIENT_DISPLAY_NAME attribute) and an HTAN study (donor id = patient id);
// instance "b" (aggregate-only) holds the other HTAN study. Cell Explorer's catalog is a stubbed fetch.
import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";

process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "cbio_a";
process.env.CLICKHOUSE2_URL = "http://secondary.invalid";
process.env.CLICKHOUSE2_DB = "cbio_b";
process.env.AGGREGATE_ONLY_INSTANCES = "b";
process.env.ONCOKB_PIN = "v-test";
for (const k of ["AGGREGATE_ONLY_STUDIES", "FEDERATION_PEERS", "LOOPBACK_PEER", "VERCEL_ENV"]) delete process.env[k];

const { setChTransport } = await import("../lib/ch.ts");
const { cohortCellsLink, cohortFromCells } = await import("../lib/cell-explorer-server.ts");
const { CELL_EXPLORER_BASE, CELL_EXPLORER_MAX_DONORS, cellExplorerFor } = await import("../lib/cell-explorer.ts");

const SPECTRUM = "msk_spectrum_tme_2022", HTAN = "crc_hta8_htan_2024", HTAN_B = "crc_hta11_htan_2021";
const spectrum = cellExplorerFor(SPECTRUM)!;

/** each study's instance and patients: their SEX and, for SPECTRUM, their donor id */
type Patient = { sex: string; donor?: string };
let WAREHOUSE: Record<string, { conn: string; patients: Record<string, Patient> }>;
function reset() {
  WAREHOUSE = {
    [SPECTRUM]: { conn: "a", patients: { "SPECTRUM-OV-002": { sex: "Female", donor: "D002" }, "SPECTRUM-OV-003": { sex: "Female", donor: "D003" },
      "SPECTRUM-OV-004": { sex: "Female" }, "SPECTRUM-OV-009": { sex: "Male", donor: "D009" } } },
    [HTAN]: { conn: "a", patients: { HTA8_1: { sex: "Female" }, HTA8_2: { sex: "Male" }, HTA8_3: { sex: "Female" } } },
    [HTAN_B]: { conn: "b", patients: { V1: { sex: "Female" } } },
    brca_tcga: { conn: "a", patients: { B1: { sex: "Female" } } },
  };
}

let sent: { conn: string; query: string; externals: string[] }[] = [];
const json = (data: unknown[]) => JSON.stringify({ data, meta: [], rows: data.length });
const compact = (rows: unknown[][]) => JSON.stringify({ meta: [], data: rows, rows: rows.length });
setChTransport(async (st) => {
  const q = st.query;
  sent.push({ conn: st.conn.id, query: q, externals: st.externals.map((e) => e.name) });
  const studies = Object.entries(WAREHOUSE).filter(([, s]) => s.conn === st.conn.id);
  if (/FROM \w+\.cancer_study\n/.test(q)) return json(studies.map(([id]) => ({ id, name: id })));
  const study = studies.find(([id]) => q.includes("'" + id + "'"));
  const ids = async () => new Set((await st.externals.find((e) => e.name === "_ids")!.blob.text()).split("\n").filter(Boolean));
  // donors <-> patients (the module's own two queries)
  if (q.includes("patient_stable_id IN (SELECT id FROM _ids)")) {
    const want = await ids();
    return compact(Object.keys(study![1].patients).filter((p) => want.has(p)).map((p) => [p]));
  }
  if (q.includes("attribute_value AS donor")) {
    assert.match(q, /attribute_name = 'PATIENT_DISPLAY_NAME'/);
    const want = await ids();
    const byPatient = /replaceOne\([^)]*\) IN \(SELECT id FROM _ids\)/.test(q);
    return compact(Object.entries(study![1].patients).filter(([p, x]) => x.donor && want.has(byPatient ? p : x.donor)).map(([p, x]) => [p, x.donor]));
  }
  // a cohort's members, by the SEX value its SQL names
  const sex = /attribute_name = 'SEX' AND [^\n]*'(Female|Male)'/.exec(q)?.[1];
  const members = study ? Object.entries(study[1].patients).filter(([, x]) => !sex || x.sex === sex) : [];
  if (/^SELECT DISTINCT pid FROM/.test(q)) return json(members.map(([pid]) => ({ pid })));
  if (/^SELECT DISTINCT sid FROM/.test(q)) return json(members.map(([pid]) => ({ sid: pid + "-T" })));
  return json([]);
});
after(() => setChTransport(null));

/** Cell Explorer's catalog: each dataset's donor column, or a failure */
let catalog: Record<string, { values: string[] | null; cardinality?: number } | "down" | number>;
let catalogAsked: string[] = [];
const realFetch = globalThis.fetch, realNow = Date.now;
let clock = realNow();
beforeEach(() => {
  reset();
  sent = []; catalogAsked = []; catalog = {};
  // each test starts past the hour a catalog is kept for
  clock += 2 * 3_600_000;
  Date.now = () => clock;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(CELL_EXPLORER_BASE)) return realFetch(input as never, init);
    catalogAsked.push(url);
    const slug = decodeURIComponent(url.slice((CELL_EXPLORER_BASE + "/api/datasets/").length));
    const c = catalog[slug];
    if (c === "down") throw new TypeError("fetch failed");
    if (typeof c === "number") return new Response("", { status: c });
    if (!c) return new Response("{}", { status: 404 });
    return Response.json({ metadata: { obs_columns: [{ name: "assay" }, { name: "donor_id", cardinality: c.cardinality ?? c.values?.length, values: c.values }] } });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; Date.now = realNow; });

const female = { all: [{ kind: "clinical", attribute: "SEX", values: ["Female"] }] };
const male = { all: [{ kind: "clinical", attribute: "SEX", values: ["Male"] }] };
const doc = (study: string, cohorts: Record<string, unknown>) => ({ study, cohorts, views: [] });
const linkConfig = (url: string) => JSON.parse(new URL(url).searchParams.get("config")!);

test("a cohort's link names its patients' donor ids, sorted, keeping those the dataset's catalog lists", async () => {
  catalog.spectrum = { values: ["D002", "D009", "D777"] };
  const r = await cohortCellsLink({ doc: doc(SPECTRUM, { F: female }), cohort: "F" });
  assert.equal(r.study, SPECTRUM);
  assert.equal(r.dataset, "spectrum");
  assert.equal(r.label, spectrum.label);
  assert.equal(r.patients, 3, "the cohort's patients in the study");
  assert.equal(r.donors, 1, "D002 only: OV-004 has no donor id, D003 has no cells in the dataset");
  assert.equal(r.donorsChecked, true);
  assert.ok(r.url.startsWith(CELL_EXPLORER_BASE + "/view?config="));
  assert.deepEqual(linkConfig(r.url).filter, { obsColumn: "donor_id", ids: ["D002"] });
  assert.equal(linkConfig(r.url).dataset, "spectrum");
  assert.deepEqual(catalogAsked, [CELL_EXPLORER_BASE + "/api/datasets/spectrum"]);
});

test("when the catalog cannot be read, every patient with a donor id is linked, and the link says it was not checked", async () => {
  for (const c of ["down", 500, { values: null }, { values: ["D002"], cardinality: 40 }] as const) {
    clock += 2 * 3_600_000;
    catalog.spectrum = c as never;
    const r = await cohortCellsLink({ doc: doc(SPECTRUM, { F: female }), cohort: "F" });
    assert.equal(r.donorsChecked, false, JSON.stringify(c));
    assert.deepEqual(linkConfig(r.url).filter.ids, ["D002", "D003"], JSON.stringify(c));
  }
});

test("the dataset's catalog is read at most once an hour", async () => {
  catalog.spectrum = { values: ["D002", "D003"] };
  await cohortCellsLink({ doc: doc(SPECTRUM, { F: female }), cohort: "F" });
  catalog.spectrum = { values: ["D009"] };
  clock += 30 * 60_000;
  const r = await cohortCellsLink({ doc: doc(SPECTRUM, { F: female }), cohort: "F" });
  assert.equal(catalogAsked.length, 1);
  assert.equal(r.donors, 2, "the earlier catalog still applies");
  clock += 31 * 60_000;
  await assert.rejects(cohortCellsLink({ doc: doc(SPECTRUM, { F: female }), cohort: "F" }), /has cells in/, "an hour on, the new catalog applies");
  assert.equal(catalogAsked.length, 2);
});

test("in a dataset whose donor id is the patient id, the study's own patients are the donors", async () => {
  catalog["crc-metastasis-epithelial"] = { values: ["HTA8_1", "HTA8_3", "HTA8_2"] };
  const r = await cohortCellsLink({ doc: doc(HTAN, { F: female }), cohort: "F" });
  assert.deepEqual(linkConfig(r.url).filter.ids, ["HTA8_1", "HTA8_3"]);
  assert.equal(r.patients, 2);
  const lookup = sent.find((s) => s.query.includes("_ids"))!;
  assert.deepEqual(lookup.externals, ["_ids"], "the patients ride along as a table, not in the SQL text");
  assert.ok(!lookup.query.includes("HTA8_1"));
});

test("a cohort naming its own study is linked in that study", async () => {
  catalog.spectrum = { values: ["D009"] };
  const r = await cohortCellsLink({ doc: doc(HTAN, { M: { ...male, study: SPECTRUM } }), cohort: "M" });
  assert.equal(r.study, SPECTRUM);
  assert.deepEqual(linkConfig(r.url).filter.ids, ["D009"]);
});

test("refused: an unknown cohort (naming those there are), a study with no dataset (naming those that have one)", async () => {
  await assert.rejects(cohortCellsLink({ doc: doc(SPECTRUM, { F: female, M: male }), cohort: "X" }), /no cohort “X”; have F, M/);
  await assert.rejects(cohortCellsLink({ doc: doc("brca_tcga", { F: female }), cohort: "F" }),
    new RegExp("brca_tcga has no single-cell dataset in Cell Explorer; the studies that do: " + SPECTRUM + ", " + HTAN + ", " + HTAN_B));
});

test("refused: a cohort with no patients, or none with cells", async () => {
  WAREHOUSE[SPECTRUM].patients = { "SPECTRUM-OV-009": { sex: "Male", donor: "D009" } };
  await assert.rejects(cohortCellsLink({ doc: doc(SPECTRUM, { F: female }), cohort: "F" }), new RegExp("“F” has no patients in " + SPECTRUM));
  reset();
  catalog.spectrum = { values: ["D999"] };
  await assert.rejects(cohortCellsLink({ doc: doc(SPECTRUM, { F: female }), cohort: "F" }),
    new RegExp("none of the 3 patients of “F” has cells in " + spectrum.label.replace(/[()]/g, "\\$&")));
});

test("refused: a cohort with more donors than a link can name, the limit named", async () => {
  WAREHOUSE[HTAN].patients = Object.fromEntries(Array.from({ length: CELL_EXPLORER_MAX_DONORS + 1 }, (_, i) => ["P" + i, { sex: "Female" }]));
  catalog["crc-metastasis-epithelial"] = "down";
  await assert.rejects(cohortCellsLink({ doc: doc(HTAN, { F: female }), cohort: "F" }),
    new RegExp("has " + (CELL_EXPLORER_MAX_DONORS + 1) + " donors in .*; a Cell Explorer link names at most " + CELL_EXPLORER_MAX_DONORS));
});

test("refused: a study on an aggregate-only instance, whose patients may not be listed", async () => {
  await assert.rejects(cohortCellsLink({ doc: doc(HTAN_B, { F: female }), cohort: "F" }), /not entitled to patient-level data/);
  await assert.rejects(cohortFromCells({ study: HTAN_B, text: "V1" }), /a Cell Explorer link names patients, and .* is not entitled to patient-level data \(crc_hta11_htan_2021\)/);
  assert.ok(!sent.some((s) => s.conn === "b" && s.query.includes("_ids")), "no donor lookup was sent to instance b");
});

test("from a pasted list: the study's patients behind the donor ids, as an explicit patient list", async () => {
  const r = await cohortFromCells({ study: SPECTRUM, text: "D009, D002\nD002 NOPE" });
  assert.equal(r.from, "list");
  assert.equal(r.study, SPECTRUM);
  assert.equal(r.donors, 3);
  assert.equal(r.patients, 2);
  assert.deepEqual(r.unmatched, ["NOPE"]);
  assert.deepEqual(r.def, { all: [{ kind: "patientList", ids: [SPECTRUM + ":SPECTRUM-OV-002", SPECTRUM + ":SPECTRUM-OV-009"] }] });
});

test("from a Cell Explorer link: its filter's donors", async () => {
  const url = CELL_EXPLORER_BASE + "/view?config=" + encodeURIComponent(JSON.stringify({ dataset: "crc-metastasis-epithelial", filter: { obsColumn: "donor_id", ids: ["HTA8_3", "HTA8_1"] } }));
  const r = await cohortFromCells({ study: HTAN, text: url });
  assert.equal(r.from, "link");
  assert.deepEqual(r.def.all, [{ kind: "patientList", ids: [HTAN + ":HTA8_1", HTAN + ":HTA8_3"] }]);
  assert.deepEqual(r.unmatched, []);
});

test("from cells, refused: a study with no dataset, too many donors, or no donor of the study", async () => {
  await assert.rejects(cohortFromCells({ study: "", text: "x" }), /has no single-cell dataset in Cell Explorer/);
  const many = Array.from({ length: CELL_EXPLORER_MAX_DONORS + 1 }, (_, i) => "D" + i).join(" ");
  await assert.rejects(cohortFromCells({ study: SPECTRUM, text: many }), new RegExp("names " + (CELL_EXPLORER_MAX_DONORS + 1) + " donors; a cohort from Cell Explorer takes at most " + CELL_EXPLORER_MAX_DONORS));
  await assert.rejects(cohortFromCells({ study: SPECTRUM, text: "X1 X2 X3 X4" }), new RegExp("none of the 4 ids is a donor of " + SPECTRUM + " \\(e\\.g\\. X1, X2, X3\\)"));
});
