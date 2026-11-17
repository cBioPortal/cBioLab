/**
 * Live check: the Mutations tab's driver calls follow the page's driver settings (MUT-BF-2, MUT-MD-2,
 * MUT-0-3), run against the committed fixture study on connection b — lib/federation.ts
 * lollipopTypesSql with `drivers` summed into the grid's tally (F, B1), and lollipopCounts' report:
 * its `annotated` (R, B1) and its totals beside its stems and tally (B3). Row ids are the spec table's.
 *
 * Each expected number is written down by hand from the fixture files, by the portal's rule
 * (annotateMutationPutativeDriver: oncoKb || hotspots || custom, each only from a switched-on
 * source; ResultsViewPageStoreUtils.ts 132-159, cbioportal-frontend cd8c6df):
 *   PIK3CA (test/fixtures/peer-study/data_mutations.txt): E545K Missense on FX-P02-T1, FX-P10-T1,
 *     FX-P16-T1, FX-P18-T1 (4 rows; OncoKB Oncogenic in peer-oncokb.tsv, no record in
 *     peer-hotspots.tsv); H1047R Missense on FX-P29-T1 (a single-residue hotspot in peer-hotspots.tsv,
 *     not in peer-oncokb.tsv); E110del In_Frame_Del on FX-P29-T1 (an in-frame-indel hotspot, not in
 *     peer-oncokb.tsv). No fusion has PIK3CA as a partner (data_sv.txt).
 *   KRAS: 24 Missense rows (G12C/G12D/G12V/G13D/Q61H on FX-P01..FX-P20, FX-P01..P04 twice), every one
 *     OncoKB Oncogenic, none with a Genome Nexus record (so no hotspot).
 *   ALK: no mutation; 6 EML4-ALK FUSION rows (data_sv.txt lines 2-7, FX-P45-T1..FX-P49-T2), whose
 *     pair (27436, 238) has a no-tumour-type row in peer-oncokb-sv.tsv, Oncogenic: a driver by OncoKB.
 *     Hotspots never call a fusion; data_sv.txt has no cbp_driver / tiers column.
 *   BRAF: V600E Missense on FX-P10-T1 and FX-P29-T1 (OncoKB Oncogenic), D594G on FX-P29-T1 (a hotspot),
 *     G469A on FX-P29-T1 (not in peer-oncokb.tsv; its record has an empty allele, so no hotspot: VUS by
 *     default); one KIAA1549-BRAF FUSION on FX-P53-T1 (data_sv.txt line 23), the pair (57670, 673)
 *     Oncogenic with no tumour type in peer-oncokb-sv.tsv: a driver.
 *   data_mutations.txt has no cbp_driver / cbp_driver_tiers column: no custom call, no tier (R6). So
 *     with OncoKB and hotspots off the study's own calls cannot annotate it: the portal offers its
 *     custom-driver box only when the study has binary calls and a tier box only for a tier it has
 *     (R5, B1: not annotated, every row filed as a driver, one badge per type).
 *   B3: EML4 and ALK have no mutation; the 6 EML4-ALK fusions (6 samples) have EML4 as site 1, so
 *     they count toward EML4's somatic samples, not ALK's; no hotspot calls a fusion, so with hotspots
 *     the only source a DRIVER line keeps none of them.
 *
 * Run: node --env-file=.env.local scripts/check-mutation-driver-settings.ts (connection b must be the
 * fixture: `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { chQuery, connById } from "../lib/ch.ts";
import { PatientLevelResolver, lollipopTypesSql, type LollipopOql } from "../lib/federation.ts";
import { resolveDrivers, type DriverSettings } from "../lib/driver-settings.ts";
import { canonicalType, cellOf, impactType, IMPACT_TYPES, type ImpactType } from "../lib/lollipop.ts";
import type { CohortDef } from "../lib/types.ts";

const STUDY = "cbiolab_peer_fixture";
/** peer-db.ts stores the fixture's OncoKB calls under this version (and the app's pin) */
const PIN = "fixture";
/** and its Genome Nexus records under this release */
const PINS = { hg19: "fixture", hg38: null };
process.env.GENOME_NEXUS_PIN = "fixture";
process.env.GENOME_NEXUS_GRCH38_PIN = "fixture";

let failures = 0, checks = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  checks++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

const conn = connById("b");
if (!conn) { console.log("FAIL connection b is not configured (npm run peer-db prints its CLICKHOUSE2_* lines)"); process.exit(1); }
const db = conn.db;
const resolver = (pin: string | null) =>
  new PatientLevelResolver(STUDY, { oncokbPin: pin }, { id: conn.id, mode: "patient-level", label: "fixture", conn });
const WHOLE: CohortDef = { all: [] };
const OFF: DriverSettings = { oncokb: false, hotspots: false, custom: false, tiers: [] };

