/**
 * Live check: the mutation table's search and column filters narrow the lollipop and its badges
 * (MUT-TB-3, MUT-FM-1, MUT-FM-3, MUT-STM-4), run against the committed fixture study on connection b
 * through PatientLevelResolver.lollipopCounts with `rows` (the table's query for one gene), over the
 * whole study. Row ids are the spec table's (F1-F10).
 *
 * Each expected number is written down by hand from the fixture files (test/fixtures/peer-study,
 * data_mutations.txt line numbers); only "the same as with `rows` left out" is compared at run time.
 *   KRAS (24 Missense rows, every one OncoKB Oncogenic in peer-oncokb.tsv, centre FIXTURE on all):
 *     G12C lines 2,3,21,31,43,57 (FX-P01-T1, FX-P01-T2, P06, P10, P11, P16): 6 rows, 5 patients
 *     G12D lines 5,6,25,46,60 (FX-P02-T1, FX-P02-T2, P07, P12, P17): 5 rows, 4 patients
 *     G12V lines 9,10,28,49,63: 5 rows, 4 patients; G13D lines 14,15,29,52,67: 5 rows, 4 patients
 *     Q61H lines 18 (FX-P05-T1), 54, 71: 3 rows, 3 patients
 *     totals: patients FX-P01..FX-P20 = 20; (patient, change) pairs 20; somatic samples 24.
 *     FX-P05-T1 carries one KRAS mutation, Q61H (line 18).
 *   PIK3CA: E545K x4 (lines 8,35,58,65), H1047R (line 140, Missense) and E110del (line 141,
 *     In_Frame_Del) on FX-P29-T1. E110del is a hotspot (peer-hotspots.tsv) so a driver. The Mutation
 *     Type column's text is the portal's label (lib/mutation-type.ts: In_Frame_Del -> "IF del").
 *   TP53: R175H lines 11,30,55,72,93 (FX-P03,P09,P15,P21,P30): 5 rows, 5 patients, OncoKB Oncogenic.
 *     Line 4, R273H on FX-P01-T1, is the one row whose Center is "broad.mit.edu" (data_mutations.txt
 *     column 3), a column the table hides by default.
 *   STK11: X200_splice twice on FX-P29-T1, lines 145 (Splice_Site, 19:1221319 G>A) and 146 (Splice_Region,
 *     19:1221320 G>T), both Cancer Hotspots (peer-hotspots.tsv lines 8, 9), so drivers: one stem 1/2.
 *     The fixture's only change called twice in one sample; the two differ in type as well as position.
 *   ALK: no mutation; 6 "EML4-ALK Fusion" rows (data_sv.txt lines 2-7, FX-P45-T1..FX-P49-T2, two of
 *     them FX-P49-T1 and FX-P49-T2), drivers by the pair's OncoKB call (peer-oncokb-sv.tsv).
 *
 * Run: node --env-file=.env.local scripts/check-mutation-search-lollipop.ts (connection b must be the
 * fixture: `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { connById } from "../lib/ch.ts";
import { PatientLevelResolver } from "../lib/federation.ts";
import { canonicalType, cellOf, impactType, IMPACT_TYPES, type ImpactType } from "../lib/lollipop.ts";
import type { CohortDef } from "../lib/types.ts";

const STUDY = "cbiolab_peer_fixture";
/** peer-db.ts stores the fixture's OncoKB calls under this version (and the app's pin) */
const PIN = "fixture";
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
const WHOLE: CohortDef = { all: [] };

