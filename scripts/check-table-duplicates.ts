/**
 * Live check: duplicate counts in the Mutations and Structural Variants tables (MUT-TB-1, MUT-STM-14,
 * MUT-MD-5, SV-TB-1, SV-STM-1, SV-MD-7), run against the committed fixture study on connection b
 * through the views' runners (lib/views/mutations/run.ts runMutations, lib/views/sv/run.ts runSv) over
 * the whole study. Row ids are the spec table's (D2-D4).
 *
 * The portal's rule (cbioportal-frontend cd8c6df): mutations grouped by gene, patient and protein
 * change (MutationUtils.tsx 162-189), SVs by patient and both breakpoints (ResultsViewStructural
 * VariantMapperDataStore.ts 34-50); duplicates = the sum of (group size - 1), over every row of the
 * tab's table, not the searched ones. Each expected number is written down by hand from
 * test/fixtures/peer-study (data_mutations.txt / data_sv.txt line numbers; a sample's patient from
 * data_clinical_sample.txt, FX-Pnn-T1 and -T2 both FX-Pnn):
 *   KRAS (24 rows, lines 2-71): G12C lines 2,3 (FX-P01-T1, FX-P01-T2), G12D lines 5,6 (FX-P02-T1/T2),
 *     G12V lines 9,10 (FX-P03-T1/T2), G13D lines 14,15 (FX-P04-T1/T2); every other KRAS row is a
 *     patient's only one: 4 groups of 2, so 4 duplicates. FX-P01-T1's only KRAS row is line 2.
 *   EGFR: L858R lines 128,129 (FX-P43-T1, FX-P43-T2): 1. FX-P44's rows (130-138) are one sample's,
 *     each change once (line 134's germline L858R is FX-P44's only L858R).
 *   STK11: X200_splice lines 145,146, both FX-P29-T1 (one sample, two calls of one change): the
 *     portal's key has no sample, so 1.
 *   TP53 (21 rows): no patient carries a change twice (FX-P21: R175H, SP1, SP2; FX-P24: R248Q, SP9;
 *     FX-P30: R175H, SP14): 0, so no `duplicates`.
 *   ALK, mutations table: no mutation; the 6 EML4-ALK fusions of data_sv.txt (lines 2-7) are rows
 *     whose Protein Change is "EML4-ALK Fusion"; FX-P49-T1 and FX-P49-T2 (lines 6,7) share it: 1.
 *   ALK, sv table: the same 6 rows, all at 2:42522656 / 2:29446394, on FX-P45..FX-P48 once each and
 *     FX-P49 twice (lines 6,7): 1 duplicate, 6 rows.
 *   FGFR2, sv: one row (line 8, FX-P46-T1): none. BRCA2, sv: lines 9 (FX-P50-T1) and 20 (FX-P51-T1,
 *     germline), two patients: none.
 *   RET + TTN, sv: lines 15 (FX-P52-T1 KIF5B-RET, 10:32317000 / 10:43610000) and 16 (FX-P52-T1
 *     TTN-MUC16, 2:179400000 / 19:9000000): one patient, two rows at different breakpoints: none, 2
 *     rows. With TMPRSS2 too: line 22 (FX-P52-T1 MESDC2-TMPRSS2, 15:81280000 / 21:42870000) and line
 *     18 (FX-P53-T1 TMPRSS2-ERG): FX-P52-T1's three rows all differ, so none, 4 rows.
 *
 * Run: node --env-file=.env.local scripts/check-table-duplicates.ts (connection b must be the
 * fixture: `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { connById } from "../lib/ch.ts";
import { PatientLevelResolver } from "../lib/federation.ts";
import { runMutations } from "../lib/views/mutations/run.ts";
import { runSv } from "../lib/views/sv/run.ts";
import type { ViewRun } from "../lib/views/run.ts";
import type { CohortDef } from "../lib/types.ts";

const STUDY = "cbiolab_peer_fixture";

// Genome Nexus's stored release is read at the fixture's pin; the protein is asked of an address
// that refuses at once, so nothing leaves the machine
process.env.GENOME_NEXUS_PIN = "fixture";
process.env.GENOME_NEXUS_GRCH38_PIN = "fixture";
process.env.GENOME_NEXUS_URL = "http://127.0.0.1:9";

let failures = 0, checks = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  checks++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

const conn = connById("b");
if (!conn) { console.log("FAIL connection b is not configured (npm run peer-db prints its CLICKHOUSE2_* lines)"); process.exit(1); }

const resolver = new PatientLevelResolver(STUDY, { oncokbPin: null }, { id: conn.id, mode: "patient-level", label: "fixture", conn });
const WHOLE: CohortDef = { all: [] };
const ctx = (): ViewRun => ({
  doc: { study: STUDY, cohorts: { c: WHOLE }, views: [] },
  cohorts: { c: { studies: [STUDY], perStudy: {} } },
  resolvers: { [STUDY]: resolver },
  vNames: ["c"], vStudies: [STUDY],
  participationFor: () => ({}),
  pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
} as unknown as ViewRun);

type Table = { duplicates?: number; total: number; all: number };
const answer = async (run: () => Promise<unknown>, key: "mutations" | "sv"): Promise<Table | string> => {
  try {
    const res = await run() as Record<string, unknown> & { result?: Record<string, unknown> };
    const r = (res.result ?? res) as Record<string, unknown>;
    const t = r[key] as Table | undefined;
    return t || "refused: " + String(r.error || JSON.stringify(r).slice(0, 200));
  } catch (e) { return "threw: " + String((e as Error).message).slice(0, 200); }
};
const mutations = (gene: string, search?: string) =>
  answer(() => runMutations({ kind: "mutations", gene, cohorts: ["c"], ...(search ? { search } : {}) }, ctx()), "mutations");
const sv = (genes: string[], search?: string) =>
  answer(() => runSv({ kind: "sv", genes, cohorts: ["c"], ...(search ? { search } : {}) } as never, ctx()), "sv");

/** a table's duplicates (absent when `want` is undefined), and its total and all when given */
const check = (label: string, t: Table | string, want: { duplicates?: number; total?: number; all?: number }) => {
  if (typeof t === "string") { ok(label + ": answered", false, t); return; }
  const has = Object.prototype.hasOwnProperty.call(t, "duplicates");
  ok(label + ": duplicates " + (want.duplicates === undefined ? "absent" : want.duplicates), want.duplicates === undefined ? !has : t.duplicates === want.duplicates,
    has ? "got " + String(t.duplicates) : "absent");
  if (want.total !== undefined) ok(label + ": total " + want.total, t.total === want.total, "got " + t.total);
  if (want.all !== undefined) ok(label + ": all " + want.all, t.all === want.all, "got " + t.all);
};

