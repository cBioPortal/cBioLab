/**
 * Live check: the Mutations tab's germline mutation frequency (spec-germline G1, G2, G9a), run
 * against the committed fixture study on connection b, with and without a germline-consented list.
 *
 * Expected answers by hand from test/fixtures/peer-study/data_mutations.txt (Hugo_Symbol,
 * Tumor_Sample_Barcode, Mutation_Status), by legacy's /Germline/i:
 *   PTEN  FX-P12-T1 Germline, FX-P13-T1 germline, FX-P14-T1 GERMLINE, FX-P15-T1 Germline_LOH  -> germline 4
 *         FX-P10-T1 SOMATIC, FX-P29-T1 SOMATIC ×2, FX-P17-T1 blank                           -> somatic 3
 *   KRAS  24 samples (FX-P01..P04 T1+T2, FX-P05..P20 T1), all SOMATIC                        -> germline 0
 *
 * No list (the fixture as committed): the germline rate is over every cohort sample (59,
 * data_clinical_sample.txt), so PTEN is 4 of 59 = 6.8%.
 * With the list: the script stores a scratch `cbiolab_peer_fixture_germline` sample list holding
 * FX-P12-T1, FX-P13-T1, FX-P14-T1, FX-P17-T1 and FX-P01-T1 (FX-P15 left off), and deletes it in a
 * finally. Legacy counts only germline samples on the list over the cohort's samples on it
 * (MutationUtils germlineMutationRate), so PTEN is 3 of 5 = 60.0% and KRAS 0 of 5. A sample alone
 * counts 1 in the denominator when listed, 0 when not.
 *
 * L1 the Somatic / Germline badges' filter on the Mutations table (MUT-FM-2): the mutations view for
 * PTEN with filters.status keeps the rows whose Mutation_Status, lower-cased, is exactly the value
 * (legacy FilterUtils applyDefaultMutationStatusFilter), so neither Germline_LOH nor a blank status
 * matches either badge; no badge on ({ values: [] }) keeps no row. PTEN's 8 rows:
 *   equals "germline"  FX-P12-T1, FX-P13-T1, FX-P14-T1                     -> 3 rows
 *   equals "somatic"   FX-P10-T1, FX-P29-T1 ×2                              -> 3 rows
 *   values []          none                                                -> 0 rows
 *   no filter          all 8 (FX-P15-T1 Germline_LOH and FX-P17-T1 blank in neither of the above)
 *
 * Run: node --env-file=.env.local scripts/check-germline-frequency.ts (connection b must be the
 * fixture: `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { register } from "node:module";
import { exec, query, type Conn } from "@cbiolab/clickhouse";
import { connById } from "../lib/ch.ts";
import { PatientLevelResolver } from "../lib/federation.ts";
import { buildLollipopGene } from "../lib/lollipop.ts";
import { runHotspots } from "../lib/views/hotspots/run.ts";
import { runMutations } from "../lib/views/mutations/run.ts";
import type { ColumnFilter } from "../lib/table-query.ts";
import type { ViewRun } from "../lib/views/run.ts";
import type { CohortDef } from "../lib/types.ts";
import type { HotspotGene } from "../lib/views/hotspots/types.ts";

const STUDY = "cbiolab_peer_fixture";
const PIN = "fixture";
const STUDY_SAMPLES = 59;
const LIST = STUDY + "_germline";
const LISTED = ["FX-P12-T1", "FX-P13-T1", "FX-P14-T1", "FX-P17-T1", "FX-P01-T1"];
/** the scratch list's id, far above the importer's (one per list, counting from 1) */
const LIST_ID = 900_000_000 + process.pid;

// the same statements run before and after the scratch rows: no run cache may answer the second time
delete process.env.CH_RUN_CACHE;
process.env.GENOME_NEXUS_PIN = "fixture";
process.env.GENOME_NEXUS_GRCH38_PIN = "fixture";
process.env.GENOME_NEXUS_URL = "http://127.0.0.1:9";

let failures = 0, checks = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  checks++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};
const field = (o: unknown, k: string): unknown => (o as Record<string, unknown> | undefined)?.[k];

const conn = connById("b");
if (!conn) { console.log("FAIL connection b is not configured (npm run peer-db prints its CLICKHOUSE2_* lines)"); process.exit(1); }
const w: Conn = { id: "b", url: conn.url, user: conn.user, password: conn.password, db: conn.db };

