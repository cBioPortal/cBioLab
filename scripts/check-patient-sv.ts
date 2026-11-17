/**
 * Live check: the Patient page's Structural Variants table (PAT-SV-1, PAT-SV-3), run against the
 * committed fixture study on connection b through the alterations view (lib/views/alterations/run.ts
 * over lib/patient-alterations.ts patientSvSource). Expected values are written by hand from
 * test/fixtures/peer-study/data_sv.txt, by the portal's rule (StructuralVariantTableWrapper,
 * StoreUtils generateStructuralVariantId, cbioportal-frontend cd8c6df):
 *
 *   M  one row per key: both genes, positions and chromosomes and the class, sorted. FX-P49's
 *      EML4-ALK fusion, in T1 and T2 alike, is one row naming both samples
 *   P  each table's profile and the samples it holds (data_gene_panel_matrix.txt: FX-P49's two samples
 *      in all three; the fixture has no sample outside a profile, so that branch is checked on the warehouse)
 *   K  the key, run on ClickHouse over literal rows: a fusion recorded A–B and B–A is one key;
 *      another position, chromosome or class is another (the fixture holds no A–B / B–A pair)
 *   F  a merged row's fields are one record's (Gene 1 and Gene 2 never both the same partner)
 *   L  the patient list's Structural Variants count is the table's rows (FX-P49: 1, though 2 records)
 *   S  Status is the stored SV status (the page draws s / g): FX-P51's BRCA2 deletion GERMLINE,
 *      its RB1 deletion SOMATIC; a sort by Status is refused (the portal does not sort it)
 *
 * Run: node --env-file=.env.local scripts/check-patient-sv.ts (connection b must be the fixture:
 * `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { chQuery, connById } from "../lib/ch.ts";
import { PatientLevelResolver } from "../lib/federation.ts";
import { runAlterations } from "../lib/views/alterations/run.ts";
import { svRowKey } from "../lib/patient-alterations.ts";
import type { ViewRun } from "../lib/views/run.ts";
import type { AlterationsResult } from "../lib/views/alterations/types.ts";
import type { TableQuery } from "../lib/table-query.ts";

const STUDY = "cbiolab_peer_fixture";

let failures = 0, checks = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  checks++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

const conn = connById("b");
if (!conn) { console.log("FAIL connection b is not configured (npm run peer-db prints its CLICKHOUSE2_* lines)"); process.exit(1); }
const resolver = new PatientLevelResolver(STUDY, { oncokbPin: null }, { id: conn.id, mode: "patient-level", label: "fixture", conn });
const ctx = {
  doc: { study: STUDY, cohorts: { c: { all: [] } }, views: [] },
  cohorts: { c: { studies: [STUDY], perStudy: {} } },
  resolvers: { [STUDY]: resolver },
  vNames: ["c"], vStudies: [STUDY],
  participationFor: () => ({}),
  pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
} as unknown as ViewRun;

type Row = Record<string, string | number | null>;
async function svRows(patient: string, q: TableQuery = {}): Promise<Row[] | string> {
  try {
    const r = await runAlterations({ kind: "alterations", cohorts: ["c"], patient: { study: STUDY, id: patient },
      sv: { ...q, columns: ["samples", "gene1", "gene2", "status", "class", "pos1", "pos2", "eventInfo"], rows: 100 } }, ctx) as { alterations?: AlterationsResult; error?: string };
    const t = r.alterations?.tables.sv;
    if (!t) return "refused: " + String(r.error);
    return t.rows.map((x) => Object.fromEntries(t.columns.map((c, i) => [c.id, x.values[i]])));
  } catch (e) { return "threw: " + String((e as Error).message).slice(0, 300); }
}

// ---- M, F: FX-P49's fusion in two samples -----------------------------------------------------
{
  const r = await svRows("FX-P49");
  if (typeof r === "string") ok("FX-P49's structural variants are listed", false, r);
  else {
    ok("M FX-P49: one row for EML4-ALK in both samples", r.length === 1 && r[0].samples === "FX-P49-T1, FX-P49-T2", JSON.stringify(r));
    ok("F its genes are one record's: EML4, ALK", r[0]?.gene1 === "EML4" && r[0]?.gene2 === "ALK", JSON.stringify(r[0]));
  }
}

// ---- L: the patient list counts the rows the table lists ------------------------------------------
for (const id of ["FX-P49", "FX-P51"]) {
  try {
    const r = await runAlterations({ kind: "alterations", cohorts: ["c"], patient: { study: STUDY, id }, filters: { patient: { op: "equals", value: id } } }, ctx) as { alterations?: AlterationsResult; error?: string };
    const a = r.alterations;
    const listed = a ? a.rows[0]?.values[a.columns.findIndex((c) => c.id === "sv")] : null;
    ok("L " + id + ": the patient list's Structural Variants equals the table's rows", a != null && Number(listed) === a.tables.sv!.total, "list " + listed + ", table " + a?.tables.sv?.total + (r.error ? " " + r.error : ""));
  } catch (e) { ok("L " + id + ": the patient list's count", false, String((e as Error).message).slice(0, 200)); }
}

// ---- S: Status ----------------------------------------------------------------------------------
{
  const r = await svRows("FX-P51");
  if (typeof r === "string") ok("FX-P51's structural variants are listed", false, r);
  else {
    const brca2 = r.find((x) => x.gene1 === "BRCA2"), rb1 = r.find((x) => x.gene1 === "RB1");
    ok("S FX-P51 BRCA2 deletion GERMLINE, RB1 deletion SOMATIC", brca2?.status === "GERMLINE" && rb1?.status === "SOMATIC", JSON.stringify([brca2, rb1]));
    ok("M FX-P51: its four events, four rows", r.length === 4, String(r.length));
  }
  const sorted = await svRows("FX-P51", { sort: { column: "status" } });
  ok("S a sort by Status is refused, naming the column", typeof sorted === "string" && /status is not sortable/.test(sorted), String(sorted).slice(0, 160));
}

// ---- P: which samples each table's profile holds (the not-profiled alerts) ------------------------
{
  // data_gene_panel_matrix.txt profiles both of FX-P49's samples for mutations, cna (DISCRETE) and structural variants
  const r = await runAlterations({ kind: "alterations", cohorts: ["c"], patient: { study: STUDY, id: "FX-P49" } }, ctx) as { alterations?: AlterationsResult; error?: string };
  const pr = r.alterations?.profiling;
  const both = ["FX-P49-T1", "FX-P49-T2"];
  ok("P FX-P49: the study holds all three profiles", !!pr && pr.mutations.study && pr.cna.study && pr.sv.study, JSON.stringify(pr));
  ok("P FX-P49: each profile holds both samples", !!pr && (["mutations", "cna", "sv"] as const).every((t) => JSON.stringify([...pr[t].profiled].sort()) === JSON.stringify(both)), JSON.stringify(pr));
}

// ---- K: the key on literal rows -----------------------------------------------------------------
{
  const key = svRowKey("g1", "g2", "p1", "p2", "c1", "c2", "cls");
  const sql = "SELECT name, " + key + " AS k FROM (" + [
    "SELECT 'ab' AS name, 'EML4' AS g1, 'ALK' AS g2, toNullable(42522656) AS p1, toNullable(29446394) AS p2, '2' AS c1, '2' AS c2, 'FUSION' AS cls",
    "SELECT 'ba', 'ALK', 'EML4', toNullable(29446394), toNullable(42522656), '2', '2', 'FUSION'",
    "SELECT 'otherPos', 'EML4', 'ALK', toNullable(42522657), toNullable(29446394), '2', '2', 'FUSION'",
    "SELECT 'otherClass', 'EML4', 'ALK', toNullable(42522656), toNullable(29446394), '2', '2', 'TRANSLOCATION'",
    "SELECT 'noPos', 'EML4', 'ALK', CAST(NULL AS Nullable(Int64)), CAST(NULL AS Nullable(Int64)), '2', '2', 'FUSION'",
  ].join(" UNION ALL ") + ")";
  const k = new Map((await chQuery<{ name: string; k: string }>(sql, conn)).data.map((r) => [r.name, r.k]));
  ok("K A–B and B–A are one key", k.get("ab") === k.get("ba"), k.get("ab") + " / " + k.get("ba"));
  ok("K another position, another key", k.get("otherPos") !== k.get("ab"));
  ok("K another class, another key", k.get("otherClass") !== k.get("ab"));
  ok("K missing positions read as blanks, a key of their own", !!k.get("noPos") && k.get("noPos") !== k.get("ab"), String(k.get("noPos")));
}

console.log(failures ? `${failures} of ${checks} patient SV checks FAILED` : `all ${checks} patient SV checks passed`);
process.exit(failures ? 1 : 0);
