/**
 * Live check: OncoKB by the sample's tumour type, as SQL run against the committed fixture study on
 * connection b — the sync's key space (packages/annotation-sync/src/sources/oncokb-tumor-type.ts
 * tumorTypeKeySpace: which mutations are asked of OncoKB, with which tumour type) and the mutation
 * table's read (lib/mutation-table.ts mutationRowSource: which stored call each row shows). Each
 * expected answer is written down by hand from test/fixtures/peer-study (EGFR rows; FX-P41–FX-P44
 * hold the tumour-type shapes), test/fixtures/peer-oncokb-tumor-type.tsv and peer-oncokb.tsv, by the
 * portal's rule (cbioportal-frontend e9d70fb): generateUniqueSampleKeyToTumorTypeMap and
 * cancerTypeForOncoKb (src/shared/lib/StoreUtils.ts 1159-1206, 913-920) over the sample-level
 * CANCER_TYPE / CANCER_TYPE_DETAILED rows the API returns (AnalysisStore.ts 410-425, 479-499), and
 * the queries of DefaultMutationMapperDataFetcher.fetchOncoKbData / queryOncoKbData
 * (packages/react-mutation-mapper/src/store/DefaultMutationMapperDataFetcher.ts 296-368). Row ids
 * are the case table's (T*, Q*, S*).
 *
 * The portal's API returns no row for a blank clinical value (the importer never stores one), while
 * clinical_data_derived holds '' for every sample × attribute the study declares; so a sample with
 * both values blank is the portal's "no cancer type clinical data" sample (T3), and one with
 * CANCER_TYPE alone is T4/T5.
 *
 * Run: node --env-file=.env.local scripts/check-oncokb-tumor-type.ts (connection b must be the
 * fixture: `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { chQuery, connById } from "../lib/ch.ts";
import { tumorTypeKeySpace } from "../packages/annotation-sync/src/sources/oncokb-tumor-type.ts";
import { mutationRowSource } from "../lib/mutation-table.ts";
import { biomarkerKeySpace, oncokbTumorTypeSource } from "../packages/annotation-sync/src/sources/oncokb-tumor-type.ts";
import { biomarkerCallsSql, biomarkerTumorType, studyCancerTypeSql } from "../lib/biomarkers.ts";

const STUDY = "cbiolab_peer_fixture";
/** peer-db.ts stores the tumour-type and gene-level OncoKB rows under this version (and the app's pin) */
const PIN = "fixture";
/** and one tumour-type row (E746_A750del in Lung Adenocarcinoma) under this one alone */
const OTHER = "fixture-older";
const NSCLC = "Non-Small Cell Lung Cancer", LUAD = "Lung Adenocarcinoma", LUSC = "Lung Squamous Cell Carcinoma";

let failures = 0, checks = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  checks++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

const conn = connById("b");
if (!conn) { console.log("FAIL connection b is not configured (npm run peer-db prints its CLICKHOUSE2_* lines)"); process.exit(1); }
const db = conn.db;

// ---- the key space ----------------------------------------------------------------------------

type Key = Record<string, string>;
const keysOf = async (study: string | null) => (await chQuery<Key>(tumorTypeKeySpace(db, study), conn)).data;
const k5 = (r: Key) => [r.hugo_gene_symbol, r.alteration, r.consequence, r.tumor_type].join("|");

