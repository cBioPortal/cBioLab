/**
 * Live check: OncoKB for structural variants, by gene pair and the sample's tumour type, as SQL run
 * against the committed fixture study on connection b — the sync's key space
 * (packages/annotation-sync/src/sources/oncokb-sv.ts svKeySpace: which structural variants are keys,
 * with which OncoKB SV type and tumour type) and the SV table's read (lib/sv-table.ts svRowSource:
 * which stored call each row shows). Each expected answer is written down by hand from
 * test/fixtures/peer-study/data_sv.txt (FX-P45–FX-P53), test/fixtures/peer-oncokb-sv.tsv and the SV
 * rows of peer-oncokb.tsv, by the portal's rule (cbioportal-frontend e9d70fb):
 * deriveStructuralVariantType and generateAnnotateStructuralVariantQuery
 * (packages/oncokb-frontend-commons/src/util/OncoKbUtils.ts 246-317), generateQueryStructuralVariantId
 * (same file 89-100), fetchStructuralVariantOncoKbData (src/shared/lib/StoreUtils.ts 848-880), the
 * tumour type of uniqueSampleKeyToTumorType (ResultsViewPageStore.ts 5967-5990, the rule C's
 * check-oncokb-tumor-type.ts pins), and the SV table's lookup by that id
 * (src/pages/patientView/structuralVariant/column/AnnotationColumnFormatter.tsx 161-188). Row ids
 * are the case table's (Y*, T*, D*, S*).
 *
 * The oncoprint's and OQL DRIVER's call on a structural variant (spec rows O*, Q*): driverEventSql
 * over every SV row of genomic_event_derived, and oqlCasesSql's DRIVER over SVs. The portal asks
 * OncoKB about every SV of the oncoprint with no tumour type and reads each one's answer by its
 * (site1, site2, null tumour type, SV type) id (ResultsViewPageStore.ts 5468-5562, cbioportal-frontend
 * cd8c6df); the call is a driver when OncoKB says Oncogenic, Likely Oncogenic or Resistance
 * (StoreUtils.ts 2014-2031), and both partners' rows take it. A pair with no row at the pin falls back
 * to either partner's gene-level Fusion row.
 *
 * The SV type is decided by how many sites name a gene (the API's Hugo symbols): two → FUSION
 * whatever the class; one → the class when it is exactly one of DELETION, TRANSLOCATION,
 * DUPLICATION, INSERTION, INVERSION, FUSION, else UNKNOWN.
 *
 * Run: node --env-file=.env.local scripts/check-oncokb-sv.ts (connection b must be the fixture:
 * `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { chQuery, connById } from "../lib/ch.ts";
import { svKeySpace } from "../packages/annotation-sync/src/sources/oncokb-sv.ts";
import { SV_COLUMNS, svRowSource } from "../lib/sv-table.ts";
import { driverEventSql, oqlCasesSql } from "../lib/oql.ts";
import { SV_EVENT_KEY, svDriverKeySetSql } from "../lib/sv-oncokb.ts";

const STUDY = "cbiolab_peer_fixture";
/** peer-db.ts stores the SV and gene-level OncoKB rows under this version (and the app's pin) */
const PIN = "fixture";
/** and one SV row (TMPRSS2-ERG in Lung Adenocarcinoma) under this one alone */
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
const keysOf = async (study: string | null) => (await chQuery<Key>(svKeySpace(db, study), conn)).data;
const k4 = (r: Key) => [r.site1_entrez, r.site2_entrez, r.sv_type, r.tumor_type].join("|");