type Tally = Record<ImpactType, { driver: number; vus: number }>;
const emptyTally = (): Tally => Object.fromEntries(IMPACT_TYPES.map((k) => [k, { driver: 0, vus: 0 }])) as Tally;
const fill = (rows: { gene: string; mtype: string; driver: boolean; rows: number }[], gene: string): Tally => {
  const t = emptyTally();
  for (const r of rows) {
    if (r.gene !== gene) continue;
    const [k, col] = cellOf(impactType(canonicalType(r.mtype)), r.driver).split(".") as [ImpactType, "driver" | "vus"];
    t[k][col] += r.rows;
  }
  return t;
};
/** the grid's tally of lollipopTypesSql's rows, with `drivers` (undefined: the argument left out) */
const tallyOf = async (gene: string, drivers: DriverSettings | undefined, pin: string | null = PIN): Promise<Tally | string> => {
  try {
    const cohort = String(resolver(pin).cohortSql(WHOLE));
    const sql = drivers === undefined
      ? lollipopTypesSql(cohort, [gene], STUDY, 1, pin, db, PINS)
      : lollipopTypesSql(cohort, [gene], STUDY, 1, pin, db, PINS, undefined, undefined, resolveDrivers(drivers));
    const rows = (await chQuery<{ gene: string; mtype: string; driver: number | string; rows: number | string }>(sql, conn)).data;
    return fill(rows.map((r) => ({ gene: String(r.gene), mtype: String(r.mtype), driver: Number(r.driver) === 1, rows: Number(r.rows) })), gene);
  } catch (e) { return "error: " + String((e as Error).message).slice(0, 200); }
};
type Want = Partial<Record<ImpactType, [number, number]>>;
const show = (t: Tally) => IMPACT_TYPES.filter((k) => t[k].driver || t[k].vus).map((k) => k + " " + t[k].driver + "/" + t[k].vus).join(", ") || "empty";
const same = (t: Tally, want: Want) => IMPACT_TYPES.every((k) => t[k].driver === (want[k]?.[0] ?? 0) && t[k].vus === (want[k]?.[1] ?? 0));
const tallyCase = async (tag: string, gene: string, drivers: DriverSettings | undefined, want: Want, pin: string | null = PIN) => {
  const got = await tallyOf(gene, drivers, pin);
  const w = IMPACT_TYPES.filter((k) => want[k]).map((k) => k + " " + want[k]![0] + "/" + want[k]![1]).join(", ");
  ok(`${tag} ${gene} drivers ${drivers === undefined ? "(omitted)" : JSON.stringify(drivers)}: driver/VUS ${w}`,
    typeof got !== "string" && same(got, want), typeof got === "string" ? got : "got " + show(got));
  return got;
};

// the fixture holds what the cases are about
const raw = (await chQuery<{ gene: string; pc: string; n: number }>(
  "SELECT `GENE.hugoGeneSymbol` AS gene, proteinChange AS pc, count() AS n FROM " + db + ".mutation_derived WHERE studyId = '" + STUDY + "'" +
  " AND `GENE.hugoGeneSymbol` IN ('PIK3CA', 'KRAS', 'ALK', 'BRAF') GROUP BY gene, pc", conn)).data;
const rowsOf = (g: string, pc?: string) => raw.filter((r) => r.gene === g && (!pc || r.pc === pc)).reduce((n, r) => n + Number(r.n), 0);
ok("fixture: PIK3CA E545K x4, H1047R x1, E110del x1; KRAS 24 rows; ALK no mutation; BRAF 4 rows, G469A once",
  rowsOf("PIK3CA", "E545K") === 4 && rowsOf("PIK3CA", "H1047R") === 1 && rowsOf("PIK3CA", "E110del") === 1 && rowsOf("PIK3CA") === 6 &&
  rowsOf("KRAS") === 24 && rowsOf("ALK") === 0 && rowsOf("BRAF") === 4 && rowsOf("BRAF", "G469A") === 1, JSON.stringify(raw));

// ---- F1: the defaults call H1047R (a hotspot) a driver, as with the argument left out
const PIK_ALL: Want = { missense: [5, 0], inframe: [1, 0] };
const f1 = await tallyCase("F1 defaults", "PIK3CA", {}, PIK_ALL);
const f1o = await tallyCase("F1 omitted (OncoKB or hotspot, today's rule)", "PIK3CA", undefined, PIK_ALL);
ok("F1 the defaults' tally is the omitted argument's", typeof f1 !== "string" && typeof f1o !== "string" && show(f1) === show(f1o));

// ---- F2: hotspots off: peer-oncokb.tsv has no PIK3CA H1047R (nor E110del), so both are VUS
await tallyCase("F2 hotspots off", "PIK3CA", { hotspots: false }, { missense: [4, 1], inframe: [0, 1] });