// ---- D2: the mutations view's duplicates over a gene's rows
check("D2 KRAS (FX-P01..P04, T1 and T2 each: lines 2/3, 5/6, 9/10, 14/15)", await mutations("KRAS"), { duplicates: 4, total: 24, all: 24 });
check("D2 EGFR (FX-P43-T1/T2 L858R, lines 128/129)", await mutations("EGFR"), { duplicates: 1 });
check("D2 STK11 (X200_splice twice on FX-P29-T1, lines 145/146)", await mutations("STK11"), { duplicates: 1 });
check("D2 ALK fusion rows (EML4-ALK Fusion on FX-P49-T1/T2, data_sv.txt lines 6/7)", await mutations("ALK"), { duplicates: 1, all: 6 });
check("D2 TP53 (no change twice in a patient)", await mutations("TP53"), {});

// ---- D3: a search that keeps one of a pair leaves duplicates as they were
check("D3 KRAS search FX-P01-T1 (line 2 only)", await mutations("KRAS", "FX-P01-T1"), { duplicates: 4, total: 1, all: 24 });
check("D3 KRAS search G12C (lines 2,3,21,31,43,57)", await mutations("KRAS", "G12C"), { duplicates: 4, total: 6, all: 24 });
check("D3 sv ALK search FX-P49-T2 (line 7 only)", await sv(["ALK"], "FX-P49-T2"), { duplicates: 1, total: 1, all: 6 });

// ---- D4: the sv view's duplicates: the same breakpoints in one patient's two samples
check("D4 sv ALK (FX-P49-T1/T2 at 2:42522656 / 2:29446394, lines 6/7)", await sv(["ALK"]), { duplicates: 1, total: 6, all: 6 });
check("D4 sv FGFR2 (one row)", await sv(["FGFR2"]), { all: 1 });
check("D4 sv BRCA2 (FX-P50 and FX-P51, two patients)", await sv(["BRCA2"]), { all: 2 });
check("D4 sv RET, TTN (FX-P52-T1 twice at different breakpoints, lines 15/16)", await sv(["RET", "TTN"]), { all: 2 });
check("D4 sv RET, TTN, TMPRSS2 (FX-P52-T1 three times at different breakpoints, lines 15/16/22; FX-P53-T1 line 18)", await sv(["RET", "TTN", "TMPRSS2"]), { all: 4 });

console.log(`\n${checks - failures}/${checks} table duplicate checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