/** [site1|site2|SV type|tumour type, spec row and fixture samples] — every key of the study, and nothing else */
const KEYS: [string, string][] = [
  [`27436|238|FUSION|${LUAD}`, "Y1 T1 Y10 EML4-ALK on FX-P45-T1, FX-P46-T1 and FX-P49-T1 (detailed type): one key"],
  [`27436|238|FUSION|${NSCLC}`, "T1 EML4-ALK on FX-P47-T1, both cancer-type values blank: the study's cancer type"],
  [`27436|238|FUSION|`, "T1 EML4-ALK on FX-P48-T1, CANCER_TYPE only: no tumour type"],
  [`27436|238|FUSION|${LUSC}`, "S5 EML4-ALK on FX-P49-T2, the same patient's squamous sample: a key of its own"],
  [`2263|2263|FUSION|${LUAD}`, "Y2 FGFR2-FGFR2 on FX-P46-T1, site1 = site2, class DUPLICATION: two genes, FUSION"],
  [`675||DELETION|${LUAD}`, "Y3 BRCA2 on FX-P50-T1, site1 only, class DELETION"],
  [`|4233|DUPLICATION|${LUAD}`, "Y4 MET on FX-P50-T1, site2 only, class DUPLICATION: site1 ''"],
  [`6098||FUSION|${LUAD}`, "Y6 ROS1 on FX-P50-T1, one gene, class FUSION"],
  [`5925||UNKNOWN|${LUAD}`, "Y5 RB1 on FX-P51-T1, class DEL: UNKNOWN"],
  [`4089||UNKNOWN|${LUAD}`, "Y5 SMAD4 on FX-P51-T1, class Deletion (case-sensitive): UNKNOWN"],
  [`4851||UNKNOWN|${LUAD}`, "Y5 NOTCH1 on FX-P51-T1, class NA: UNKNOWN"],
  [`3799|5979|FUSION|${LUAD}`, "Y9 KIF5B-RET on FX-P52-T1, class INVERSION: two genes, FUSION (a key whatever the curation)"],
  [`7273|94025|FUSION|${LUAD}`, "Y8 TTN-MUC16 on FX-P52-T1, class TRANSLOCATION: a key; the sync stores it unasked"],
  [`7113|2078|FUSION|${LUAD}`, "S4 TMPRSS2-ERG on FX-P53-T1, class DELETION: two genes, FUSION"],
  [`7170|4914|FUSION|${LUAD}`, "S6 TPM3-NTRK1 on FX-P53-T1"],
  [`23184|7113|FUSION|${LUAD}`, "P10 MESD-TMPRSS2 on FX-P52-T1 (the file's MESDC2, by its Entrez id)"],
  [`57670|673|FUSION|${LUAD}`, "KIAA1549-BRAF on FX-P53-T1"],
  [`972|3084|FUSION|${LUAD}`, "O15 CD74-NRG1 on FX-P52-T1, Event_Info blank"],
  // X1 (PR E): every (site1, site2, SV type) is also a key with no tumour type, the portal's
  // driver query (cancerTypeForOncoKb(key, {}) is null: ResultsViewPageStore.ts 5467-5490); EML4-ALK's
  // is already one by FX-P48-T1's own tumour type, and stays one row (Y10)
  [`2263|2263|FUSION|`, "X1 FGFR2-FGFR2 with no tumour type"],
  [`675||DELETION|`, "X1 BRCA2 (FX-P50-T1 somatic, FX-P51-T1 germline: a germline SV is a key too) with no tumour type"],
  [`|4233|DUPLICATION|`, "X1 MET, site1 '', with no tumour type"],
  [`6098||FUSION|`, "X1 ROS1 with no tumour type"],
  [`5925||UNKNOWN|`, "X1 RB1 (DEL on FX-P51-T1, Intergenic on FX-P50-T1: both UNKNOWN) with no tumour type"],
  [`4089||UNKNOWN|`, "X1 SMAD4 (Deletion, NA) with no tumour type"],
  [`4851||UNKNOWN|`, "X1 NOTCH1 with no tumour type"],
  [`3799|5979|FUSION|`, "X1 KIF5B-RET with no tumour type"],
  [`7273|94025|FUSION|`, "X1 TTN-MUC16 with no tumour type: a key whatever the curation"],
  [`7113|2078|FUSION|`, "X1 TMPRSS2-ERG with no tumour type"],
  [`7170|4914|FUSION|`, "X1 TPM3-NTRK1 with no tumour type"],
  [`23184|7113|FUSION|`, "X1 MESD-TMPRSS2 with no tumour type"],
  [`57670|673|FUSION|`, "X1 KIAA1549-BRAF with no tumour type"],
  [`972|3084|FUSION|`, "X1 O15 CD74-NRG1 with no tumour type"]
];

const keys = await keysOf(STUDY);
ok("the fixture study's key space has rows", keys.length > 0, keys.length + " keys");
const seen = keys.map(k4);
ok("Y10 one row per site1, site2, SV type and tumour type", new Set(seen).size === seen.length,
  seen.filter((s, i) => seen.indexOf(s) !== i).join("; "));