// ---- F3: OncoKB off: E545K (OncoKB Oncogenic, no hotspot) is VUS; the hotspots stay drivers
await tallyCase("F3 OncoKB off", "PIK3CA", { oncokb: false }, { missense: [1, 4], inframe: [1, 0] });
await tallyCase("F3 defaults: KRAS's OncoKB calls", "KRAS", {}, { missense: [24, 0] });
await tallyCase("F3 OncoKB off: every KRAS row (OncoKB-called, no hotspot) VUS", "KRAS", { oncokb: false }, { missense: [0, 24] });

// ---- F4: fusions: OncoKB calls the EML4-ALK pair; with it off no source calls a fusion
await tallyCase("F4 defaults: the EML4-ALK fusions drivers", "ALK", {}, { fusion: [6, 0] });
await tallyCase("F4 hotspots off: still OncoKB's drivers", "ALK", { hotspots: false }, { fusion: [6, 0] });
await tallyCase("F4 OncoKB off: every EML4-ALK fusion VUS", "ALK", { oncokb: false }, { fusion: [0, 6] });

// ---- F5: every source off: no VUS in any class; each class's driver count is its rows
await tallyCase("F5 every source off", "PIK3CA", OFF, PIK_ALL);
await tallyCase("F5 every source off", "KRAS", OFF, { missense: [24, 0] });
await tallyCase("F5 every source off", "ALK", OFF, { fusion: [6, 0] });
await tallyCase("F5 defaults: BRAF G469A (no source calls it) VUS", "BRAF", {}, { missense: [3, 1], fusion: [1, 0] });
await tallyCase("F5 every source off: BRAF G469A counted with the drivers", "BRAF", OFF, { missense: [4, 0], fusion: [1, 0] });
await tallyCase("F5 every source off, no pin", "PIK3CA", OFF, PIK_ALL, null);

// ---- R: the report's `annotated`, and its tally, through lollipopCounts
type Counts = (def: CohortDef, genes: string[], minCount?: number, oql?: LollipopOql, drivers?: DriverSettings) =>
  Promise<{ annotated: boolean; drivers?: DriverSettings; types: { gene: string; mtype: string; driver: boolean; rows: number }[];
    changes: { gene: string }[]; totals: { gene: string; patients: number; pairs: number; somaticSamples: number }[] }>;
const report = async (pin: string | null, gene: string, drivers?: DriverSettings, oql?: LollipopOql) => {
  try {
    const r = resolver(pin);
    return await (r.lollipopCounts as unknown as Counts).call(r, WHOLE, [gene], 1, oql, drivers);
  } catch (e) { return "error: " + String((e as Error).message).slice(0, 200); }
};
const annotatedCase = async (tag: string, pin: string | null, drivers: DriverSettings | undefined, want: boolean, gene = "PIK3CA") => {
  const r = await report(pin, gene, drivers);
  ok(`${tag} pin ${pin ?? "none"} drivers ${drivers === undefined ? "(omitted)" : JSON.stringify(drivers)}: annotated ${want}`,
    typeof r !== "string" && r.annotated === want, typeof r === "string" ? r : "annotated " + r.annotated);
  return r;
};
await annotatedCase("R1 omitted, as today", PIN, undefined, true);
await annotatedCase("R2 defaults", PIN, {}, true);
const r3 = await annotatedCase("R3 every source off", PIN, OFF, false);
if (typeof r3 !== "string") {
  const t = fill(r3.types, "PIK3CA");
  ok("R3/F5 the report's tally with every source off: every row a driver", same(t, PIK_ALL), show(t));
}
await annotatedCase("R4 OncoKB alone, not offered (no pin)", null, { oncokb: true, hotspots: false, custom: false, tiers: [] }, false);
const r5 = await annotatedCase("R5 custom calls alone, the study holding none", null, { oncokb: false, hotspots: false, custom: true, tiers: [] }, false);
if (typeof r5 !== "string") {
  const t = fill(r5.types, "PIK3CA");
  ok("R5 the report's tally with custom calls alone: every row a driver (one badge per type)", same(t, PIK_ALL), show(t));
}
await annotatedCase("R5 custom calls alone, with a pin", PIN, { oncokb: false, hotspots: false, custom: true, tiers: [] }, false);
await annotatedCase("R5 the defaults with OncoKB and hotspots off", PIN, { oncokb: false, hotspots: false }, false);
const tiers = (await chQuery<{ n: number }>("SELECT countIf(ifNull(driverTiersFilter, '') != '') AS n FROM " + db +
  ".mutation_derived WHERE studyId = '" + STUDY + "' AND `GENE.hugoGeneSymbol` = 'PIK3CA'", conn)).data;
