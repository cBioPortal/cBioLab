/**
 * Live check: each Explore clinical chart's `samples` — the selected samples with a value, the
 * numerator of the Add chart dialog's Freq — run against the fixture study's ClickHouse
 * (connection b, `cbiolab_peer_fixture`).
 *
 * Written from docs/legacy-spec/parity/add-chart-cases.md, row AC1: a sample attribute counts the
 * selected samples with a value; a patient attribute counts every selected sample whose patient has
 * a value. The fixture (test/fixtures/peer-study: 53 patients, 59 samples) gives FX-P01–FX-P04 two
 * samples each, a Primary and a Metastasis, and patient-level PATIENT_SCORE (FX-P01, FX-P02) and
 * PATIENT_FLAG (FX-P01): counted in patients they read 2 and 1, in samples 4 and 2.
 *
 * The expected counts come from the fixture's own files, for every attribute, with no filter and
 * filtered to the Metastasis samples.
 *
 * Run: node --env-file=.env.local scripts/check-chart-freq.ts
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

/** a clinical file's header and rows */
function table(file: string): { head: string[]; rows: string[][] } {
  const lines = readFileSync(new URL("../test/fixtures/peer-study/" + file, import.meta.url), "utf8")
    .split("\n").filter((l) => l && !l.startsWith("#"));
  return { head: lines[0].split("\t"), rows: lines.slice(1).map((l) => l.split("\t")) };
}
const samples = table("data_clinical_sample.txt"), patients = table("data_clinical_patient.txt");
/** a value the importer stores: not empty, not NA */
const has = (v: string | undefined) => v != null && v.trim() !== "" && v.trim().toUpperCase() !== "NA";

/** what each attribute's `samples` should read over the selected samples `sel` (sample ids) */
function expected(sel: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  const sid = samples.head.indexOf("SAMPLE_ID"), spid = samples.head.indexOf("PATIENT_ID");
  samples.head.forEach((a, i) => {
    if (i === sid || i === spid) return;
    out.set("sample|" + a, samples.rows.filter((r) => sel.has(r[sid]) && has(r[i])).length);
  });
  const pid = patients.head.indexOf("PATIENT_ID");
  patients.head.forEach((a, i) => {
    if (i === pid) return;
    const withValue = new Set(patients.rows.filter((r) => has(r[i])).map((r) => r[pid]));
    out.set("patient|" + a, samples.rows.filter((r) => sel.has(r[sid]) && withValue.has(r[spid])).length);
  });
  return out;
}

const sid = samples.head.indexOf("SAMPLE_ID"), stype = samples.head.indexOf("SAMPLE_TYPE");
const all = new Set(samples.rows.map((r) => r[sid]));
const metastasis = new Set(samples.rows.filter((r) => r[stype] === "Metastasis").map((r) => r[sid]));
ok("fixture files read", all.size === 59 && metastasis.size === 6, `${all.size} samples, ${metastasis.size} Metastasis`);

for (const [label, sel, draft] of [
  ["undrafted", all, undefined],
  ["SAMPLE_TYPE = Metastasis", metastasis, { all: [{ kind: "clinical", attribute: "SAMPLE_TYPE", values: ["Metastasis"] }] }],
] as const) {
  try {
    const r = await buildExplore({ study: STUDY, conn, skipGenes: true, skipBins: true, ...(draft ? { draft: draft as never } : {}) });
    const want = expected(sel);
    const got = new Map(r.clinical.map((c) => [c.per + "|" + c.attribute, c.samples]));
    const wrong = [...want].filter(([k, n]) => got.has(k) && got.get(k) !== n && !(k === "sample|SAMPLE_TYPE" && draft))
      .map(([k, n]) => `${k}: ${got.get(k)} (want ${n})`);
    const checked = [...want.keys()].filter((k) => got.has(k)).length;
    ok(`AC1 ${label}: every chart's samples with data match the files`, wrong.length === 0 && checked >= 15,
      wrong.length ? wrong.slice(0, 6).join("; ") : `${checked} attributes`);
    ok(`AC1 ${label}: PATIENT_SCORE counts its patients' selected samples`, got.get("patient|PATIENT_SCORE") === want.get("patient|PATIENT_SCORE"),
      `samples=${got.get("patient|PATIENT_SCORE")} want ${want.get("patient|PATIENT_SCORE")}, patients=${r.clinical.find((c) => c.attribute === "PATIENT_SCORE")?.patients}`);
    ok(`AC1 ${label}: the selection's samples`, r.totals?.samples === sel.size, `${r.totals?.samples} of ${sel.size}`);
  } catch (e) { ok(label, false, String((e as Error).message ?? e).split("\n")[0].slice(0, 300)); }
}

// AC9: only an attribute the clinical query counted can read as "no data"
try {
  const r = await buildExplore({ study: STUDY, conn, skipGenes: true, skipBins: true, attributes: ["SEX"] });
  const d = new Map((r.declaredAttributes || []).map((x) => [x.attribute, x.counted]));
  ok("AC9 asked for SEX alone: SEX is counted, AGE (not asked for) is not", d.get("SEX") === true && d.get("AGE") === false,
    `SEX ${d.get("SEX")}, AGE ${d.get("AGE")}`);
  const all = await buildExplore({ study: STUDY, conn, skipGenes: true, skipBins: true });
  ok("AC9 asked for every attribute: every declared attribute is counted", (all.declaredAttributes || []).length > 0 && (all.declaredAttributes || []).every((x) => x.counted === true),
    (all.declaredAttributes || []).filter((x) => x.counted !== true).map((x) => x.attribute).join(", ") || "all counted");
} catch (e) { ok("AC9", false, String((e as Error).message ?? e).split("\n")[0].slice(0, 300)); }

console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
process.exit(failures ? 1 : 0);