for (const [want, why] of KEYS) ok(`key ${want}: ${why}`, seen.includes(want), "keys: " + seen.join("; "));
const extra = seen.filter((s) => !KEYS.some(([w]) => w === s));
ok("no other key (Y: a SV's type is the one its gene count and class give)", extra.length === 0, extra.join("; "));
ok("the entrez columns are '' where a site names no gene, never '0' or '\\N'",
  keys.every((r) => !["0", "\\N", "null"].includes(r.site1_entrez) && !["0", "\\N", "null"].includes(r.site2_entrez)),
  keys.filter((r) => ["0", "\\N", "null"].includes(r.site1_entrez) || ["0", "\\N", "null"].includes(r.site2_entrez)).map(k4).join("; "));

const all = (await keysOf(null)).map(k4);
ok("every study's key space (study null) holds the fixture's keys", seen.every((s) => all.includes(s)), all.length + " vs " + seen.length);
ok("another study's key space has none of the fixture's", (await keysOf("no_such_study")).length === 0);

// ---- the SV table -----------------------------------------------------------------------------

/** the cohort: these samples, with their patients */
const SAMPLES = ["FX-P45-T1", "FX-P46-T1", "FX-P47-T1", "FX-P48-T1", "FX-P49-T1", "FX-P49-T2", "FX-P50-T1", "FX-P51-T1", "FX-P52-T1", "FX-P53-T1"];
const GENES = ["EML4", "ALK", "FGFR2", "BRCA2", "MET", "ROS1", "RB1", "SMAD4", "NOTCH1", "KIF5B", "RET", "TTN", "MUC16", "TMPRSS2", "ERG", "TPM3", "NTRK1", "MESD", "KIAA1549", "BRAF"];
const cohortSql = "SELECT tupleElement(t, 1) AS pid, tupleElement(t, 2) AS sid FROM (SELECT arrayJoin([" +
  SAMPLES.map((s) => `('${s.replace(/-T\d$/, "")}', '${s}')`).join(", ") + "]) AS t)";
const annotationText = SV_COLUMNS.find((c) => c.id === "annotation")!.text;
type Row = { sid: string; gene1: string; gene2: string; oncogenicity: string; level: string; drv: number | string; annotation: string };
const tableRows = async (pin: string | null) => (await chQuery<Row>(
  svRowSource([{ cohort: "c", study: STUDY, cohortSql }], db, GENES, pin).with +
  "SELECT sid, gene1, gene2, oncogenicity, level, drv, " + annotationText + " AS annotation FROM rows", conn)).data;

