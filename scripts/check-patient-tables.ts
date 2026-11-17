/**
 * Live check: the Patient page's Mutation Type column (PAT-MT-2), run against the committed fixture
 * study on connection b through the alterations view (lib/views/alterations/run.ts over
 * lib/patient-alterations.ts and lib/table-query.ts). Expected values are written by hand from
 * test/fixtures/peer-study/data_mutations.txt: FX-P03's Variant_Classification is Missense_Mutation
 * for KRAS (both samples), TP53 and KEAP1, and Nonsense_Mutation for ARID1A. The rule (the portal's
 * MutationTypeColumnFormatter, getCanonicalMutationType):
 *
 *   C  the cell shows the portal's label ("Missense", "Nonsense"); the stored type is the row's detail
 *   F  a filter compares the label: equals "Nonsense" keeps ARID1A; a value list offers the labels
 *   S  search reads the label: "nonsense" finds ARID1A
 *   O  the sort is by the label: ascending Missense rows then Nonsense, descending the reverse
 *
 * Run: node --env-file=.env.local scripts/check-patient-tables.ts (connection b must be the fixture:
 * `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { connById } from "../lib/ch.ts";
import { PatientLevelResolver } from "../lib/federation.ts";
import { runAlterations } from "../lib/views/alterations/run.ts";
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
const ctxFor = (extra: Record<string, unknown> = {}) => ({
  doc: { study: STUDY, cohorts: { c: { all: [] } }, views: [] },
  cohorts: { c: { studies: [STUDY], perStudy: {} } },
  resolvers: { [STUDY]: resolver },
  vNames: ["c"], vStudies: [STUDY],
  participationFor: () => ({}),
  pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  ...extra,
} as unknown as ViewRun);

type Row = { gene: string; type: string; stored: string };
async function rows(q: TableQuery): Promise<Row[] | string> {
  try {
    const r = await runAlterations({ kind: "alterations", cohorts: ["c"], patient: { study: STUDY, id: "FX-P03" }, mutations: { ...q, columns: ["gene", "mutationType"], rows: 100 } }, ctxFor()) as { alterations?: AlterationsResult; error?: string };
    const t = r.alterations?.tables.mutations;
    if (!t) return "refused: " + String(r.error);
    const at = (id: string) => t.columns.findIndex((c) => c.id === id);
    return t.rows.map((x) => ({ gene: String(x.values[at("gene")]), type: String(x.values[at("mutationType")]), stored: String(x.detail?.mutationType ?? "") }));
  } catch (e) { return "threw: " + String((e as Error).message).slice(0, 300); }
}
const genes = (r: Row[] | string) => typeof r === "string" ? r : r.map((x) => x.gene).join(", ");

// ---- C: the cell and its detail --------------------------------------------------------------
{
  const all = await rows({});
  if (typeof all === "string") ok("FX-P03's mutations are listed", false, all);
  else {
    const arid = all.find((x) => x.gene === "ARID1A"), kras = all.find((x) => x.gene === "KRAS");
    ok("C ARID1A shows Nonsense, its stored type in the detail", arid?.type === "Nonsense" && arid.stored === "Nonsense_Mutation", JSON.stringify(arid));
    ok("C KRAS shows Missense", kras?.type === "Missense" && kras.stored === "Missense_Mutation", JSON.stringify(kras));
    ok("C four rows (KRAS once for its two samples)", all.length === 4, genes(all));
  }
}

// ---- F, S: filter and search read the label --------------------------------------------------
ok("F equals Nonsense keeps ARID1A", genes(await rows({ filters: { mutationType: { op: "equals", value: "Nonsense" } } })) === "ARID1A");
ok("F a values filter [Missense] keeps KEAP1, KRAS, TP53", genes(await rows({ filters: { mutationType: { values: ["Missense"] } } })).split(", ").sort().join(", ") === "KEAP1, KRAS, TP53");
ok("S search \"nonsense\" finds ARID1A", genes(await rows({ search: "nonsense" })) === "ARID1A");
{
  const r = await runAlterations({ kind: "alterations", cohorts: ["c"], patient: { study: STUDY, id: "FX-P03" }, mutations: { columns: ["gene", "mutationType"] } }, ctxFor({ values: "mutationType", table: "mutations", page: undefined })) as { alterations?: AlterationsResult };
  const cv = r.alterations?.tables.mutations?.values;
  const vals = (cv && !cv.numeric ? cv.values : []).map((v) => v.value).sort();
  ok("F the filter offers the labels", vals.join(", ") === "Missense, Nonsense", vals.join(", "));
}

// ---- O: the sort by label --------------------------------------------------------------------
{
  const asc = await rows({ sort: { column: "mutationType" } }), desc = await rows({ sort: { column: "mutationType", desc: true } });
  const types = (r: Row[] | string) => typeof r === "string" ? r : r.map((x) => x.type).join(", ");
  ok("O ascending: the Missense rows, then Nonsense", types(asc) === "Missense, Missense, Missense, Nonsense", types(asc));
  ok("O descending: Nonsense first", types(desc) === "Nonsense, Missense, Missense, Missense", types(desc));
}

console.log(failures ? `${failures} of ${checks} patient table checks FAILED` : `all ${checks} patient table checks passed`);
process.exit(failures ? 1 : 0);
