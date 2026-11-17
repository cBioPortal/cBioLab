/**
 * Live check: the samples and patients of a filtered mutation table (MUT-FM-5, MUT-STM-16), run
 * against the committed fixture study on connection b through the mutations view's runner
 * (lib/views/mutations/run.ts runMutations) over the whole study. Row ids are the spec table's (U3-U5).
 *
 * The portal's rule (cbioportal-frontend cd8c6df): n, m = the distinct sampleIds and patientIds
 * among the table's shown rows, said only when the rows shown are fewer than all of them. Each
 * expected number is written down by hand from test/fixtures/peer-study (data_mutations.txt line
 * numbers; a sample's patient from data_clinical_sample.txt, FX-Pnn-T1 and -T2 both FX-Pnn; KRAS
 * has no row in data_sv.txt):
 *   KRAS: 24 rows, lines 2-71.
 *   G12C: lines 2 (FX-P01-T1), 3 (FX-P01-T2), 21 (FX-P06-T1), 31 (FX-P10-T1), 43 (FX-P11-T1),
 *     57 (FX-P16-T1): 6 rows, 6 samples, 5 patients (FX-P01, P06, P10, P11, P16).
 *   Codon 12 (G12C above, plus G12D lines 5 (FX-P02-T1), 6 (FX-P02-T2), 25 (FX-P07-T1), 46
 *     (FX-P12-T1), 60 (FX-P17-T1), and G12V lines 9 (FX-P03-T1), 10 (FX-P03-T2), 28 (FX-P08-T1),
 *     49 (FX-P13-T1), 63 (FX-P18-T1)): 16 rows, 16 samples, 13 patients (FX-P01, P02, P03, P06,
 *     P07, P08, P10, P11, P12, P13, P16, P17, P18).
 *
 * Run: node --env-file=.env.local scripts/check-table-kept-units.ts (connection b must be the
 * fixture: `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { connById } from "../lib/ch.ts";
import { PatientLevelResolver } from "../lib/federation.ts";
import { runMutations } from "../lib/views/mutations/run.ts";
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

type Kept = { samples: number; patients: number };
type Table = { kept?: Kept; total: number; all: number };
const mutations = async (gene: string, extra: Record<string, unknown> = {}): Promise<Table | string> => {
  try {
    const res = await runMutations({ kind: "mutations", gene, cohorts: ["c"], ...extra } as never, ctx()) as unknown as Record<string, unknown> & { result?: Record<string, unknown> };
    const r = (res.result ?? res) as Record<string, unknown>;
    const t = r.mutations as Table | undefined;
    return t || "refused: " + String(r.error || JSON.stringify(r).slice(0, 200));
  } catch (e) { return "threw: " + String((e as Error).message).slice(0, 200); }
};

/** a table's kept (absent when `want.kept` is undefined), and its total and all */
const check = (label: string, t: Table | string, want: { kept?: Kept; total: number; all: number }) => {
  if (typeof t === "string") { ok(label + ": answered", false, t); return; }
  const has = Object.prototype.hasOwnProperty.call(t, "kept");
  ok(label + ": kept " + (want.kept ? want.kept.samples + " samples / " + want.kept.patients + " patients" : "absent"),
    want.kept ? has && t.kept!.samples === want.kept.samples && t.kept!.patients === want.kept.patients : !has,
    has ? "got " + JSON.stringify(t.kept) : "absent");
  ok(label + ": total " + want.total, t.total === want.total, "got " + t.total);
  ok(label + ": all " + want.all, t.all === want.all, "got " + t.all);
};

// ---- U3: a search keeps the G12C rows
check("U3 KRAS search G12C (lines 2,3,21,31,43,57)", await mutations("KRAS", { search: "G12C" }), { kept: { samples: 6, patients: 5 }, total: 6, all: 24 });

// ---- U4: every row kept, so no kept
check("U4 KRAS, no search or filter", await mutations("KRAS"), { total: 24, all: 24 });

// ---- U5: a stem selection keeps codon 12
check("U5 KRAS filter proteinPos = 12 (G12C/D/V, 16 rows)", await mutations("KRAS", { filters: { proteinPos: { values: ["12"] } } }), { kept: { samples: 16, patients: 13 }, total: 16, all: 24 });

console.log(`\n${checks - failures}/${checks} table kept unit checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