type Rows = { gene: string; search?: string; filters?: Record<string, unknown>; columns?: string[] };
type Report = {
  changes: { gene: string; pos: number | null; change: string; n: number; rows: number; driver: boolean }[];
  types: { gene: string; pos: number | null; mtype: string; driver: boolean; rows: number }[];
  totals: { gene: string; patients: number; pairs: number; somaticSamples: number }[];
  cohortSamples: number;
};
type Counts = (def: CohortDef, genes: string[], minCount?: number, oql?: undefined, rows?: Rows) => Promise<Report>;
const report = async (genes: string[], rows?: Rows): Promise<Report | string> => {
  try {
    const r = new PatientLevelResolver(STUDY, { oncokbPin: PIN }, { id: conn.id, mode: "patient-level", label: "fixture", conn });
    return await (r.lollipopCounts as unknown as Counts).call(r, WHOLE, genes, 1, undefined, rows);
  } catch (e) { return "error: " + String((e as Error).message).slice(0, 300); }
};

type Tally = Record<ImpactType, { driver: number; vus: number }>;
const tallyOf = (rep: Report, gene: string): Tally => {
  const t = Object.fromEntries(IMPACT_TYPES.map((k) => [k, { driver: 0, vus: 0 }])) as Tally;
  for (const r of rep.types) {
    if (r.gene !== gene) continue;
    const [k, col] = cellOf(impactType(canonicalType(r.mtype)), r.driver).split(".") as [ImpactType, "driver" | "vus"];
    t[k][col] += r.rows;
  }
  return t;
};
type Want = Partial<Record<ImpactType, [number, number]>>;
const showTally = (t: Tally) => IMPACT_TYPES.filter((k) => t[k].driver || t[k].vus).map((k) => k + " " + t[k].driver + "/" + t[k].vus).join(", ") || "empty";
const showWant = (w: Want) => IMPACT_TYPES.filter((k) => w[k]).map((k) => k + " " + w[k]![0] + "/" + w[k]![1]).join(", ") || "empty";
const sameTally = (t: Tally, w: Want) => IMPACT_TYPES.every((k) => t[k].driver === (w[k]?.[0] ?? 0) && t[k].vus === (w[k]?.[1] ?? 0));
/** a gene's stems as "change@pos n/rows driver|vus", sorted */
const stems = (rep: Report, gene: string) => rep.changes.filter((c) => c.gene === gene)
  .map((c) => c.change + "@" + c.pos + " " + c.n + "/" + c.rows + " " + (c.driver ? "driver" : "vus")).sort();
const totalsOf = (rep: Report, gene: string) => {
  const t = rep.totals.find((x) => x.gene === gene);
  return t ? { patients: t.patients, pairs: t.pairs, somaticSamples: t.somaticSamples } : { patients: 0, pairs: 0, somaticSamples: 0 };
};
/** everything the report says of a gene, in a stable order */
const whole = (rep: Report, gene: string) => JSON.stringify({ stems: stems(rep, gene), tally: showTally(tallyOf(rep, gene)), totals: totalsOf(rep, gene),
  types: rep.types.filter((t) => t.gene === gene).map((t) => [t.pos, t.mtype, t.driver, t.rows].join(":")).sort() });

/** the report of `rows`, against hand-derived stems and tally, with totals and cohort size as with `rows` omitted */
const narrowed = async (tag: string, genes: string[], rows: Rows, gene: string, want: { stems: string[]; tally: Want }, base: Report | string) => {
  const rep = await report(genes, rows);
  const label = `${tag} ${gene} rows ${JSON.stringify(rows)}`;
  if (typeof rep === "string") { ok(label + ": answered", false, rep); return rep; }
  const s = stems(rep, gene);
  ok(label + ": stems " + (want.stems.join(", ") || "none"), JSON.stringify(s) === JSON.stringify([...want.stems].sort()), "got " + (s.join(", ") || "none"));
  const t = tallyOf(rep, gene);
  ok(label + ": tally " + showWant(want.tally), sameTally(t, want.tally), "got " + showTally(t));
  if (typeof base !== "string") {
    ok(label + ": totals as with rows omitted", JSON.stringify(totalsOf(rep, gene)) === JSON.stringify(totalsOf(base, gene)),
      JSON.stringify(totalsOf(rep, gene)) + " vs " + JSON.stringify(totalsOf(base, gene)));
    ok(label + ": cohort samples as with rows omitted", rep.cohortSamples === base.cohortSamples, rep.cohortSamples + " vs " + base.cohortSamples);
  }
  return rep;
};
const identical = async (tag: string, genes: string[], rows: Rows, gene: string, base: Report | string) => {
  const rep = await report(genes, rows);
  const label = `${tag} ${gene} rows ${JSON.stringify(rows)}: identical to rows omitted`;
  if (typeof rep === "string" || typeof base === "string") { ok(label, false, typeof rep === "string" ? rep : String(base)); return; }
  ok(label, whole(rep, gene) === whole(base, gene), whole(rep, gene));
};

