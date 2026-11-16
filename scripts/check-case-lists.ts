/**
 * Live check: the Study View's Case Lists chart, run against the fixture study's ClickHouse
 * (connection b, `cbiolab_peer_fixture`).
 *
 * Written from docs/legacy-spec/parity/empty-caselists-cases.md, rows CL1, CL2, CL3, CL5 and CL8
 * (CL6, several studies, is test/explore-facets.test.ts's; CL9/CL10 are the page's). The portal
 * counts a list's samples among the selected samples (cbioportal's sample-list counts query,
 * `count(sample_id)`), keeps every list, and here orders them by count, ties by id.
 *
 * The fixture (test/fixtures/peer-study: 53 patients, 59 samples) has the importer's standard
 * lists `_all`, `_sequenced`, `_sv`, `_cnaseq`, `_cna` (every sample each) and
 * `cbiolab_peer_fixture_subset`: FX-P01-T1, FX-P01-T2 and FX-P02-T1 — three samples of two
 * patients, so a count in patients reads 2 where the portal reads 3, and a filter that leaves
 * out FX-P01 and FX-P02 empties it.
 *
 * Run: node --env-file=.env.local scripts/check-case-lists.ts
 * (connection b is `npm run peer-db`: export the CLICKHOUSE2_* lines it prints)
 */
import { readFileSync } from "node:fs";
import { connById } from "../lib/ch.ts";
import { buildExplore } from "../lib/explore.ts";

const STUDY = "cbiolab_peer_fixture";

const conn = connById("b");
if (!conn) {
  console.log("FAIL connection b (CLICKHOUSE2_*) is not configured.\n" +
    "  Start the fixture database with `npm run peer-db` (or node --env-file=.env.local scripts/peer-db.ts)\n" +
    "  and export the CLICKHOUSE2_* lines it prints, then run this again.");
  process.exit(1);
}

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};
/** run a case; a thrown error (a SQL error) is that case's failure, not the script's end */
const row = async (name: string, f: () => Promise<void>) => {
  try { await f(); } catch (e) { ok(name, false, String((e as Error).message ?? e).split("\n")[0].slice(0, 300)); }
};

// The expected counts come from the fixture's own files, not from the database under test.
const sampleRows = readFileSync(new URL("../test/fixtures/peer-study/data_clinical_sample.txt", import.meta.url), "utf8")
  .split("\n").filter((l) => l && !l.startsWith("#") && !l.startsWith("SAMPLE_ID")).map((l) => l.split("\t"));
const SAMPLES = sampleRows.length;
const PATIENTS = new Set(sampleRows.map((r) => r[1])).size;
const samplesOf = (patients: string[]) => sampleRows.filter((r) => patients.includes(r[1])).length;
const subsetIds = readFileSync(new URL("../test/fixtures/peer-study/case_lists/cases_subset.txt", import.meta.url), "utf8")
  .split("\n").find((l) => l.startsWith("case_list_ids:"))!.replace("case_list_ids:", "").trim().split(/\s+/);
const subsetOf = (patients: string[]) => sampleRows.filter((r) => subsetIds.includes(r[0]) && patients.includes(r[1])).length;

type Lists = Awaited<ReturnType<typeof buildExplore>>["caseLists"];
const explore = (draft?: unknown) =>
  buildExplore({ study: STUDY, conn, skipGenes: true, skipBins: true, ...(draft ? { draft: draft as never } : {}) });
const show = (ls: Lists) => ls.map((l) => `${l.id}=${l.n}`).join(", ");
const byId = (ls: Lists, id: string) => ls.find((l) => l.id === id);

ok("fixture files read", SAMPLES === 59 && PATIENTS === 53 && subsetIds.length === 3,
  `${SAMPLES} samples, ${PATIENTS} patients, subset of ${subsetIds.length}`);

// ---- no draft: the whole study ----------------------------------------------------------------
await row("undrafted", async () => {
  const r = await explore();
  const ls = r.caseLists;

  // CL1: a row's id is the list's stable id less "<study>_"; its name is the list's own
  const ids = ls.map((l) => l.id);
  ok("CL1: ids are the stable ids less the study prefix",
    ids.length > 0 && ids.every((id) => !id.startsWith(STUDY + "_")) && ids.includes("all") && ids.includes("subset"),
    ids.join(", "));
  ok("CL1: names are the lists' names",
    byId(ls, "all")?.name === "All samples" && byId(ls, "subset")?.name === "A three-sample subset",
    `all="${byId(ls, "all")?.name}", subset="${byId(ls, "subset")?.name}"`);

  // CL2: samples, not patients
  ok(`CL2: 'all' counts samples (${SAMPLES}), not patients (${PATIENTS})`, byId(ls, "all")?.n === SAMPLES,
    `all=${byId(ls, "all")?.n}`);
  ok("CL2: 'subset' counts its 3 samples, not its 2 patients", byId(ls, "subset")?.n === 3,
    `subset=${byId(ls, "subset")?.n}`);
  ok("CL2: the header's totals agree with the fixture", r.totals?.samples === SAMPLES && r.totals?.patients === PATIENTS,
    `${r.totals?.patients} patients, ${r.totals?.samples} samples`);

  // CL5: every list, no cap
  const want = ["all", "cna", "cnaseq", "sequenced", "subset", "sv"];
  ok("CL5: all six lists are present", want.every((id) => ids.includes(id)) && ids.length === want.length, show(ls));

  // CL8: count descending, ties by id A to Z
  ok("CL8: by count descending, ties by id A to Z",
    ids.join(",") === "all,cna,cnaseq,sequenced,sv,subset", show(ls));
});

// ---- CL2 under a draft: only FX-P01's samples -------------------------------------------------
await row("drafted to FX-P01", async () => {
  const P01 = ["FX-P01"];
  const r = await explore({ all: [{ kind: "patientList", ids: [STUDY + ":FX-P01"] }] });
  const ls = r.caseLists;
  const nAll = samplesOf(P01), nSubset = subsetOf(P01);
  ok(`CL2 (drafted to FX-P01): 'all' is FX-P01's ${nAll} samples`, byId(ls, "all")?.n === nAll, show(ls));
  ok(`CL2 (drafted to FX-P01): 'subset' is ${nSubset}, its samples among the selected`, byId(ls, "subset")?.n === nSubset,
    show(ls));
  ok("CL8 (drafted to FX-P01): ties by id A to Z", ls.map((l) => l.id).join(",") === "all,cna,cnaseq,sequenced,subset,sv",
    show(ls));
});

// ---- CL3: a list with no selected sample has no row --------------------------------------------
await row("drafted without FX-P01, FX-P02", async () => {
  const kept = [...new Set(sampleRows.map((r) => r[1]))].filter((p) => p !== "FX-P01" && p !== "FX-P02");
  const r = await explore({ all: [{ not: { kind: "patientList", ids: [STUDY + ":FX-P01", STUDY + ":FX-P02"] } }] });
  const ls = r.caseLists;
  ok("CL3: no 'subset' row when none of its samples is selected", !byId(ls, "subset"), show(ls));
  ok(`CL3: the other lists still count the ${samplesOf(kept)} selected samples`,
    byId(ls, "all")?.n === samplesOf(kept), show(ls));
});

console.log(failures ? `\n${failures} case-list check(s) FAILED` : "\nall case-list checks passed");
process.exit(failures ? 1 : 0);