/** [gene|alteration|consequence|tumour type, why] — every EGFR key of the study, and nothing else */
const EGFR_KEYS: [string, string][] = [
  [`EGFR|L858R|Missense_Mutation|${LUAD}`, "T1 T2 Q6 the detailed type; FX-P21, -23, -25, -27, -33, -35, -37 and FX-P43-T1 share one key"],
  [`EGFR|L858R|Missense_Mutation|${NSCLC}`, "T3 FX-P41-T1, both values blank: the study's cancer type"],
  [`EGFR|L858R|Missense_Mutation|`, "T4 T5 FX-P42-T1, CANCER_TYPE only (detailed blank): no tumour type"],
  [`EGFR|L858R|Missense_Mutation|${LUSC}`, "T7 Q7 FX-P43-T2, the same patient's other sample: a key of its own"],
  [`EGFR|E746_A750del|In_Frame_Del|${LUAD}`, "FX-P22, FX-P26"],
  [`EGFR|E746_A750del|In_Frame_Del|${LUSC}`, "FX-P24, FX-P28"],
  [`EGFR|T790M|Missense_Mutation|${LUAD}`, "FX-P22"],
  [`EGFR|SP10fs|Frame_Shift_Ins|${LUSC}`, "FX-P24"],
  [`EGFR|SP3|Missense_Mutation|${LUAD}`, "FX-P21"],
  [`EGFR|SP4|Missense_Mutation|${LUAD}`, "FX-P21"],
  [`EGFR|SP7|Missense_Mutation|${LUAD}`, "FX-P27"],
  [`EGFR|SP11|Missense_Mutation|${LUAD}`, "FX-P25"],
  [`EGFR|C797S|Missense_Mutation|${LUAD}`, "FX-P44"],
  [`EGFR|A289V|Missense_Mutation|${LUAD}`, "FX-P44"],
  [`EGFR|V769M|Missense_Mutation|${LUAD}`, "FX-P44"],
  [`EGFR|G719A|Missense_Mutation|${LUAD}`, "FX-P44, Mutation_Status NA: not germline, asked"],
  [`EGFR|MUTATED|Splice_Region|${LUAD}`, "FX-P44, no HGVSp_Short: the importer's MUTATED is asked as the portal asks it"]
];
/** [gene|alteration|consequence, why] — mutations of the study that are no key in any tumour type */
const NOT_KEYS: [string, string][] = [
  ["EGFR|L861Q|Missense_Mutation", "Q4 Mutation_Status GERMLINE (FX-P44)"],
  ["EGFR|S768I|Missense_Mutation", "Q4 Mutation_Status germline (FX-P44)"],
  ["EGFR|SP12|Missense_Mutation", "Q4 Mutation_Status GERMLINE (FX-P28)"],
  ["EGFR|EGFR-SEPT14|Fusion", "Q3 mutation type Fusion: the portal drops it before asking by protein change (DMF 349, SU 966-970)"]
];

const keys = await keysOf(STUDY);
ok("the fixture study's key space has rows", keys.length > 0, keys.length + " keys");
ok("every key is a MUTATION", keys.every((r) => r.alteration_type === "MUTATION"), [...new Set(keys.map((r) => r.alteration_type))].join(","));
const seen = keys.map(k5);
ok("Q6 one row per gene, alteration, mutation type and tumour type", new Set(seen).size === seen.length,
  seen.filter((s, i) => seen.indexOf(s) !== i).join("; "));
const egfr = seen.filter((s) => s.startsWith("EGFR|"));
for (const [want, why] of EGFR_KEYS) ok(`key ${want}: ${why}`, egfr.includes(want));
const extra = egfr.filter((s) => !EGFR_KEYS.some(([w]) => w === s));
ok("no other EGFR key (Q3 Q4: no germline or Fusion row becomes one)", extra.length === 0, extra.join("; "));
for (const [mut, why] of NOT_KEYS) ok(`no key for ${mut}: ${why}`, !seen.some((s) => s.startsWith(mut + "|")));
ok("Q6 KRAS G12C, on five Lung Adenocarcinoma samples and one squamous, is two keys",
  seen.filter((s) => s.startsWith("KRAS|G12C|Missense_Mutation|")).sort().join(";") === [`KRAS|G12C|Missense_Mutation|${LUAD}`, `KRAS|G12C|Missense_Mutation|${LUSC}`].join(";"),
  seen.filter((s) => s.startsWith("KRAS|G12C|")).join(";"));

const one = (s: string) => keys.find((r) => k5(r) === s);
const l858r = one(`EGFR|L858R|Missense_Mutation|${LUAD}`);
ok("Q5 a key carries the gene's Entrez id and its protein positions", l858r?.entrez_gene_id === "1956" && l858r?.protein_start === "858" && l858r?.protein_end === "858",
  JSON.stringify(l858r));
const mutated = one(`EGFR|MUTATED|Splice_Region|${LUAD}`);
ok("Q9 a key with no protein position carries the importer's -1 (proteinChangeQuery decides what is sent)",
  mutated?.protein_start === "-1" && mutated?.protein_end === "-1", JSON.stringify(mutated));

const all = (await keysOf(null)).map(k5);
ok("every study's key space (study null) holds the fixture's keys", seen.every((s) => all.includes(s)), all.length + " vs " + seen.length);
ok("another study's key space has none of the fixture's", (await keysOf("no_such_study")).length === 0);