/** [sample, gene 1, gene 2, annotation as shown, oncogenicity, level, driver, spec row and why] */
type Want = [string, string, string, string, string, string, 0 | 1, string];
const AT_PIN: Want[] = [
  ["FX-P45-T1", "EML4", "ALK", "Oncogenic · Level 2", "Oncogenic", "LEVEL_2", 1, "S2 T1 the pair's Lung Adenocarcinoma row, not ALK's gene-level LEVEL_1"],
  ["FX-P46-T1", "EML4", "ALK", "Oncogenic · Level 2", "Oncogenic", "LEVEL_2", 1, "Y10 the same key as FX-P45-T1, the same row"],
  ["FX-P47-T1", "EML4", "ALK", "Likely Oncogenic · Level 3A", "Likely Oncogenic", "LEVEL_3A", 1, "T1 both values blank: the study's cancer type's row"],
  ["FX-P48-T1", "EML4", "ALK", "Oncogenic · Level 4", "Oncogenic", "LEVEL_4", 1, "T1 CANCER_TYPE only: the no-tumour-type row"],
  ["FX-P49-T1", "EML4", "ALK", "Oncogenic · Level 2", "Oncogenic", "LEVEL_2", 1, "S5 the patient's adenocarcinoma sample: its type's row"],
  ["FX-P49-T2", "EML4", "ALK", "Likely Neutral", "Likely Neutral", "", 0, "S5 D2 the same patient's squamous sample: its type's row, not a driver"],
  ["FX-P46-T1", "FGFR2", "FGFR2", "Resistance", "Resistance", "", 1, "Y2 D1 site1 = site2 read as FUSION; Resistance is a driver, the level is the sensitive one (none)"],
  ["FX-P50-T1", "BRCA2", "", "Likely Oncogenic", "Likely Oncogenic", "", 1, "Y3 site1 only, read by its class DELETION"],
  ["FX-P50-T1", "", "MET", "Likely Oncogenic · Level 3B", "Likely Oncogenic", "LEVEL_3B", 1, "Y4 site2 only, read with site1 ''"],
  ["FX-P50-T1", "ROS1", "", "Oncogenic · Level 1", "Oncogenic", "LEVEL_1", 1, "Y6 one gene, class FUSION"],
  ["FX-P51-T1", "RB1", "", "Likely Oncogenic", "Likely Oncogenic", "", 1, "Y5 class DEL read as UNKNOWN"],
  ["FX-P51-T1", "SMAD4", "", "Inconclusive", "Inconclusive", "", 0, "Y5 class Deletion read as UNKNOWN; D2 Inconclusive is no driver"],
  ["FX-P51-T1", "NOTCH1", "", "Unknown", "Unknown", "", 0, "Y5 class NA read as UNKNOWN; D2 Unknown is no driver"],
  ["FX-P52-T1", "KIF5B", "RET", "Oncogenic · Level 1", "Oncogenic", "LEVEL_1", 1, "Y9 one partner curated: its stored answer"],
  ["FX-P52-T1", "TTN", "MUC16", "", "", "", 0, "Y8 S7 an uncurated pair stored empty: blank, no driver, not TTN's gene-level Unknown"],
  ["FX-P53-T1", "TMPRSS2", "ERG", "Oncogenic · Level 4", "Oncogenic", "LEVEL_4", 1, "S4 S3 no pair row at the pin: the partner ERG's gene-level Fusion row"],
  ["FX-P53-T1", "TPM3", "NTRK1", "Unknown", "Unknown", "", 0, "S6 the pair row says Unknown: it wins over NTRK1's gene-level Oncogenic"],
  ["FX-P51-T1", "BRCA2", "", "Likely Oncogenic", "Likely Oncogenic", "", 1, "a GERMLINE SV is read like any other (the portal asks it by pair; legacy RVU 249)"],
  ["FX-P50-T1", "RB1", "", "Likely Oncogenic", "Likely Oncogenic", "", 1, "Y5 class Intergenic read as UNKNOWN"],
  ["FX-P50-T1", "SMAD4", "", "Inconclusive", "Inconclusive", "", 0, "Y5 class NA read as UNKNOWN, whatever the event info"],
  ["FX-P52-T1", "MESD", "TMPRSS2", "", "", "", 0, "S4 no pair row and neither partner has a gene-level Fusion row: blank"],
  ["FX-P53-T1", "KIAA1549", "BRAF", "Likely Oncogenic · Level 3B", "Likely Oncogenic", "LEVEL_3B", 1, "S2 the pair's tumour-type row, not its no-tumour-type row"]
];

const compare = (got: Row[], wants: Want[], tag: string) => {
  for (const [sid, g1, g2, ann, onc, level, drv, why] of wants) {
    const found = got.filter((r) => r.sid === sid && r.gene1 === g1 && r.gene2 === g2);
    const r = found[0];
    const pass = found.length === 1 && r.annotation === ann && r.oncogenicity === onc && r.level === level && Number(r.drv) === drv;
    ok(`${tag}${sid} ${g1 || "-"}/${g2 || "-"}: ${why}`, pass,
      found.length === 1 ? `ours ${JSON.stringify([r.annotation, r.oncogenicity, r.level, Number(r.drv)])}, expected ${JSON.stringify([ann, onc, level, drv])}` : found.length + " rows");
  }
};

const rows = await tableRows(PIN);
ok("the SV table has one row per planted SV of the cohort", rows.length === AT_PIN.length, rows.length + " rows, " + AT_PIN.length + " planted");
compare(rows, AT_PIN, `pin ${PIN}: `);

// S3: the pin decides which release is read
compare(await tableRows(OTHER), [
  ["FX-P53-T1", "TMPRSS2", "ERG", "Likely Neutral", "Likely Neutral", "", 0, "S3 the pair row stored at that release is read"],
  ["FX-P45-T1", "EML4", "ALK", "", "", "", 0, "S3 nothing for this SV at that release, pair or gene-level"]
], `pin ${OTHER}: `);
const none = await tableRows(null);
ok("with no pin no row has an OncoKB call", none.length === rows.length && none.every((r) => r.oncogenicity === "" && r.level === "" && Number(r.drv) === 0),
  none.filter((r) => r.oncogenicity !== "").map((r) => r.sid + " " + r.gene1 + "/" + r.gene2).join("; "));