// ---- the fixture holds what the cases are about (rows omitted, against the hand counts)
const KRAS_ALL = ["G12C@12 5/6 driver", "G12D@12 4/5 driver", "G12V@12 4/5 driver", "G13D@13 4/5 driver", "Q61H@61 3/3 driver"];
const kras = await report(["KRAS"]);
const pik = await report(["PIK3CA"]);
const alk = await report(["ALK"]);
const tp53 = await report(["TP53"]);
const both = await report(["KRAS", "TP53"]);
for (const [g, r] of [["KRAS", kras], ["PIK3CA", pik], ["ALK", alk], ["TP53", tp53], ["KRAS+TP53", both]] as const)
  ok("fixture: the " + g + " lollipop with rows omitted answers", typeof r !== "string", typeof r === "string" ? r : "");
if (typeof kras !== "string") {
  ok("fixture: KRAS stems " + KRAS_ALL.join(", "), JSON.stringify(stems(kras, "KRAS")) === JSON.stringify(KRAS_ALL), stems(kras, "KRAS").join(", "));
  ok("fixture: KRAS tally missense 24/0", sameTally(tallyOf(kras, "KRAS"), { missense: [24, 0] }), showTally(tallyOf(kras, "KRAS")));
  ok("fixture: KRAS totals 20 patients, 20 pairs, 24 somatic samples",
    JSON.stringify(totalsOf(kras, "KRAS")) === JSON.stringify({ patients: 20, pairs: 20, somaticSamples: 24 }), JSON.stringify(totalsOf(kras, "KRAS")));
}
if (typeof pik !== "string")
  ok("fixture: PIK3CA stems E545K 4/4, H1047R 1/1, E110del 1/1; tally missense 5/0, inframe 1/0",
    JSON.stringify(stems(pik, "PIK3CA")) === JSON.stringify(["E110del@110 1/1 driver", "E545K@545 4/4 driver", "H1047R@1047 1/1 driver"]) &&
    sameTally(tallyOf(pik, "PIK3CA"), { missense: [5, 0], inframe: [1, 0] }), stems(pik, "PIK3CA").join(", ") + "; " + showTally(tallyOf(pik, "PIK3CA")));
if (typeof alk !== "string")
  ok("fixture: ALK no stem, tally fusion 6/0", stems(alk, "ALK").length === 0 && sameTally(tallyOf(alk, "ALK"), { fusion: [6, 0] }), showTally(tallyOf(alk, "ALK")));
if (typeof tp53 !== "string")
  ok("fixture: TP53 has R175H 5/5 among its stems", stems(tp53, "TP53").includes("R175H@175 5/5 driver"), stems(tp53, "TP53").join(", "));

// ---- F1, F2: a protein change, in either case
const G12D = { stems: ["G12D@12 4/5 driver"], tally: { missense: [5, 0] } as Want };
await narrowed("F1", ["KRAS"], { gene: "KRAS", search: "G12D" }, "KRAS", G12D, kras);
await narrowed("F2", ["KRAS"], { gene: "KRAS", search: "g12d" }, "KRAS", G12D, kras);

// ---- F3: a sample id carrying one KRAS mutation
await narrowed("F3", ["KRAS"], { gene: "KRAS", search: "FX-P05-T1" }, "KRAS", { stems: ["Q61H@61 1/1 driver"], tally: { missense: [1, 0] } }, kras);