// ---- the mutation table -----------------------------------------------------------------------

/** the cohort: these samples, with their patients */
const SAMPLES = ["FX-P21-T1", "FX-P22-T1", "FX-P28-T1", "FX-P41-T1", "FX-P42-T1", "FX-P43-T1", "FX-P43-T2", "FX-P44-T1"];
const cohortSql = "SELECT tupleElement(t, 1) AS pid, tupleElement(t, 2) AS sid FROM (SELECT arrayJoin([" +
  SAMPLES.map((s) => `('${s.replace(/-T\d$/, "")}', '${s}')`).join(", ") + "]) AS t)";
type Row = { sid: string; proteinChange: string; mutationType: string; oncogenicity: string; level: string; drv: number | string };
const tableRows = async (pin: string | null) => (await chQuery<Row>(
  mutationRowSource([{ cohort: "c", study: STUDY, cohortSql }], db, "EGFR", pin, { hg19: null, hg38: null }).with +
  "SELECT sid, proteinChange, mutationType, oncogenicity, level, drv FROM rows", conn)).data;

/** [sample, protein change, mutation type, oncogenicity, level, driver, why] */
type Want = [string, string, string, string, string, 0 | 1, string];
const AT_PIN: Want[] = [
  ["FX-P21-T1", "L858R", "Missense_Mutation", "Oncogenic", "LEVEL_2", 1, "T1 T2 S3 the Lung Adenocarcinoma row, not the gene-level LEVEL_1"],
  ["FX-P43-T1", "L858R", "Missense_Mutation", "Oncogenic", "LEVEL_2", 1, "T7 S6 the patient's adenocarcinoma sample: its type's row"],
  ["FX-P43-T2", "L858R", "Missense_Mutation", "Likely Neutral", "", 0, "T7 S6 the same patient's squamous sample: its type's row, and the driver flag follows it"],
  ["FX-P41-T1", "L858R", "Missense_Mutation", "Likely Oncogenic", "LEVEL_3A", 1, "T3 both values blank: the study's cancer type's row"],
  ["FX-P42-T1", "L858R", "Missense_Mutation", "Oncogenic", "LEVEL_4", 1, "T4 T5 CANCER_TYPE only: the no-tumour-type row"],
  ["FX-P22-T1", "T790M", "Missense_Mutation", "Oncogenic", "LEVEL_1", 1, "S4 no row for its tumour type: the gene-level call"],
  ["FX-P22-T1", "E746_A750del", "In_Frame_Del", "Oncogenic", "LEVEL_1", 1, "S5 its type's row is stored at another release only: the gene-level call"],
  ["FX-P28-T1", "E746_A750del", "In_Frame_Del", "Oncogenic", "LEVEL_1", 1, "S4 a squamous sample, no row for its type: the gene-level call"],
  ["FX-P44-T1", "C797S", "Missense_Mutation", "Resistance", "", 1, "S3 Resistance is a driver; the level is the highest sensitive one (none)"],
  ["FX-P44-T1", "V769M", "Missense_Mutation", "Unknown", "", 0, "S2 OncoKB answered no oncogenic: Unknown, not a driver"],
  ["FX-P44-T1", "A289V", "Missense_Mutation", "", "", 0, "Q2 a row stored unasked (gene not curated) shows no call"]
];

const compare = (got: Row[], wants: Want[], tag: string) => {
  for (const [sid, pc, type, onc, level, drv, why] of wants) {
    const found = got.filter((r) => r.sid === sid && r.proteinChange === pc && r.mutationType === type);
    const r = found[0];
    const pass = found.length === 1 && r.oncogenicity === onc && r.level === level && Number(r.drv) === drv;
    ok(`${tag}${sid} ${pc}: ${why}`, pass, found.length === 1 ? `ours ${JSON.stringify([r.oncogenicity, r.level, Number(r.drv)])}, expected ${JSON.stringify([onc, level, drv])}` : found.length + " rows");
  }
};

const rows = await tableRows(PIN);
ok("the mutation table has the cohort's EGFR rows", rows.length > 0, rows.length + " rows");
compare(rows, AT_PIN, `pin ${PIN}: `);
// a row for the same alteration with another mutation type (L858R Nonsense_Mutation, Resistance) is no row's call
ok("S3 a stored row of another mutation type is not read (FX-P21-T1 L858R shows one row, Oncogenic)",
  rows.filter((r) => r.sid === "FX-P21-T1" && r.proteinChange === "L858R").length === 1 && !rows.some((r) => r.oncogenicity === "Resistance" && r.proteinChange === "L858R"));
