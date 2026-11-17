/**
 * Live check: an SV call's resistance, diagnostic and prognostic levels on the SV table's rows, the
 * portal's OncoKB sort value of a call (lib/sv-oncokb.ts oncokbSortSql), and the SV and Mutations tables'
 * default order by it, as SQL run against the committed fixture study on connection b. Row ids are
 * spec-sv-levels' (S1–S10).
 *
 * Each level is written down by hand from test/fixtures/peer-oncokb-sv.tsv (pair rows; a blank
 * oncokb_version is the pin `fixture`), test/fixtures/peer-oncokb.tsv (gene-level calls),
 * test/fixtures/peer-hotspots.tsv, test/fixtures/peer-study/data_sv.txt and data_mutations.txt, and the
 * samples' CANCER_TYPE_DETAILED in data_clinical_sample.txt. The fixture's SV levels beyond the
 * sensitive one: LEVEL_Dx1 on EML4-ALK in Lung Adenocarcinoma, LEVEL_Px2 on EML4-ALK in Non-Small Cell
 * Lung Cancer, LEVEL_R2 on FGFR2-FGFR2 in Lung Adenocarcinoma, and LEVEL_R2 on ERG's gene-level Fusion
 * row. The gene-level store holds no diagnostic or prognostic level: a call read from it has NULL there.
 *
 * The sort values are scored by the portal's rule (cbioportal-frontend cd8c6df,
 * packages/oncokb-frontend-commons/src/components/OncoKB.tsx 47-66 sortValue, scores in
 * src/util/OncoKbUtils.ts 367-421 and 552-575), and ordered as defaultArraySortMethod orders them.
 *
 * Run: node --env-file=.env.local scripts/check-sv-levels.ts (connection b must be the fixture:
 * `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { chQuery, connById } from "../lib/ch.ts";
import { svRowSource } from "../lib/sv-table.ts";
import { mutationRowSource } from "../lib/mutation-table.ts";
import { oncokbSortSql } from "../lib/sv-oncokb.ts";

const STUDY = "cbiolab_peer_fixture";
const PIN = "fixture";

let failures = 0, checks = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  checks++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 200);

const conn = connById("b");
if (!conn) { console.log("FAIL connection b is not configured (npm run peer-db prints its CLICKHOUSE2_* lines)"); process.exit(1); }
const db = conn.db;

const cohortOf = (samples: string[]) => "SELECT tupleElement(t, 1) AS pid, tupleElement(t, 2) AS sid FROM (SELECT arrayJoin([" +
  samples.map((s) => `('${s.replace(/-T\d$/, "")}', '${s}')`).join(", ") + "]) AS t)";
const parts = (samples: string[]) => [{ cohort: "c", study: STUDY, cohortSql: cohortOf(samples) }];

// ---- S1, S2, S8: the SV table's rows ------------------------------------------------------------

const SAMPLES = ["FX-P45-T1", "FX-P46-T1", "FX-P47-T1", "FX-P48-T1", "FX-P49-T2", "FX-P52-T1", "FX-P53-T1"];
const GENES = ["EML4", "ALK", "FGFR2", "KIF5B", "RET", "TMPRSS2", "ERG"];
type Level = string | null;
type Row = { sid: string; gene1: string; gene2: string; level: string; resistanceLevel: Level; diagnosticLevel: Level; prognosticLevel: Level };
const tableRows = async (pin: string | null): Promise<Row[] | string> => {
  try {
    return (await chQuery<Row>(
      svRowSource(parts(SAMPLES), db, GENES, pin).with +
      "SELECT sid, gene1, gene2, level, resistanceLevel, diagnosticLevel, prognosticLevel FROM rows", conn)).data;
  } catch (e) { return errText(e); }
};

/** [sample, gene 1, gene 2, resistance, diagnostic, prognostic, spec row and the fixture rows it comes from] */
type Want = [string, string, string, Level, Level, Level, string];
const AT_PIN: Want[] = [
  ["FX-P45-T1", "EML4", "ALK", "", "LEVEL_Dx1", "",
    "S1 LUAD sample (CANCER_TYPE_DETAILED Lung Adenocarcinoma): peer-oncokb-sv 27436|238|FUSION|Lung Adenocarcinoma, Dx1, no R/Px"],
  ["FX-P46-T1", "EML4", "ALK", "", "LEVEL_Dx1", "",
    "S1 another LUAD sample, the same pair row"],
  ["FX-P47-T1", "EML4", "ALK", "", "", "LEVEL_Px2",
    "S1 both cancer-type values blank, the study's Non-Small Cell Lung Cancer: that row's Px2, no R/Dx"],
  ["FX-P48-T1", "EML4", "ALK", "", "", "",
    "S1 CANCER_TYPE only: the no-tumour-type row, which carries no R/Dx/Px"],
  ["FX-P49-T2", "EML4", "ALK", "", "", "",
    "S1 LUSC sample: the Lung Squamous Cell Carcinoma row, no R/Dx/Px (not the LUAD row's Dx1)"],
  ["FX-P46-T1", "FGFR2", "FGFR2", "LEVEL_R2", "", "",
    "S1 LUAD sample: peer-oncokb-sv 2263|2263|FUSION|Lung Adenocarcinoma, R2"],
  ["FX-P52-T1", "KIF5B", "RET", "", "", "",
    "S1 LUAD pair row 3799|5979 has no R/Dx/Px (and not the no-tumour-type row)"],
  ["FX-P53-T1", "TMPRSS2", "ERG", "LEVEL_R2", null, null,
    "S2 no pair row at the pin (7113|2078 only at fixture-older): ERG's gene-level Fusion row in peer-oncokb.tsv, R2; Dx/Px unknown there, NULL"]
];

