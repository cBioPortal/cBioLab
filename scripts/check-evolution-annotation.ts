/**
 * Live check: the Genomic Evolution table's Annotation column (PTB-GE-TB-1), run against the committed
 * fixture study on connection b through the evolution view (lib/views/evolution/run.ts over
 * lib/views/evolution/sql.ts evolutionMutationsSource and lib/table-query.ts). Each expected value is
 * written down by hand from test/fixtures/peer-study/data_mutations.txt (FX-P01's and FX-P02's
 * mutations) and test/fixtures/peer-oncokb.tsv (the calls stored under version "fixture"), by the
 * Patient tables' rule (ANNOTATION_COLUMN, annotationText):
 *
 *   A1 a mutation OncoKB calls with a sensitive level: "Oncogenic · Level 1" (PIK3CA E545K, KRAS G12C)
 *   A2 one it calls without a level: "Oncogenic" (KRAS G12D, TP53 R273H)
 *   A3 one the store has no row for: blank (SMARCA4 R1192C)
 *   A4 no pin: every row blank, nothing read from the store
 *   A5 another pin's rows are not read: a version the store does not hold leaves every row blank
 *   A6 the column sorts drivers first (order "drv"): descending, SMARCA4 last
 *   A7 the result echoes the pin it read
 *
 * Run: node --env-file=.env.local scripts/check-evolution-annotation.ts (connection b must be the
 * fixture: `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { connById } from "../lib/ch.ts";
import { PatientLevelResolver } from "../lib/federation.ts";
import { runEvolution } from "../lib/views/evolution/run.ts";
import type { ViewRun } from "../lib/views/run.ts";
import type { EvolutionResult } from "../lib/views/evolution/types.ts";

const STUDY = "cbiolab_peer_fixture";
const PIN = "fixture";

let failures = 0, checks = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  checks++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

const conn = connById("b");
if (!conn) { console.log("FAIL connection b is not configured (npm run peer-db prints its CLICKHOUSE2_* lines)"); process.exit(1); }
const resolver = new PatientLevelResolver(STUDY, { oncokbPin: null }, { id: conn.id, mode: "patient-level", label: "fixture", conn });
const ctxAt = (pin: string | null) => ({
  doc: { study: STUDY, cohorts: { c: { all: [] } }, views: [] },
  cohorts: { c: { studies: [STUDY], perStudy: {}, count: 1, samples: 2, text: "" } },
  resolvers: { [STUDY]: resolver },
  vNames: ["c"], vStudies: [STUDY],
  participationFor: () => ({}),
  pin, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
}) as unknown as ViewRun;

async function table(patient: string, pin: string | null, sort?: { column: string; desc?: boolean }): Promise<{ rows: Record<string, string>; order: string; pin: unknown } | string> {
  try {
    const r = await runEvolution({ kind: "evolution", cohorts: ["c"], patient: { study: STUDY, id: patient }, mutations: { columns: ["gene", "proteinChange", "annotation"], ...(sort ? { sort } : {}) } }, ctxAt(pin)) as { evolution?: EvolutionResult; error?: string };
    const t = r.evolution?.mutations;
    if (!t) return "refused: " + String(r.error);
    const at = (id: string) => t.columns.findIndex((c) => c.id === id);
    const rows = Object.fromEntries(t.rows.map((x) => [x.values[at("gene")] + " " + x.values[at("proteinChange")], String(x.values[at("annotation")] ?? "")]));
    return { rows, order: t.rows.map((x) => String(x.values[at("gene")])).join(", "), pin: r.evolution!.oncokbPin };
  } catch (e) { return "threw: " + String((e as Error).message).slice(0, 300); }
}
const show = (x: unknown) => JSON.stringify(x);

const p02 = await table("FX-P02", PIN);
const p01 = await table("FX-P01", PIN);
if (typeof p02 === "string" || typeof p01 === "string") ok("FX-P01's and FX-P02's mutations are listed", false, String(typeof p02 === "string" ? p02 : p01));
else {
  ok("A1 PIK3CA E545K: Oncogenic · Level 1", p02.rows["PIK3CA E545K"] === "Oncogenic · Level 1", show(p02.rows));
  ok("A1 KRAS G12C: Oncogenic · Level 1", p01.rows["KRAS G12C"] === "Oncogenic · Level 1", show(p01.rows));
  ok("A2 KRAS G12D: Oncogenic", p02.rows["KRAS G12D"] === "Oncogenic", show(p02.rows));
  ok("A2 TP53 R273H: Oncogenic", p01.rows["TP53 R273H"] === "Oncogenic", show(p01.rows));
  ok("A3 SMARCA4 R1192C: no row in the store, blank", p02.rows["SMARCA4 R1192C"] === "", show(p02.rows));
  ok("A7 the result echoes the pin", p02.pin === PIN, show(p02.pin));
}
const none = await table("FX-P02", null);
ok("A4 no pin: every row blank", typeof none !== "string" && Object.values(none.rows).every((x) => x === "") && Object.keys(none.rows).length === 3, show(none));
ok("A4 no pin: the result says null", typeof none !== "string" && none.pin === null, show(typeof none === "string" ? none : none.pin));
const other = await table("FX-P02", "v0.0-none");
ok("A5 a version the store does not hold: every row blank", typeof other !== "string" && Object.values(other.rows).every((x) => x === ""), show(other));
const desc = await table("FX-P02", PIN, { column: "annotation", desc: true });
ok("A6 sorted by Annotation, descending: the drivers first, SMARCA4 last", typeof desc !== "string" && desc.order.endsWith("SMARCA4") && desc.order.split(", ").length === 3, show(typeof desc === "string" ? desc : desc.order));

console.log(failures ? `${failures} of ${checks} evolution annotation checks FAILED` : `all ${checks} evolution annotation checks passed`);
process.exit(failures ? 1 : 0);
