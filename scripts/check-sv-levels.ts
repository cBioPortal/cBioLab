/**
 * Live check: an SV call's resistance, diagnostic and prognostic levels on the SV table's rows, and the
 * portal's OncoKB sort value of a call (lib/sv-oncokb.ts oncokbSortSql), as SQL run against the committed
 * fixture study on connection b. Row ids are spec-sv-levels' (S1–S8).
 *
 * Each level is written down by hand from test/fixtures/peer-oncokb-sv.tsv (pair rows; a blank
 * oncokb_version is the pin `fixture`), the SV rows of test/fixtures/peer-oncokb.tsv (gene-level Fusion
 * calls), test/fixtures/peer-study/data_sv.txt and the samples' CANCER_TYPE_DETAILED in
 * data_clinical_sample.txt. The fixture's levels beyond the sensitive one: LEVEL_Dx1 on EML4-ALK in Lung
 * Adenocarcinoma, LEVEL_Px2 on EML4-ALK in Non-Small Cell Lung Cancer, LEVEL_R2 on FGFR2-FGFR2 in Lung
 * Adenocarcinoma. No gene-level Fusion row carries a resistance level, so S2 checks the fallback's ''.
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
import * as svOncokb from "../lib/sv-oncokb.ts";

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

// ---- S1, S2, S8: the SV table's rows ------------------------------------------------------------

const SAMPLES = ["FX-P45-T1", "FX-P46-T1", "FX-P47-T1", "FX-P48-T1", "FX-P49-T2", "FX-P52-T1", "FX-P53-T1"];
const GENES = ["EML4", "ALK", "FGFR2", "KIF5B", "RET", "TMPRSS2", "ERG"];
const cohortSql = "SELECT tupleElement(t, 1) AS pid, tupleElement(t, 2) AS sid FROM (SELECT arrayJoin([" +
  SAMPLES.map((s) => `('${s.replace(/-T\d$/, "")}', '${s}')`).join(", ") + "]) AS t)";
type Row = { sid: string; gene1: string; gene2: string; level: string; resistanceLevel: string; diagnosticLevel: string; prognosticLevel: string };
const tableRows = async (pin: string | null): Promise<Row[] | string> => {
  try {
    return (await chQuery<Row>(
      svRowSource([{ cohort: "c", study: STUDY, cohortSql }], db, GENES, pin).with +
      "SELECT sid, gene1, gene2, level, resistanceLevel, diagnosticLevel, prognosticLevel FROM rows", conn)).data;
  } catch (e) { return errText(e); }
};

/** [sample, gene 1, gene 2, resistance, diagnostic, prognostic, spec row and the fixture rows it comes from] */
type Want = [string, string, string, string, string, string, string];
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
  ["FX-P53-T1", "TMPRSS2", "ERG", "", "", "",
    "S2 no pair row at the pin (7113|2078 only at fixture-older): ERG's gene-level Fusion row, which has no resistance level (none in peer-oncokb.tsv has one); Dx/Px ''"]
];

const rows = await tableRows(PIN);
if (typeof rows === "string") {
  for (const [sid, g1, g2, , , , why] of AT_PIN) ok(`pin ${PIN}: ${sid} ${g1}/${g2}: ${why}`, false, rows);
} else {
  for (const [sid, g1, g2, res, dx, px, why] of AT_PIN) {
    const found = rows.filter((r) => r.sid === sid && r.gene1 === g1 && r.gene2 === g2);
    const r = found[0];
    const got = r ? [r.resistanceLevel, r.diagnosticLevel, r.prognosticLevel] : [];
    ok(`pin ${PIN}: ${sid} ${g1}/${g2}: ${why}`,
      found.length === 1 && JSON.stringify(got) === JSON.stringify([res, dx, px]),
      found.length === 1 ? `ours ${JSON.stringify(got)}, expected ${JSON.stringify([res, dx, px])}` : found.length + " rows");
  }
}

const none = await tableRows(null);
if (typeof none === "string") ok("S8 with no pin the three columns are ''", false, none);
else ok("S8 with no pin the three columns are ''",
  none.length > 0 && none.every((r) => r.resistanceLevel === "" && r.diagnosticLevel === "" && r.prognosticLevel === ""),
  none.length + " rows; " + none.filter((r) => r.resistanceLevel !== "" || r.diagnosticLevel !== "" || r.prognosticLevel !== "")
    .map((r) => r.sid + " " + r.gene1 + "/" + r.gene2).join("; "));

// ---- S3–S7: oncokbSortSql ----------------------------------------------------------------------

type SortSql = (oncogenicity: string, sensitive: string, resistance: string, diagnostic: string, prognostic: string) => string;
const sortSql = (svOncokb as Record<string, unknown>).oncokbSortSql as SortSql | undefined;
const lit = (v: string | null) => v === null ? "CAST(NULL AS Nullable(String))" : "'" + v.replace(/'/g, "\\'") + "'";
const sortOf = async (args: (string | null)[]): Promise<number[] | string> => {
  if (typeof sortSql !== "function") return "lib/sv-oncokb.ts exports no oncokbSortSql";
  try {
    const [a, b, c, d, e] = args.map(lit);
    const r = (await chQuery<{ v: number[] }>("SELECT " + sortSql(a, b, c, d, e) + " AS v", conn)).data;
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
if (typeof sortSql !== "function") order = "lib/sv-oncokb.ts exports no oncokbSortSql";
else {
  try {
    const sql = "SELECT name FROM (" + CALLS.map(([name, a]) =>
      "SELECT '" + name + "' AS name, " + sortSql(...(a.map(lit) as [string, string, string, string, string])) + " AS v").join(" UNION ALL ") +
      ") ORDER BY v DESC";
    order = (await chQuery<{ name: string }>(sql, conn)).data.map((r) => r.name).join(" ");
  } catch (e) { order = errText(e); }
}
ok(`S7 calls ordered by their sort values descending: ${ORDER}`, order === ORDER, "ours " + order);

console.log(`\n${checks - failures}/${checks} SV level checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