const resolver = () => new PatientLevelResolver(STUDY, { oncokbPin: PIN }, { id: conn.id, mode: "patient-level", label: "fixture", conn });
const WHOLE: CohortDef = { all: [] };
const only = (sample: string): CohortDef => ({ all: [{ kind: "sampleList", ids: [STUDY + ":" + sample] }] });
const ctx = (): ViewRun => ({
  doc: { study: STUDY, cohorts: { c: WHOLE }, views: [] },
  cohorts: { c: { studies: [STUDY], perStudy: {} } },
  resolvers: { [STUDY]: resolver() },
  vNames: ["c"], vStudies: [STUDY],
  participationFor: () => ({}),
  pin: PIN, studyProfiles: async () => ({ profiles: [], gaProfiles: [] })
} as unknown as ViewRun);

const counts = async (def: CohortDef, gene: string) => {
  try {
    const rep = await resolver().lollipopCounts(def, [gene], 1);
    const t = rep.totals.find((x) => x.gene === gene);
    const g = buildLollipopGene(gene, [rep], null);
    return { totalGermline: field(t, "germlineSamples"), germline: field(g, "germlineSamples"), somatic: g.somaticSamples, of: g.cohortSamples,
      repGermlineOf: field(rep, "germlineCohortSamples"), germlineOf: field(g, "germlineCohortSamples") };
  } catch (e) { return { error: "threw: " + String((e as Error).message).slice(0, 200) }; }
};

register("../test/support/tsx-loader.mjs", import.meta.url);
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");
const { HotspotsBody } = await import("../app/_lollipop/HotspotsBody.tsx");
/** the card's germline lines, as "<tip> = <rate>" */
const germlineLines = (v: unknown) => [...renderToStaticMarkup(createElement(HotspotsBody, { v: v as never, onHide: () => {}, onCodons: () => {} }))
  .matchAll(/data-tip="([^"]*germline mutation in \w+)"[^>]*><span>Germline Mutation Frequency<\/span> <b>([^<]*)<\/b>/g)].map((m) => m[1] + " = " + m[2]);

/** one pass: [label, PTEN germline, PTEN germline denominator, per-sample [sample, status, germline, denominator], card line] */
async function pass(label: string, pg: number, pOf: number, singles: [string, string, number, number][], card: string) {
  const pten = await counts(WHOLE, "PTEN");
  ok(`G1 ${label}: PTEN totals[].germlineSamples ${pg}`, field(pten, "totalGermline") === pg, JSON.stringify(pten));
  ok(`G1 ${label}: PTEN germlineSamples ${pg} of germlineCohortSamples ${pOf}, in the report and the gene`,
    field(pten, "germline") === pg && field(pten, "repGermlineOf") === pOf && field(pten, "germlineOf") === pOf, JSON.stringify(pten));
  ok(`G1 ${label}: PTEN somaticSamples unchanged: 3 of 59 (FX-P10, FX-P17 blank, FX-P29)`,
    field(pten, "somatic") === 3 && field(pten, "of") === STUDY_SAMPLES, JSON.stringify(pten));
  for (const [sample, status, want, of] of singles) {
    const got = await counts(only(sample), "PTEN");
    ok(`G1 ${label}: ${sample} alone (only PTEN row ${status}): germlineSamples ${want} of ${of}`,
      field(got, "germline") === want && field(got, "germlineOf") === of, JSON.stringify(got));
  }
  const kras = await counts(WHOLE, "KRAS");
  ok(`G2 ${label}: KRAS (every row SOMATIC): germlineSamples 0 of ${pOf}`,
    field(kras, "germline") === 0 && field(kras, "totalGermline") === 0 && field(kras, "germlineOf") === pOf, JSON.stringify(kras));
  try {
    const v = await runHotspots({ kind: "hotspots", genes: ["PTEN", "KRAS"], cohorts: ["c"] } as never, ctx()) as { hotspots?: HotspotGene[] };
    const by = Object.fromEntries((v.hotspots || []).map((g) => [g.gene, [field(g, "germlineSamples"), field(g, "germlineCohortSamples")]]));
    ok(`G1 G2 ${label}: the hotspots view: PTEN ${pg} of ${pOf}, KRAS 0 of ${pOf}`,
      JSON.stringify(by) === JSON.stringify({ PTEN: [pg, pOf], KRAS: [0, pOf] }), JSON.stringify(by));
    const lines = germlineLines(v);
    ok(`G9a ${label}: the card's one germline line is PTEN's "${card}"`, lines.length === 1 && lines[0] === card, JSON.stringify(lines));
  } catch (e) { ok(`G1 G2 G9a ${label}: the hotspots view`, false, "threw: " + String((e as Error).message).slice(0, 200)); }
}