const rows = await tableRows(PIN);
for (const [sid, g1, g2, res, dx, px, why] of AT_PIN) {
  const name = `pin ${PIN}: ${sid} ${g1}/${g2}: ${why}`;
  if (typeof rows === "string") { ok(name, false, rows); continue; }
  const found = rows.filter((r) => r.sid === sid && r.gene1 === g1 && r.gene2 === g2);
  const r = found[0];
  const got = r ? [r.resistanceLevel, r.diagnosticLevel, r.prognosticLevel] : [];
  ok(name, found.length === 1 && JSON.stringify(got) === JSON.stringify([res, dx, px]),
    found.length === 1 ? `ours ${JSON.stringify(got)}, expected ${JSON.stringify([res, dx, px])}` : found.length + " rows");
}

const none = await tableRows(null);
if (typeof none === "string") ok("S8 with no pin the three columns are ''", false, none);
else ok("S8 with no pin the three columns are ''",
  none.length > 0 && none.every((r) => r.resistanceLevel === "" && r.diagnosticLevel === "" && r.prognosticLevel === ""),
  none.length + " rows; " + none.filter((r) => r.resistanceLevel !== "" || r.diagnosticLevel !== "" || r.prognosticLevel !== "")
    .map((r) => r.sid + " " + r.gene1 + "/" + r.gene2).join("; "));

// ---- S3–S7: oncokbSortSql ----------------------------------------------------------------------