// ---- F4: a Mutation Type value filter, spelled as the column shows it
await narrowed("F4", ["PIK3CA"], { gene: "PIK3CA", filters: { mutationType: { values: ["IF del"] } } }, "PIK3CA",
  { stems: ["E110del@110 1/1 driver"], tally: { inframe: [1, 0] } }, pik);

// ---- F5, F6: the grid's and the stems' own filters do not narrow the lollipop
await identical("F5", ["KRAS"], { gene: "KRAS", filters: { alteration: { values: ["Missense · VUS"] } } }, "KRAS", kras);
await identical("F6", ["KRAS"], { gene: "KRAS", filters: { proteinPos: { values: ["12"] } } }, "KRAS", kras);

// ---- F7: fusion rows are narrowed too
await narrowed("F7", ["ALK"], { gene: "ALK", search: "EML4-ALK" }, "ALK", { stems: [], tally: { fusion: [6, 0] } }, alk);
await narrowed("F7 (two of the six fusions)", ["ALK"], { gene: "ALK", search: "FX-P49" }, "ALK", { stems: [], tally: { fusion: [2, 0] } }, alk);
await narrowed("F7 (no fusion matches)", ["ALK"], { gene: "ALK", search: "zzzz-no-match" }, "ALK", { stems: [], tally: {} }, alk);

// ---- F8: nothing matches
await narrowed("F8", ["KRAS"], { gene: "KRAS", search: "zzzz-no-match" }, "KRAS", { stems: [], tally: {} }, kras);

// ---- F9: search reads the shown columns only; Center is hidden by default
await narrowed("F9 Center hidden", ["TP53"], { gene: "TP53", search: "broad.mit.edu" }, "TP53", { stems: [], tally: {} }, tp53);
await narrowed("F9 Center shown", ["TP53"], { gene: "TP53", search: "broad.mit.edu",
  columns: ["sample", "cancerType", "proteinChange", "annotation", "mutationType", "mutCount", "center"] }, "TP53",
{ stems: ["R273H@273 1/1 driver"], tally: { missense: [1, 0] } }, tp53);
await narrowed("F9 Center hidden", ["KRAS"], { gene: "KRAS", search: "FIXTURE" }, "KRAS", { stems: [], tally: {} }, kras);
await identical("F9 Center shown (every KRAS row's centre is FIXTURE)", ["KRAS"], { gene: "KRAS", search: "FIXTURE",
  columns: ["sample", "proteinChange", "center"] }, "KRAS", kras);

// ---- F10: rows name one of the view's genes; the other is left whole
await identical("F10 the other gene", ["KRAS", "TP53"], { gene: "TP53", search: "R175H" }, "KRAS", both);
await narrowed("F10 the named gene", ["KRAS", "TP53"], { gene: "TP53", search: "R175H" }, "TP53", { stems: ["R175H@175 5/5 driver"], tally: { missense: [5, 0] } }, both);

// ---- K: the narrowing matches rows by (sample, change, type, position and alleles); two calls of one change in one sample
const stk = await report(["STK11"]);
if (typeof stk !== "string")
  ok("fixture: STK11 X200_splice 1/2 (lines 145, 146); tally splice 2/0", stems(stk, "STK11").includes("X200_splice@200 1/2 driver") &&
    tallyOf(stk, "STK11").splice.driver === 2, stems(stk, "STK11").join(", ") + "; " + showTally(tallyOf(stk, "STK11")));
await narrowed("K one of two calls by its Start Pos", ["STK11"], { gene: "STK11", search: "1221320", columns: ["sample", "proteinChange", "start"] }, "STK11",
  { stems: ["X200_splice@200 1/1 driver"], tally: { splice: [1, 0] } }, stk);

console.log(`\n${checks - failures}/${checks} mutation search lollipop checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