ok("R6 fixture: no PIK3CA row has a driverTiersFilter", Number(tiers[0]?.n) === 0, String(tiers[0]?.n));
await annotatedCase("R6 every tier (tiers omitted), no tier in the data", PIN, { oncokb: false, hotspots: false, custom: false }, false);
const r1 = await report(PIN, "PIK3CA", {});
if (typeof r1 !== "string") {
  const t = fill(r1.types, "PIK3CA");
  ok("F1 the report's tally with the defaults", same(t, PIK_ALL), show(t));
}
const r2 = await report(PIN, "PIK3CA", { hotspots: false });
if (typeof r2 !== "string") {
  const t = fill(r2.types, "PIK3CA");
  ok("F2 the report's tally with hotspots off", same(t, { missense: [4, 1], inframe: [0, 1] }), show(t));
}

// ---- B1: OncoKB and hotspots off, the study's own calls and tiers on (it holds none): not annotated,
// no VUS in any class, each class's driver count its rows — through the SQL and through the report
const NO_STORES: DriverSettings = { oncokb: false, hotspots: false };
const KRAS_ALL: Want = { missense: [24, 0] };
await tallyCase("B1 OncoKB and hotspots off", "KRAS", NO_STORES, KRAS_ALL);
await tallyCase("B1 OncoKB and hotspots off", "PIK3CA", NO_STORES, PIK_ALL);
for (const [gene, want] of [["KRAS", KRAS_ALL], ["PIK3CA", PIK_ALL]] as const) {
  const r = await annotatedCase("B1 OncoKB and hotspots off, " + gene, PIN, NO_STORES, false, gene);
  if (typeof r !== "string") {
    const t = fill(r.types, gene);
    ok("B1 the report's " + gene + " tally with OncoKB and hotspots off: vus 0, driver the rows", same(t, want), show(t));
    ok("B1 the report echoes the settings it applied", JSON.stringify(r.drivers) === JSON.stringify(NO_STORES), JSON.stringify(r.drivers));
  }
}

// ---- B3: hotspots the only source and a line that keeps drivers: the totals (patients, pairs,
// somatic samples) count the rows the stems and the tally count. EML4 has no mutation and is site 1
// of the 6 EML4-ALK fusions, which no hotspot calls: "EML4: DRIVER" keeps nothing, so its totals are 0
// (they were 6 somatic samples when the totals filed every row a driver). The line's drivers are the
// view's (lib/views/shared.ts viewOql passes them on).
const HOT_ONLY: DriverSettings = { oncokb: false, custom: false, tiers: [] };
const totalsOf = (r: Exclude<Awaited<ReturnType<typeof report>>, string>, gene: string) => {
  const t = r.totals.find((x) => x.gene === gene);
  return { patients: t?.patients ?? 0, pairs: t?.pairs ?? 0, somaticSamples: t?.somaticSamples ?? 0 };
};
const totalsCase = async (tag: string, gene: string, line: string, want: { stems: number; tally: Want; patients: number; pairs: number; somaticSamples: number }) => {
  const r = await report(PIN, gene, HOT_ONLY, { lines: [line], drivers: HOT_ONLY });
  if (typeof r === "string") { ok(tag, false, r); return; }
  const t = fill(r.types, gene), tot = totalsOf(r, gene), stems = r.changes.filter((c) => c.gene === gene).length;
  ok(`${tag} ${gene}, hotspots alone, "${line}": ${want.stems} stems, tally ${show({ ...emptyTally(), ...Object.fromEntries(Object.entries(want.tally).map(([k, [d, v]]) => [k, { driver: d, vus: v }])) })}`,
    stems === want.stems && same(t, want.tally), "stems " + stems + ", tally " + show(t));
  ok(`${tag} ${gene} the totals agree: ${want.patients} patients, ${want.pairs} pairs, ${want.somaticSamples} somatic samples`,
    tot.patients === want.patients && tot.pairs === want.pairs && tot.somaticSamples === want.somaticSamples, JSON.stringify(tot));
};
await totalsCase("B3 no fusion is a driver:", "EML4", "EML4: DRIVER", { stems: 0, tally: {}, patients: 0, pairs: 0, somaticSamples: 0 });
// BRAF: D594G (a hotspot) on FX-P29-T1 is the one driver; its fusion's site 1 is KIAA1549
await totalsCase("B3 one hotspot kept:", "BRAF", "BRAF: DRIVER", { stems: 1, tally: { missense: [1, 0] }, patients: 1, pairs: 1, somaticSamples: 1 });
// a FUSION_DRIVER line alone does not narrow (doesQueryContainMutationOQL): ALK's 6 fusions stay, as
// VUS; ALK is their site 2, so they add no somatic sample to ALK
await totalsCase("B3 a fusion line alone:", "ALK", "ALK: FUSION_DRIVER", { stems: 0, tally: { fusion: [0, 6] }, patients: 0, pairs: 0, somaticSamples: 0 });

console.log(`\n${checks - failures}/${checks} mutation driver settings checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