const lit = (v: string | null) => v === null ? "CAST(NULL AS Nullable(String))" : "'" + v.replace(/'/g, "\\'") + "'";
const sortOf = async (args: (string | null)[]): Promise<number[] | string> => {
  try {
    const [a, b, c, d, e] = args.map(lit);
    const r = (await chQuery<{ v: number[] }>("SELECT " + oncokbSortSql(a, b, c, d, e) + " AS v", conn)).data;
    return r[0].v.map(Number);
  } catch (e) { return errText(e); }
};

/** [spec row, arguments, the portal's sort value by hand] */
const SORTS: [string, (string | null)[], number[]][] = [
  ["S3", ["Oncogenic", "LEVEL_1", "LEVEL_R1", "LEVEL_Dx1", "LEVEL_Px1"], [5, 6, 3, 3, 3]],
  ["S4", ["Likely Oncogenic", "LEVEL_3B", "", "", ""], [5, 2, 0, 0, 0]],
  ["S5", ["Resistance", "LEVEL_4", "LEVEL_R3", "LEVEL_Dx3", "LEVEL_Px2"], [5, 1, 1, 1, 2]],
  ["S6", ["Likely Neutral", "LEVEL_2", "LEVEL_R2", "LEVEL_Dx2", "LEVEL_Px3"], [0, 5, 2, 2, 1]],
  ["S6", ["Unknown", null, null, null, null], [0, 0, 0, 0, 0]],
  ["S6", ["", "LEVEL_3A", "garbage", "", ""], [0, 3, 0, 0, 0]]
];
for (const [id, args, want] of SORTS) {
  const got = await sortOf(args);
  ok(`${id} oncokbSortSql(${args.map((a) => a === null ? "NULL" : JSON.stringify(a)).join(", ")}) = ${JSON.stringify(want)}`,
    Array.isArray(got) && JSON.stringify(got) === JSON.stringify(want),
    Array.isArray(got) ? "ours " + JSON.stringify(got) : got);
}

// S7: element by element, descending. A and B tie on the first element, so the second decides; C and D tie
// on the first four, so the prognostic level decides; E's oncogenic 0 puts it last despite LEVEL_1.
const CALLS: [string, string[]][] = [
  ["A", ["Oncogenic", "LEVEL_4", "", "", ""]],
  ["B", ["Likely Oncogenic", "LEVEL_3A", "", "", ""]],
  ["C", ["Oncogenic", "LEVEL_4", "LEVEL_R1", "LEVEL_Dx2", "LEVEL_Px3"]],
  ["D", ["Oncogenic", "LEVEL_4", "LEVEL_R1", "LEVEL_Dx2", "LEVEL_Px1"]],
  ["E", ["Likely Neutral", "LEVEL_1", "LEVEL_R1", "LEVEL_Dx1", "LEVEL_Px1"]]
];
/** B [5,3,0,0,0] > D [5,1,3,2,3] > C [5,1,3,2,1] > A [5,1,0,0,0] > E [0,6,3,3,3] */
const ORDER = "B D C A E";
let order: string;
try {
  const sql = "SELECT name FROM (" + CALLS.map(([name, a]) =>
    "SELECT '" + name + "' AS name, " + oncokbSortSql(...(a.map(lit) as [string, string, string, string, string])) + " AS v").join(" UNION ALL ") +
    ") ORDER BY v DESC";
  order = (await chQuery<{ name: string }>(sql, conn)).data.map((r) => r.name).join(" ");
} catch (e) { order = errText(e); }
ok(`S7 calls ordered by their sort values descending: ${ORDER}`, order === ORDER, "ours " + order);

// ---- S9: the SV table's default order -----------------------------------------------------------

/** a table's rows in its own default order (what lib/table-query.ts runs with no sort column) */
const inDefaultOrder = async (src: { with: string; defaultOrder: string; tiebreak: string }, cols: string): Promise<Record<string, string>[] | string> => {
  try { return (await chQuery<Record<string, string>>(src.with + "SELECT " + cols + " FROM rows ORDER BY " + src.defaultOrder + ", " + src.tiebreak, conn)).data; }
  catch (e) { return errText(e); }
};
const orderCheck = (name: string, got: Record<string, string>[] | string, key: (r: Record<string, string>) => string, want: string[]) => {
  if (typeof got === "string") { ok(name, false, got); return; }
  const ours = got.map(key);
  const at = ours.findIndex((k, i) => k !== want[i]);
  ok(name, JSON.stringify(ours) === JSON.stringify(want),
    at < 0 ? ours.length + " rows" : `first difference at ${at + 1}: ours ${ours[at]}, expected ${want[at]}; ours ${ours.join(" | ")}`);
};

const SV_SAMPLES = ["FX-P45-T1", "FX-P46-T1", "FX-P47-T1", "FX-P48-T1", "FX-P49-T1", "FX-P49-T2", "FX-P50-T1", "FX-P51-T1", "FX-P52-T1", "FX-P53-T1"];
const SV_GENES = ["EML4", "ALK", "FGFR2", "BRCA2", "MET", "ROS1", "RB1", "SMAD4", "NOTCH1", "KIF5B", "RET", "TTN", "MUC16", "TMPRSS2", "ERG", "TPM3", "NTRK1", "MESD", "KIAA1549", "BRAF"];
/**
 * By hand, [oncogenic, sensitive, resistance, Dx, Px, CIViC 0] DESC, then gene1, gene2 ('' first), then the
 * table's tiebreak (sample). Each call as check-oncokb-sv reads it, with the levels of S1/S2 above:
 */
const SV_ORDER = [
  "FX-P52-T1 KIF5B/RET", //       [5,6,0,0,0] LUAD pair row, Level 1
  "FX-P50-T1 ROS1/-", //          [5,6,0,0,0] LUAD row, Level 1; ties KIF5B, gene1 decides
  "FX-P45-T1 EML4/ALK", //        [5,5,0,3,0] LUAD row, Level 2 + Dx1
  "FX-P46-T1 EML4/ALK", //        same row; the sample decides
  "FX-P49-T1 EML4/ALK", //        same row
  "FX-P47-T1 EML4/ALK", //        [5,3,0,0,2] NSCLC row, Level 3A + Px2
  "FX-P50-T1 -/MET", //           [5,2,0,0,0] LUAD row, Level 3B; gene1 '' first
  "FX-P53-T1 KIAA1549/BRAF", //   [5,2,0,0,0] LUAD row, Level 3B
  "FX-P53-T1 TMPRSS2/ERG", //     [5,1,2,0,0] ERG gene-level: Level 4 + R2 (Dx/Px NULL, 0); ahead of EML4 by resistance
  "FX-P48-T1 EML4/ALK", //        [5,1,0,0,0] no-tumour-type row, Level 4
  "FX-P46-T1 FGFR2/FGFR2", //     [5,0,2,0,0] LUAD row, Resistance + R2
  "FX-P50-T1 BRCA2/-", //         [5,0,0,0,0] LUAD row, Likely Oncogenic
  "FX-P51-T1 BRCA2/-", //         the germline one, the same row
  "FX-P50-T1 RB1/-", //           [5,0,0,0,0] Intergenic, read as UNKNOWN: LUAD row, Likely Oncogenic
  "FX-P51-T1 RB1/-", //           DEL, read as UNKNOWN
  "FX-P49-T2 EML4/ALK", //        [0,0,0,0,0] LUSC row, Likely Neutral
  "FX-P52-T1 MESD/TMPRSS2", //    no call
  "FX-P51-T1 NOTCH1/-", //        Unknown
  "FX-P50-T1 SMAD4/-", //         Inconclusive
  "FX-P51-T1 SMAD4/-", //         Inconclusive
  "FX-P53-T1 TPM3/NTRK1", //      pair row Unknown
  "FX-P52-T1 TTN/MUC16" //        pair row, empty
];
let svSrc: { with: string; defaultOrder: string; tiebreak: string } | string;
try { svSrc = svRowSource(parts(SV_SAMPLES), db, SV_GENES, PIN); } catch (e) { svSrc = errText(e); }
orderCheck("S9 the SV table's default order: by the sort value descending, then gene1, gene2",
  typeof svSrc === "string" ? svSrc : await inDefaultOrder(svSrc, "sid, gene1, gene2"),
  (r) => `${r.sid} ${r.gene1 || "-"}/${r.gene2 || "-"}`, SV_ORDER);

// ---- S10: the Mutations table's default order ---------------------------------------------------

/**
 * PIK3CA (data_mutations.txt, all SOMATIC; no tumour-type row for PIK3CA, so each call is the gene-level
 * one in peer-oncokb.tsv, Dx/Px NULL): by hand [oncogenic, sensitive, resistance, Dx, Px, CIViC 0, hotspot,
 * reVUE 0] DESC, then protein position, then the tiebreak (sample).
 */
const MUT_SAMPLES = ["FX-P02-T1", "FX-P10-T1", "FX-P16-T1", "FX-P18-T1", "FX-P29-T1"];
const MUT_ORDER = [
  "FX-P02-T1 E545K", // [5,6,0,0,0,0,0,0] gene-level E545K Oncogenic, Level 1; not a hotspot in peer-hotspots.tsv
  "FX-P10-T1 E545K", // the same call; the sample decides
  "FX-P16-T1 E545K",
  "FX-P18-T1 E545K",
  "FX-P29-T1 E110del", // [0,0,0,0,0,0,1,0] no OncoKB row; hotspot (3:178916944-178916946 GAA>-, in-frame indel); position 110
  "FX-P29-T1 H1047R" //   [0,0,0,0,0,0,1,0] no OncoKB row; hotspot (3:178952085 A>G, single residue); position 1047
];
let mutSrc: { with: string; defaultOrder: string; tiebreak: string } | string;
try { mutSrc = mutationRowSource(parts(MUT_SAMPLES), db, "PIK3CA", PIN, { hg19: PIN, hg38: null }); } catch (e) { mutSrc = errText(e); }
const mutRows = typeof mutSrc === "string" ? mutSrc : await inDefaultOrder(mutSrc, "sid, proteinChange, hot");
orderCheck("S10 the Mutations table's default order (PIK3CA): OncoKB first, then the hotspots, then position",
  mutRows, (r) => `${r.sid} ${r.proteinChange}`, MUT_ORDER);
ok("S10 the hotspot element: H1047R and E110del are recurrent hotspots, E545K is not",
  typeof mutRows !== "string" && mutRows.length === MUT_ORDER.length &&
  mutRows.every((r) => Number(r.hot) === (r.proteinChange === "E545K" ? 0 : 1)),
  typeof mutRows === "string" ? mutRows : mutRows.map((r) => `${r.sid} ${r.proteinChange} ${r.hot}`).join("; "));

/**
 * BRAF, where the hotspot element decides between two calls OncoKB leaves uncalled (data_mutations.txt: FX-P10
 * V600E; FX-P29 D594G, G469A, V600E, all SOMATIC; and the KIAA1549-BRAF fusion on FX-P53, its site 2 gene).
 * No tumour-type row for BRAF, so the mutations' calls are gene-level; the fusion's is the pair's LUAD row in
 * peer-oncokb-sv.tsv. By position alone G469A (codon 469) would come before D594G (codon 594).
 */
const BRAF_SAMPLES = ["FX-P10-T1", "FX-P29-T1", "FX-P53-T1"];
const BRAF_ORDER = [
  "FX-P10-T1 V600E", //               [5,6,0,0,0,0,0,0] gene-level V600E Oncogenic, Level 1 (Dx/Px NULL, 0)
  "FX-P29-T1 V600E", //               the same call; the sample decides
  "FX-P53-T1 KIAA1549-BRAF Fusion", // [5,2,0,0,0,0,0,0] pair 57670|673 Lung Adenocarcinoma row: Likely Oncogenic, Level 3B
  "FX-P29-T1 D594G", //               [0,0,0,0,0,0,1,0] no OncoKB row; hotspot (7:140453154 T>C, single residue)
  "FX-P29-T1 G469A" //                [0,0,0,0,0,0,0,0] no OncoKB row; its empty variant allele matches no hotspot record (check-hotspot-drivers H9)
];
let brafSrc: { with: string; defaultOrder: string; tiebreak: string } | string;
try { brafSrc = mutationRowSource(parts(BRAF_SAMPLES), db, "BRAF", PIN, { hg19: PIN, hg38: null }); } catch (e) { brafSrc = errText(e); }
orderCheck("S10 the Mutations table's default order (BRAF): the hotspot D594G before the uncalled G469A, against position",
  typeof brafSrc === "string" ? brafSrc : await inDefaultOrder(brafSrc, "sid, proteinChange"),
  (r) => `${r.sid} ${r.proteinChange}`, BRAF_ORDER);

console.log(`\n${checks - failures}/${checks} SV level checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