/** the sample ids of PTEN's mutations-view rows under these filters, sorted, or why there are none */
const ptenSamples = async (filters?: Record<string, ColumnFilter>): Promise<string[] | string> => {
  try {
    const res = await runMutations({ kind: "mutations", gene: "PTEN", cohorts: ["c"], rows: 1000, ...(filters ? { filters } : {}) } as never, ctx()) as
      { mutations?: { rows: { sample: string }[] }; error?: string };
    if (!res.mutations) return "refused: " + String(res.error || JSON.stringify(res).slice(0, 200));
    return res.mutations.rows.map((r) => r.sample).sort();
  } catch (e) { return "threw: " + String((e as Error).message).slice(0, 200); }
};
const L1: [string, Record<string, ColumnFilter> | undefined, string[]][] = [
  ["no status filter: all 8 rows", undefined,
    ["FX-P10-T1", "FX-P12-T1", "FX-P13-T1", "FX-P14-T1", "FX-P15-T1", "FX-P17-T1", "FX-P29-T1", "FX-P29-T1"]],
  ["status equals \"germline\": Germline, germline, GERMLINE (3 rows; not Germline_LOH, not blank)", { status: { op: "equals", value: "germline" } },
    ["FX-P12-T1", "FX-P13-T1", "FX-P14-T1"]],
  ["status equals \"somatic\": FX-P10 and FX-P29 ×2 (3 rows; not blank)", { status: { op: "equals", value: "somatic" } },
    ["FX-P10-T1", "FX-P29-T1", "FX-P29-T1"]],
  ["status values []: no row", { status: { values: [] } }, []],
];
for (const [label, filters, want] of L1) {
  const got = await ptenSamples(filters);
  ok(`L1 PTEN ${label}`, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
}

const dropScratch = async () => {
  await exec(w, "ALTER TABLE sample_list_list DELETE WHERE list_id = " + LIST_ID, { mutations_sync: "2" });
  await exec(w, "ALTER TABLE sample_list DELETE WHERE list_id = " + LIST_ID, { mutations_sync: "2" });
};
const listsNamed = async () => Number((await query<{ n: string | number }>(w, "SELECT count() AS n FROM sample_list WHERE stable_id = '" + LIST + "'"))[0]?.n);

if (await listsNamed()) {
  ok(`the fixture has no ${LIST} list before the run (npm run peer-db restores it)`, false);
} else {
  await pass("no list", 4, STUDY_SAMPLES, [["FX-P12-T1", "Germline", 1, 1], ["FX-P13-T1", "germline", 1, 1], ["FX-P14-T1", "GERMLINE", 1, 1],
    ["FX-P15-T1", "Germline_LOH", 1, 1], ["FX-P17-T1", "blank", 0, 1], ["FX-P10-T1", "SOMATIC", 0, 1]],
  "4 of 59 samples carry a germline mutation in PTEN = 6.8%");
  try {
    const studyId = Number((await query<{ id: string | number }>(w, "SELECT any(cancer_study_id) AS id FROM sample_list WHERE stable_id = '" + STUDY + "_all'"))[0]?.id);
    await exec(w, "INSERT INTO sample_list (list_id, stable_id, category, cancer_study_id, name, description) VALUES (" +
      LIST_ID + ", '" + LIST + "', 'other', " + studyId + ", 'Germline-consented samples (check-germline-frequency scratch)', NULL)");
    await exec(w, "INSERT INTO sample_list_list (list_id, sample_id) SELECT " + LIST_ID + ", internal_id FROM sample WHERE stable_id IN (" +
      LISTED.map((s) => "'" + s + "'").join(", ") + ") AND patient_id IN (SELECT internal_id FROM patient WHERE cancer_study_id = " + studyId + ")");
    const stored = Number((await query<{ n: string | number }>(w, "SELECT count() AS n FROM sample_list_list WHERE list_id = " + LIST_ID))[0]?.n);
    ok(`the scratch ${LIST} list holds its ${LISTED.length} samples`, stored === LISTED.length, String(stored));
    // only listed germline samples count: FX-P15 (Germline_LOH) is off the list
    await pass("with the list", 3, LISTED.length, [["FX-P12-T1", "Germline", 1, 1], ["FX-P13-T1", "germline", 1, 1], ["FX-P14-T1", "GERMLINE", 1, 1],
      ["FX-P15-T1", "Germline_LOH, not listed", 0, 0], ["FX-P17-T1", "blank", 0, 1], ["FX-P10-T1", "SOMATIC, not listed", 0, 0]],
    "3 of 5 samples carry a germline mutation in PTEN = 60.0%");
  } finally {
    await dropScratch();
  }
  ok(`the scratch ${LIST} list is gone after the run`, (await listsNamed()) === 0);
}

console.log(`\n${checks - failures}/${checks} germline frequency checks passed`);
process.exit(failures ? 1 : 0);