// ---- the oncoprint's and OQL DRIVER's call on a structural variant (spec rows O*, Q*) ----------

type Call = { sample_unique_id: string; hugo_gene_symbol: string; d: number | string };
const bare = (sid: string) => sid.slice(STUDY.length + 1);
const callsAt = async (pin: string, studies: string[] = [STUDY]) => (await chQuery<Call>(
  "SELECT sample_unique_id, hugo_gene_symbol, toUInt8(" + driverEventSql(pin, "", { db, studies }) + ") AS d FROM " + db +
  ".genomic_event_derived WHERE variant_type = 'structural_variant' AND cancer_study_identifier = '" + STUDY + "'", conn)).data;

/** [sample, gene of the row, driver at pin `fixture`, spec row and why]: every SV row of the fixture */
const SV_CALLS: [string, string, 0 | 1, string][] = [
  ...["FX-P45-T1", "FX-P46-T1", "FX-P47-T1", "FX-P48-T1", "FX-P49-T1", "FX-P49-T2"].flatMap((s): [string, string, 0 | 1, string][] => [
    [s, "EML4", 1, "O1 EML4-ALK's no-tumour-type row is Oncogenic: the EML4 row" + (s === "FX-P49-T2" ? " (O2 its LUSC row Likely Neutral is not read)" : "")],
    [s, "ALK", 1, "O1 EML4-ALK's no-tumour-type row is Oncogenic: the ALK row" + (s === "FX-P49-T2" ? " (O2 its LUSC row Likely Neutral is not read)" : "")]
  ]),
  ["FX-P52-T1", "KIF5B", 0, "O3 KIF5B-RET's no-tumour-type row is Likely Neutral, its LUAD row Oncogenic is not read"],
  ["FX-P52-T1", "RET", 0, "O3 KIF5B-RET, the RET row"],
  ["FX-P53-T1", "KIAA1549", 1, "O4 KIAA1549-BRAF's no-tumour-type row is Oncogenic"],
  ["FX-P53-T1", "BRAF", 1, "O4 KIAA1549-BRAF, the BRAF row"],
  ["FX-P46-T1", "FGFR2", 1, "O5 FGFR2-FGFR2's no-tumour-type row is Resistance"],
  ["FX-P50-T1", "BRCA2", 1, "O6 BRCA2 one-gene DELETION, no-tumour-type row Likely Oncogenic (somatic)"],
  ["FX-P51-T1", "BRCA2", 1, "O6 BRCA2 one-gene DELETION (germline)"],
  ["FX-P50-T1", "MET", 0, "O7 MET one-gene DUPLICATION: only a LUAD row, no gene-level Fusion row"],
  ["FX-P53-T1", "TPM3", 1, "O8 TPM3-NTRK1 has no no-tumour-type row: NTRK1's gene-level Fusion is Oncogenic, the TPM3 row"],
  ["FX-P53-T1", "NTRK1", 1, "O8 TPM3-NTRK1, the NTRK1 row"],
  ["FX-P52-T1", "TTN", 0, "O9 TTN-MUC16 has no no-tumour-type row; TTN's gene-level Fusion is Unknown"],
  ["FX-P52-T1", "MUC16", 0, "O9 TTN-MUC16, the MUC16 row"],
  ["FX-P52-T1", "MESD", 0, "O10 MESDC2-TMPRSS2: no pair row, no gene-level row"],
  ["FX-P52-T1", "TMPRSS2", 0, "O10 MESDC2-TMPRSS2, the TMPRSS2 row"],
  ["FX-P53-T1", "TMPRSS2", 1, "O11 TMPRSS2-ERG has no pair row at the pin: ERG's gene-level Fusion is Oncogenic, the TMPRSS2 row"],
  ["FX-P53-T1", "ERG", 1, "O11 TMPRSS2-ERG, the ERG row"],
  ["FX-P50-T1", "ROS1", 0, "O12 ROS1 one-gene FUSION: only a LUAD row"],
  ["FX-P51-T1", "RB1", 0, "O12 RB1 one-gene UNKNOWN (class DEL): only a LUAD row"],
  ["FX-P50-T1", "RB1", 0, "O12 RB1 one-gene UNKNOWN (class Intergenic)"],
  ["FX-P51-T1", "SMAD4", 0, "O12 SMAD4 one-gene UNKNOWN (class Deletion)"],
  ["FX-P50-T1", "SMAD4", 0, "O12 SMAD4 one-gene UNKNOWN (class NA)"],
  ["FX-P51-T1", "NOTCH1", 0, "O12 NOTCH1 one-gene UNKNOWN (class NA)"],
  ["FX-P52-T1", "CD74", 1, "O15 CD74-NRG1 with Event_Info blank: its no-tumour-type row is Oncogenic, the CD74 row"],
  ["FX-P52-T1", "NRG1", 1, "O15 CD74-NRG1 with Event_Info blank, the NRG1 row"]
];

