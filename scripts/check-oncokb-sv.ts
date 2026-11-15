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
  [`7170|4914|FUSION|${LUAD}`, "S6 TPM3-NTRK1 on FX-P53-T1"]
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
const GENES = ["EML4", "ALK", "FGFR2", "BRCA2", "MET", "ROS1", "RB1", "SMAD4", "NOTCH1", "KIF5B", "RET", "TTN", "MUC16", "TMPRSS2", "ERG", "TPM3", "NTRK1"];
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
  ["FX-P53-T1", "TPM3", "NTRK1", "Unknown", "Unknown", "", 0, "S6 the pair row says Unknown: it wins over NTRK1's gene-level Oncogenic"]
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

console.log(`\n${checks - failures}/${checks} OncoKB SV checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