// Q4: the portal never gives a germline mutation the protein-change call (it asks by HGVSc)
const germ = rows.filter((r) => r.sid === "FX-P44-T1" && r.proteinChange === "L858R");
ok("Q4 a germline L858R in a Lung Adenocarcinoma sample is not shown that type's somatic call",
  germ.length === 1 && !(germ[0].oncogenicity === "Oncogenic" && germ[0].level === "LEVEL_2"), JSON.stringify(germ.map((r) => [r.oncogenicity, r.level])));

// S5: the pin decides which release is read
compare(await tableRows(OTHER), [
  ["FX-P22-T1", "E746_A750del", "In_Frame_Del", "Likely Neutral", "", 0, "S5 the row at that release is read"],
  ["FX-P21-T1", "L858R", "Missense_Mutation", "", "", 0, "S5 nothing for this mutation at that release, tumour-type or gene-level"]
], `pin ${OTHER}: `);
const none = await tableRows(null);
ok("with no pin no row has an OncoKB call", none.length === rows.length && none.every((r) => r.oncogenicity === "" && r.level === "" && Number(r.drv) === 0),
  none.filter((r) => r.oncogenicity !== "").map((r) => r.sid + " " + r.proteinChange).join("; "));

// ---- TMB-H / MSI-H (PAT-STM-9) ----------------------------------------------------------------
// The fixture declares no TMB or MSI attribute, so the key space runs over its clinical table plus
// these rows (sample, attribute, value), by the portal's rules (cbioportal-frontend StoreUtils.ts
// getSampleClinicalDataMapByThreshold / ByKeywords, getSampleTumorTypeMap, tumorTypeResolver;
// PatientViewPageStore.ts otherBiomarkerQueries). Ids are the case table's (B*).
/** [case, the rows added (sample, attribute, value), the keys they give (biomarker|tumour type)] — each case run alone */
const CASES: [string, [string, string, string][], string[]][] = [
  ["B1 the preferred attribute, above 10", [["FX-P01-T1", "CVR_TMB_SCORE", "12"]], [`TMB-H|${LUAD}`]],
  ["B2 the other attribute, at 10: the threshold is inclusive", [["FX-P02-T1", "TMB_NONSYNONYMOUS", "10"]], [`TMB-H|${LUAD}`]],
  ["B3 the preferred one below, the other above: qualifies", [["FX-P03-T1", "CVR_TMB_SCORE", "9.9"], ["FX-P03-T1", "TMB_NONSYNONYMOUS", "15"]], [`TMB-H|${LUAD}`]],
  ["B4 below 10", [["FX-P05-T1", "CVR_TMB_SCORE", "9.99"]], []],
  ["B5 not a number", [["FX-P06-T1", "TMB_NONSYNONYMOUS", "high"]], []],
  ["B6 MSI_TYPE Instable", [["FX-P07-T1", "MSI_TYPE", "Instable"]], [`MSI-H|${LUAD}`]],
  ["B7 Stable, and instable in another case: not the keyword", [["FX-P08-T1", "MSI_TYPE", "Stable"], ["FX-P09-T1", "MSI_TYPE", "instable"]], []],
  ["B8 both biomarkers on one sample", [["FX-P10-T1", "MSI_TYPE", "Instable"], ["FX-P10-T1", "CVR_TMB_SCORE", "40"]], [`MSI-H|${LUAD}`, `TMB-H|${LUAD}`]],
  ["T1 no cancer type: the study's", [["FX-P41-T1", "CVR_TMB_SCORE", "30"]], [`TMB-H|${NSCLC}`]],
  ["T2 CANCER_TYPE alone is the tumour type", [["FX-P42-T1", "MSI_TYPE", "Instable"]], ["MSI-H|Lung Cancer"]],
  ["T3 the patient's first sample's detailed type (FX-P43-T1's) for the patient view, its own for its sample view",
    [["FX-P43-T2", "TMB_NONSYNONYMOUS", "20"]], [`TMB-H|${LUAD}`, `TMB-H|${LUSC}`]],
  ["T3b the first sample qualifying: one key, both views asking at its own type", [["FX-P43-T1", "TMB_NONSYNONYMOUS", "20"]], [`TMB-H|${LUAD}`]]
];
const withRows = (added: [string, string, string][]) => "(SELECT sample_unique_id, patient_unique_id, cancer_study_identifier, attribute_name, attribute_value, type FROM " + db + ".clinical_data_derived" +
  " UNION ALL SELECT * FROM values('sample_unique_id String, patient_unique_id String, cancer_study_identifier String, attribute_name String, attribute_value String, type String', " +
  added.map(([sm, a, v]) => `('${STUDY}_${sm}', '${STUDY}_${sm.replace(/-T\d$/, "")}', '${STUDY}', '${a}', '${v}', 'sample')`).join(", ") + "))";