const compareCalls = (got: Call[], want: [string, string, 0 | 1, string][], tag: string) => {
  ok(`${tag}one call per SV row of the fixture`, got.length === want.length, got.length + " rows, " + want.length + " expected");
  for (const [sid, gene, d, why] of want) {
    const found = got.filter((r) => bare(r.sample_unique_id) === sid && r.hugo_gene_symbol === gene);
    ok(`${tag}${sid} ${gene}: ${d ? "driver" : "not a driver"} — ${why}`, found.length === 1 && Number(found[0].d) === d,
      found.length === 1 ? "ours " + Number(found[0].d) : found.length + " rows");
  }
  const extra = got.filter((r) => !want.some(([sid, gene]) => bare(r.sample_unique_id) === sid && r.hugo_gene_symbol === gene));
  ok(`${tag}no SV row beyond the expected ones`, extra.length === 0, extra.map((r) => r.sample_unique_id + " " + r.hugo_gene_symbol).join("; "));
};

compareCalls(await callsAt(PIN), SV_CALLS, `driverEventSql pin ${PIN}: `);
compareCalls(await callsAt(OTHER), SV_CALLS.map(([s, g, , why]): [string, string, 0 | 1, string] =>
  [s, g, 0, "O11 at fixture-older: no no-tumour-type row and no gene-level row at that release (was: " + why + ")"]), `driverEventSql pin ${OTHER}: `);
compareCalls(await callsAt(PIN, ["no_such_study"]), SV_CALLS.map(([s, g]): [string, string, 0 | 1, string] =>
  [s, g, 0, "O14 the lookup reads only the named studies' SVs, and another study is named"]), `driverEventSql pin ${PIN}, studies [no_such_study]: `);

// O13: a mutation and a copy-number row keep their gene-level calls (peer-oncokb.tsv: KRAS G12C
// Oncogenic, CDKN2A DELETION Oncogenic; KRAS G12C on FX-P01-T1, CDKN2A deep deletion on FX-P05-T1)
const nonSv = async (where: string) => (await chQuery<{ d: number | string }>(
  "SELECT toUInt8(" + driverEventSql(PIN, "", { db, studies: [STUDY] }) + ") AS d FROM " + db + ".genomic_event_derived WHERE cancer_study_identifier = '" +
  STUDY + "' AND " + where, conn)).data.map((r) => Number(r.d));
const kras = await nonSv(`sample_unique_id = '${STUDY}_FX-P01-T1' AND variant_type = 'mutation' AND hugo_gene_symbol = 'KRAS' AND mutation_variant = 'G12C'`);
ok("O13 a mutation (KRAS G12C on FX-P01-T1, Oncogenic) is still a driver", kras.length > 0 && kras.every((d) => d === 1), JSON.stringify(kras));
const cdkn2a = await nonSv(`sample_unique_id = '${STUDY}_FX-P05-T1' AND variant_type = 'cna' AND hugo_gene_symbol = 'CDKN2A' AND cna_alteration <= -2`);
ok("O13 a copy-number row (CDKN2A deep deletion on FX-P05-T1, Oncogenic) is still a driver", cdkn2a.length > 0 && cdkn2a.every((d) => d === 1), JSON.stringify(cdkn2a));
const notStored = await nonSv(`variant_type = 'mutation' AND (hugo_gene_symbol, mutation_variant) NOT IN (SELECT hugo_gene_symbol, alteration FROM annotation.oncokb WHERE oncokb_version = '${PIN}' AND alteration_type = 'MUTATION')`);
ok("O13 a mutation with no store row at the pin is not a driver", notStored.length > 0 && notStored.every((d) => d === 0), notStored.filter((d) => d !== 0).length + " of " + notStored.length + " called drivers");

