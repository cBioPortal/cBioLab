/**
 * Live check: the Patient page's Allele Freq column (PAT-MT-3, PAT-STM-1), run against the committed
 * fixture study on connection b through the alterations view (lib/views/alterations/run.ts over
 * lib/patient-alterations.ts patientMutationsSource and lib/table-query.ts). Each expected value is
 * written down by hand from test/fixtures/peer-study/data_mutations.txt (t_alt_count, t_ref_count of
 * FX-P01's and FX-P02's two samples), by the portal's rule (AlleleFreqColumnFormatter, cbioportal-frontend
 * cd8c6df):
 *
 *   R  a mutation row's reads: one (sample, alt, ref) per sample carrying it with allele counts, in the
 *      patient's sample order (the cell's bars and tooltip lines).
 *   V  the row's value: the highest VAF among them, to 4 decimals (the text the cell shows is formatted
 *      by the portal's rule, 4 decimals below 0.01, in the browser).
 *   S  the sort: the per-sample VAFs in sample order, compared one by one (getSortValue, LazyMobXTable
 *      compareLists); a sample without the mutation, without reads or at 0 is null, last in either
 *      direction (compareValues). FX-P02 tells this from a sort by the highest VAF: SMARCA4 0.6869 (T1),
 *      KRAS 0.1949 (T1) and 0.6786 (T2), PIK3CA 0.3371 (T1) — by sample, descending, SMARCA4, PIK3CA,
 *      KRAS; by the highest, SMARCA4, KRAS, PIK3CA.
 *   Q  a filter and a search read that same 4-place value
 *   D  one record per sample: a variant recorded twice in a sample is drawn once (its first record)
 *   N  null last in either direction, on a literal table run through the same ORDER BY (the fixture has
 *      no mutation in a patient's second sample alone).
 *   P  the VAF plot's values (PAT-STM-7, GenomicOverviewUtils computeMutationFrequencyBySample): per sample,
 *      alt / (alt + ref) of each mutation row it carries with counts, whatever the table's search or page.
 *
 * Run: node --env-file=.env.local scripts/check-patient-vaf.ts (connection b must be the fixture:
 * `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { chQuery, connById } from "../lib/ch.ts";
import { PatientLevelResolver } from "../lib/federation.ts";
import { runAlterations } from "../lib/views/alterations/run.ts";
import { firstPerSample, vafSort } from "../lib/patient-alterations.ts";
import type { ViewRun } from "../lib/views/run.ts";
import type { AlleleReads, AlterationsResult } from "../lib/views/alterations/types.ts";

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

type Row = { gene: string; vaf: number | null; reads: AlleleReads[] | undefined };
async function rows(patient: string, sort?: { column: string; desc?: boolean }, q: Record<string, unknown> = {}): Promise<Row[] | string> {
  try {
    const r = await runAlterations({ kind: "alterations", cohorts: ["c"], patient: { study: STUDY, id: patient }, mutations: { columns: ["gene", "vaf"], ...(sort ? { sort } : {}), ...q } }, ctx) as { alterations?: AlterationsResult; error?: string };
    const t = r.alterations?.tables.mutations;
    if (!t) return "refused: " + String(r.error);
    const at = (id: string) => t.columns.findIndex((c) => c.id === id);
    return t.rows.map((x) => ({ gene: String(x.values[at("gene")]), vaf: x.values[at("vaf")] as number | null, reads: x.detail?.reads as AlleleReads[] | undefined }));
  } catch (e) { return "threw: " + String((e as Error).message).slice(0, 300); }
}
const show = (x: unknown) => JSON.stringify(x);

// ---- R, V: each row's reads and value ----------------------------------------------------------
const P02 = await rows("FX-P02");
if (typeof P02 === "string") ok("FX-P02's mutations are listed", false, P02);
else {
  const by = (g: string) => P02.find((r) => r.gene === g);
  ok("R KRAS G12D: both samples' reads, in sample order", show(by("KRAS")?.reads) === show([{ sample: "FX-P02-T1", alt: 38, ref: 157 }, { sample: "FX-P02-T2", alt: 190, ref: 90 }]), show(by("KRAS")?.reads));
  ok("R PIK3CA E545K: T1's reads alone", show(by("PIK3CA")?.reads) === show([{ sample: "FX-P02-T1", alt: 267, ref: 525 }]), show(by("PIK3CA")?.reads));
  ok("R SMARCA4 R1192C: T1's reads alone", show(by("SMARCA4")?.reads) === show([{ sample: "FX-P02-T1", alt: 215, ref: 98 }]), show(by("SMARCA4")?.reads));
  ok("V KRAS's value is its highest VAF, 190/280, to 4 decimals", show(by("KRAS")?.vaf) === "0.6786", show(by("KRAS")?.vaf));
  ok("V PIK3CA 267/792 = 0.3371", show(by("PIK3CA")?.vaf) === "0.3371", show(by("PIK3CA")?.vaf));
}

// ---- S: the sort by sample -------------------------------------------------------------------
const genes = (r: Row[] | string) => typeof r === "string" ? r : r.map((x) => x.gene).join(", ");
{
  const d = genes(await rows("FX-P02", { column: "vaf", desc: true }));
  ok("S FX-P02 descending: T1's VAF first (SMARCA4 .687, PIK3CA .337, KRAS .195), not the highest", d === "SMARCA4, PIK3CA, KRAS", d);
  const a = genes(await rows("FX-P02", { column: "vaf" }));
  ok("S FX-P02 ascending: KRAS, PIK3CA, SMARCA4", a === "KRAS, PIK3CA, SMARCA4", a);
  const d1 = genes(await rows("FX-P01", { column: "vaf", desc: true }));
  ok("S FX-P01 descending: KRAS (.368 in T1), TP53 (.131)", d1 === "KRAS, TP53", d1);
}

// ---- P: the VAF plot's values -------------------------------------------------------------------
async function plotOf(patient: string, q: Record<string, unknown> = {}, genesProfiled: "any" | "all" = "any"): Promise<Record<string, number[]> | string> {
  const r = await runAlterations({ kind: "alterations", cohorts: ["c"], patient: { study: STUDY, id: patient }, genesProfiled, mutations: { columns: ["gene", "vaf"], ...q } }, ctx) as { alterations?: AlterationsResult; error?: string };
  return r.alterations?.vafs ?? "no vafs: " + String(r.error);
}
const rounded = (x: Record<string, number[]> | string) => typeof x === "string" ? x : show(Object.fromEntries(Object.entries(x).sort().map(([k, v]) => [k, v.map((n) => Math.round(n * 1e4) / 1e4)])));
{
  const p02 = rounded(await plotOf("FX-P02"));
  const want02 = show({ "FX-P02-T1": [0.1949, 0.3371, 0.6869], "FX-P02-T2": [0.6786] });
  ok("P FX-P02: T1 KRAS 38/195, PIK3CA 267/792, SMARCA4 215/313; T2 KRAS 190/280", p02 === want02, p02);
  const p01 = rounded(await plotOf("FX-P01"));
  const want01 = show({ "FX-P01-T1": [0.1314, 0.3682], "FX-P01-T2": [0.2063] });
  ok("P FX-P01: T1 TP53 79/601, KRAS 88/239; T2 KRAS 145/703", p01 === want01, p01);
  const searched = rounded(await plotOf("FX-P02", { search: "PIK3CA", rows: 1 }));
  ok("P the table's search and page size leave the plot whole", searched === want02, searched);
  const all = rounded(await plotOf("FX-P02", {}, "all"));
  ok("P genes profiled in all samples: FX-P02's samples share a panel, so every row stays", all === want02, all);
}

// ---- N: a missing value last in either direction ---------------------------------------------
for (const dir of ["ASC", "DESC"] as const) {
  const sql = "SELECT name FROM (SELECT 'a' AS name, CAST([0.5, NULL] AS Array(Nullable(Float64))) AS vafs, 0.5 AS vaf UNION ALL " +
    "SELECT 'b', CAST([NULL, 0.9] AS Array(Nullable(Float64))), 0.9 UNION ALL SELECT 'c', CAST([0.2, 0.3] AS Array(Nullable(Float64))), 0.3 UNION ALL " +
    "SELECT 'd', CAST([0.5, 0.1] AS Array(Nullable(Float64))), 0.5) ORDER BY " + vafSort(2)(dir) + ", name";
  const got = (await chQuery<{ name: string }>(sql, conn)).data.map((r) => r.name).join("");
  const want = dir === "ASC" ? "cdab" : "dacb";
  ok("N " + dir + ": by the first sample, a null last, then the second sample (b has no first-sample VAF)", got === want, got + ", want " + want);
}

// ---- Q: filter and search read the value the cell shows ------------------------------------------
{
  // PIK3CA 267/792 = 0.33712…, shown 0.3371: a range up to 0.3371 keeps it, as it reads on screen
  const kept = genes(await rows("FX-P02", undefined, { filters: { vaf: { max: 0.3371 } } }));
  ok("Q a range up to 0.3371 keeps PIK3CA (0.3371), not KRAS (0.6786) or SMARCA4 (0.6869)", kept === "PIK3CA", kept);
  const found = genes(await rows("FX-P02", undefined, { search: "0.3371" }));
  ok("Q a search for 0.3371 finds PIK3CA", found === "PIK3CA", found);
}

// ---- D: one record per sample, on a literal array (the fixture has no repeated record) ----------
{
  const sql = "SELECT " + firstPerSample("[('T1', 10, 90), ('T2', 5, 95), ('T1', 20, 80)]") + " AS r";
  const r = (await chQuery<{ r: unknown[] }>(sql, conn)).data[0]?.r;
  ok("D a sample recorded twice keeps its first record, once", JSON.stringify(r) === JSON.stringify([["T1", 10, 90], ["T2", 5, 95]]), JSON.stringify(r));
}

console.log(failures ? `${failures} of ${checks} patient VAF checks FAILED` : `all ${checks} patient VAF checks passed`);
process.exit(failures ? 1 : 0);