const bkeys: Key[] = [];
for (const [name, added, want] of CASES) {
  const got = (await chQuery<Key>(biomarkerKeySpace(db, STUDY, withRows(added)), conn)).data;
  bkeys.push(...got);
  const seenB = got.map((r) => [r.alteration, r.tumor_type].join("|")).sort();
  ok(name, JSON.stringify(seenB) === JSON.stringify([...want].sort()), seenB.join("; ") || "no key");
}
ok("a biomarker key is filed under Other Biomarkers with no mutation type, Entrez id or position",
  bkeys.every((r) => r.alteration_type === "MUTATION" && r.hugo_gene_symbol === "Other Biomarkers" && r.consequence === "" && r.entrez_gene_id === "" && r.protein_start === ""), JSON.stringify(bkeys[0]));
const whole = (await chQuery<{ n: string }>("SELECT count() AS n FROM (" + oncokbTumorTypeSource.keySpace(db, STUDY) + ")", conn)).data[0];
ok("the sync's key space is the mutations' keys and the biomarkers' (none here) together", Number(whole?.n) === keys.length, JSON.stringify(whole) + " vs " + keys.length);
ok("the fixture's own clinical data, with no TMB or MSI attribute, gives no biomarker key", (await chQuery(biomarkerKeySpace(db, STUDY), conn)).data.length === 0);
ok("T3 the header asks FX-P43 (both samples) at FX-P43-T1's detailed type, and FX-P43-T2 alone at its own",
  biomarkerTumorType([{ id: "FX-P43-T2", attrs: { CANCER_TYPE_DETAILED: LUSC } }, { id: "FX-P43-T1", attrs: { CANCER_TYPE_DETAILED: LUAD } }]) === LUAD &&
  biomarkerTumorType([{ id: "FX-P43-T2", attrs: { CANCER_TYPE_DETAILED: LUSC } }]) === LUSC);

const studyType = (await chQuery<{ name: string }>(studyCancerTypeSql(db, STUDY), conn)).data;
ok("T1 the study's cancer type, asked with when no sample names one", studyType.length === 1 && studyType[0].name === NSCLC, JSON.stringify(studyType));
type Call = Record<string, string>;
const callsAt = async (pin: string, tt: string, alts: ("MSI-H" | "TMB-H")[]) => (await chQuery<Call>(biomarkerCallsSql(pin, tt, alts), conn)).data;
const luad = await callsAt(PIN, LUAD, ["MSI-H", "TMB-H"]);
ok("R1 both calls at Lung Adenocarcinoma, by biomarker, with their level and summary (tumour type's, else the variant's)",
  JSON.stringify(luad.map((c) => [c.alteration, c.tumorType, c.oncogenicity, c.sensitive, c.summary])) ===
  JSON.stringify([["MSI-H", LUAD, "Unknown", "LEVEL_1", "fixture: MSI-H"], ["TMB-H", LUAD, "Unknown", "LEVEL_1", "fixture: TMB-H in Lung Adenocarcinoma"]]), JSON.stringify(luad));
ok("R2 only the biomarkers asked for", (await callsAt(PIN, LUAD, ["TMB-H"])).map((c) => c.alteration).join() === "TMB-H");
ok("R3 a call at another tumour type is not read", (await callsAt(PIN, LUSC, ["TMB-H"])).length === 0);
ok("R4 a call stored at another release only is not read at the pin, and is at its own",
  (await callsAt(PIN, LUSC, ["MSI-H"])).length === 0 && (await callsAt(OTHER, LUSC, ["MSI-H"])).length === 1);
ok("R5 a mutation's row (EGFR) is never read as a biomarker", (await callsAt(PIN, LUAD, [])).length === 0);

console.log(`\n${checks - failures}/${checks} OncoKB tumour-type checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