// Q: the samples an OQL query returns. The fixture holds no NTRK1 mutation or copy-number event
// (asked of genomic_event_derived), so NTRK1: DRIVER is TPM3-NTRK1's sample alone.
const samplesOf = async (q: string): Promise<string[] | string> => {
  try {
    const rows = (await chQuery<{ pid: string }>(oqlCasesSql(q, { oncokbPin: PIN, study: STUDY, db, unit: "sample" }), conn)).data;
    return [...new Set(rows.map((r) => r.pid))].sort();
  } catch (e) { return "error: " + String((e as Error).message).slice(0, 200); }
};
const ntrk1Other = (await chQuery<{ n: number | string }>("SELECT count() AS n FROM " + db + ".genomic_event_derived WHERE cancer_study_identifier = '" +
  STUDY + "' AND hugo_gene_symbol = 'NTRK1' AND variant_type != 'structural_variant'", conn)).data;
ok("Q3 premise: the fixture holds no NTRK1 mutation or copy-number event", Number(ntrk1Other[0]?.n) === 0, String(ntrk1Other[0]?.n));
for (const [tag, q, want] of [
  ["Q1 O1 O2", "ALK: FUSION_DRIVER", ["FX-P45-T1", "FX-P46-T1", "FX-P47-T1", "FX-P48-T1", "FX-P49-T1", "FX-P49-T2"]],
  ["Q2 O3", "RET: FUSION_DRIVER", []],
  ["Q3 O8", "NTRK1: DRIVER", ["FX-P53-T1"]],
  ["Q4 no driver filter", "RET: FUSION", ["FX-P52-T1"]],
  ["O15 (b) Event_Info blank", "CD74: FUSION_DRIVER", ["FX-P52-T1"]],
  ["O15 (b) Event_Info blank", "NRG1: FUSION_DRIVER", ["FX-P52-T1"]]
] as [string, string, string[]][]) {
  const got = await samplesOf(q);
  ok(`${tag} '${q}': ${want.join(", ") || "no one"}`, Array.isArray(got) && got.join(",") === [...want].sort().join(","),
    Array.isArray(got) ? "got " + (got.join(", ") || "no one") : got);
}

// O15: an SV whose Event_Info is blank. The importer stores a blank SV text column as 'NA' (legacy
// importer rule), so the key is 'NA' here; a warehouse whose structural_variant.event_info is NULL
// takes the ifNull(…, '') on both sides of the key. (a) is SV_CALLS above, (b) the Q rows.
const o15 = (await chQuery<{ e: string | null; n: number | string }>("SELECT event_info AS e, isNull(event_info) AS n FROM " + db +
  ".structural_variant WHERE comments LIKE 'O15:%'", conn)).data;
ok("O15 premise: the CD74-NRG1 SV is stored once, its blank Event_Info as 'NA' or NULL", o15.length === 1 && (Number(o15[0].n) === 1 || o15[0].e === "NA"),
  JSON.stringify(o15));
// (c) the oncoprint's in-memory path: each event's svk (SV_EVENT_KEY of its genomic_event_derived row) is
// looked up in the driver key set (svDriverKeySetSql), which buildAnnotationIndex reads
const keySet = new Set((await chQuery<{ k: string }>(svDriverKeySetSql(db, PIN, [STUDY], ["CD74", "NRG1"]), conn)).data.map((r) => r.k));
const svks = (await chQuery<{ g: string; k: string | null }>("SELECT hugo_gene_symbol AS g, " + SV_EVENT_KEY + " AS k FROM " + db +
  ".genomic_event_derived WHERE variant_type = 'structural_variant' AND cancer_study_identifier = '" + STUDY +
  "' AND sample_unique_id = '" + STUDY + "_FX-P52-T1' AND hugo_gene_symbol IN ('CD74', 'NRG1')", conn)).data;
for (const g of ["CD74", "NRG1"]) {
  const r = svks.filter((x) => x.g === g);
  ok(`O15 (c) FX-P52-T1 ${g}: the event's svk is in the oncoprint's driver key set`, r.length === 1 && r[0].k != null && keySet.has(r[0].k),
    "svk " + JSON.stringify(r.map((x) => x.k)) + ", key set " + JSON.stringify([...keySet]));
}

console.log(`\n${checks - failures}/${checks} OncoKB SV checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
