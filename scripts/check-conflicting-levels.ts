/**
 * Live check: an attribute patient-level in one selected study and sample-level in another is
 * charted once, per sample, each SELECTED sample counted once (STS-MD-5, with cBioPortal/cbioportal#12509
 * fixed: the portal joins a patient's value to every sample of the patient, selected or not).
 * Run against the warehouse (connection a).
 *
 * The real cases:
 *   HISTOLOGY        patient-level in nsclc_tracerx_2017 (CRUK0030 has several samples),
 *                    sample-level in luad_cas_2020 (LUAD_01)
 *   TOTAL_MUTATIONS  patient-level in histiocytosis_cobi_msk_2019 (52 samples of 18 patients),
 *                    sample-level in blca_dfarber_mskcc_2014 (50 samples)
 *
 * Rows B1–B7 of the spec table. The expected counts of B3, B4, B6 and B7 come from this script's own
 * SQL over clinical_data_derived and sample_derived — each selected sample under its own value, or
 * its patient's — never from the code under test.
 *
 * Run: node --env-file=.env.local scripts/check-conflicting-levels.ts
 */
import { chQuery, connById } from "../lib/ch.ts";
import { buildExplore, buildExploreFederated } from "../lib/explore.ts";
import { studyProfilesMany } from "../lib/analysis.ts";
import { CLINICAL_MISSING_VALUES } from "../lib/event-names.ts";
import type { ClinicalFacet, ExploreResult } from "../lib/types.ts";

const TRACERX = "nsclc_tracerx_2017", CAS = "luad_cas_2020";
const HISTIO = "histiocytosis_cobi_msk_2019", BLCA = "blca_dfarber_mskcc_2014";

const conn = connById("a");
if (!conn) {
  console.log("FAIL connection a (the warehouse) is not configured; run with --env-file=.env.local");
  process.exit(1);
}
const db = conn.db;

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};
/** run a case; a thrown error (a SQL error) is that case's failure, not the script's end */
const row = async (name: string, f: () => Promise<void>) => {
  try { await f(); } catch (e) { ok(name, false, String((e as Error).message ?? e).split("\n")[0].slice(0, 300)); }
};

const q = (s: string) => "'" + s.replaceAll("\\", "\\\\").replaceAll("'", "\\'") + "'";
const fold = (v: string) => v.trim().toLowerCase();

// ---- the code under test ------------------------------------------------------------------------
const explore = async (studies: string[], attribute: string, samples?: string[]): Promise<ExploreResult> => {
  const draft = samples ? { all: [{ kind: "sampleList", ids: samples }] } : null;
  return buildExploreFederated({
    studies, draft: draft as never, attributes: [attribute],
    profilesByStudy: await studyProfilesMany(studies), connByStudy: new Map(studies.map((s) => [s, conn])),
  });
};
const facetsOf = (r: ExploreResult, attribute: string) => r.clinical.filter((f) => f.attribute === attribute);
type Cat = Extract<ClinicalFacet, { kind: "cat" }>;
type Num = Extract<ClinicalFacet, { kind: "num" }>;
const countsOf = (f: Cat) => Object.fromEntries(f.values.map((x) => [x.v, x.n]));
const show = (m: Record<string, number>) => Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([v, n]) => `${v}=${n}`).join(", ");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ---- the ground truth: this script's own SQL ------------------------------------------------------
/** the selected samples as "<study>:<sample stable id>" (all of the studies' samples when `samples` is absent) */
const selectedSql = (studies: string[], samples?: string[]) =>
  "SELECT sample_unique_id AS sid, patient_unique_id AS pid FROM " + db + ".sample_derived\n" +
  " WHERE cancer_study_identifier IN (" + studies.map(q).join(", ") + ")" +
  (samples ? "\n   AND concat(cancer_study_identifier, ':', sample_stable_id) IN (" + samples.map(q).join(", ") + ")" : "");
/** each selected sample with a recorded value: its own sample-level row, or its patient's patient-level row */
const valuesSql = (studies: string[], attribute: string, samples?: string[]) =>
  "WITH sel AS (" + selectedSql(studies, samples) + "),\n" +
  " c AS (SELECT type, sample_unique_id, patient_unique_id, attribute_value FROM " + db + ".clinical_data_derived\n" +
  "   WHERE cancer_study_identifier IN (" + studies.map(q).join(", ") + ") AND attribute_name = " + q(attribute) + "\n" +
  "     AND lowerUTF8(trimBoth(attribute_value)) NOT IN (" + CLINICAL_MISSING_VALUES.map(q).join(", ") + "))\n" +
  "SELECT sel.sid AS sid, c.attribute_value AS v FROM sel JOIN c ON c.sample_unique_id = sel.sid WHERE c.type = 'sample'\n" +
  "UNION ALL\n" +
  "SELECT sel.sid AS sid, c.attribute_value AS v FROM sel JOIN c ON c.patient_unique_id = sel.pid WHERE c.type = 'patient'";
async function selectedCount(studies: string[], samples?: string[]) {
  return Number((await chQuery<{ n: string }>("SELECT count() AS n FROM (" + selectedSql(studies, samples) + ")", conn!)).data[0].n);
}
/** folded value → selected samples holding it; and how many selected samples hold any value */
async function truthCat(studies: string[], attribute: string, samples?: string[]) {
  const [r, w] = await Promise.all([
    chQuery<{ f: string; n: string }>(
      "SELECT lowerUTF8(trimBoth(v)) AS f, uniqExact(sid) AS n FROM (" + valuesSql(studies, attribute, samples) + ") GROUP BY f", conn!),
    chQuery<{ n: string }>("SELECT uniqExact(sid) AS n FROM (" + valuesSql(studies, attribute, samples) + ")", conn!),
  ]);
  return { byValue: Object.fromEntries(r.data.map((x) => [x.f, Number(x.n)])), withValue: Number(w.data[0].n) };
}
/** selected samples whose value (own or patient's) is a number */
async function truthNumeric(studies: string[], attribute: string, samples?: string[]) {
  return Number((await chQuery<{ n: string }>(
    "SELECT uniqExact(sid) AS n FROM (" + valuesSql(studies, attribute, samples) + ") WHERE toFloat64OrNull(trimBoth(v)) IS NOT NULL", conn!)).data[0].n);
}
/**
 * One sample from each of `onePer` multi-sample patients of `study`, plus a second sample of the first
 * `twoPer` of them — so each such patient has samples left out — as "<study>:<sample>". Throws when the
 * study has fewer than `onePer` patients with 3+ samples, so a row never tests a smaller selection than it says.
 */
async function multiSampleSelection(study: string, onePer: number, twoPer: number) {
  const r = await chQuery<{ s: string; p: string; k: string; m: string }>(
    "SELECT sample_stable_id AS s, patient_stable_id AS p, row_number() OVER (PARTITION BY patient_stable_id ORDER BY sample_stable_id) AS k,\n" +
    "  count() OVER (PARTITION BY patient_stable_id) AS m\n" +
    "FROM " + db + ".sample_derived WHERE cancer_study_identifier = " + q(study) + " ORDER BY p, s", conn!);
  const multi = [...new Set(r.data.filter((x) => Number(x.m) > 2).map((x) => x.p))].slice(0, onePer);
  if (multi.length < onePer) throw new Error(`${study} has ${multi.length} patients with 3+ samples; the selection needs ${onePer}`);
  return r.data.filter((x) => multi.includes(x.p) && (Number(x.k) === 1 || (Number(x.k) === 2 && multi.indexOf(x.p) < twoPer)))
    .map((x) => study + ":" + x.s);
}
async function firstSamples(study: string, n: number) {
  const r = await chQuery<{ s: string }>("SELECT sample_stable_id AS s FROM " + db + ".sample_derived WHERE cancer_study_identifier = " + q(study) +
    " ORDER BY s LIMIT " + n, conn!);
  return r.data.map((x) => study + ":" + x.s);
}

/** a categorical facet against the ground truth: one facet, per sample, every value's count, sum + NA = selected */
async function checkCat(label: string, studies: string[], attribute: string, samples?: string[]) {
  const [r, truth, selected] = await Promise.all([explore(studies, attribute, samples), truthCat(studies, attribute, samples), selectedCount(studies, samples)]);
  const fs = facetsOf(r, attribute);
  ok(`${label}: one ${attribute} facet, per sample`, fs.length === 1 && fs[0].per === "sample" && fs[0].kind === "cat",
    fs.map((f) => f.per + "/" + f.kind).join(", "));
  const f = fs[0] as Cat | undefined;
  if (!f || f.kind !== "cat") return;
  const got: Record<string, number> = {};
  for (const x of f.values) got[fold(x.v)] = (got[fold(x.v)] || 0) + x.n;
  ok(`${label}: every value's count is the selected samples holding it, own value or patient's`, show(got) === show(truth.byValue),
    `got ${show(got)}; truth ${show(truth.byValue)}`);
  ok(`${label}: values + NA = the ${selected} selected samples, NA = ${selected - truth.withValue}`,
    sum(f.values.map((x) => x.n)) + (f.na ?? 0) === selected && (f.na ?? 0) === selected - truth.withValue,
    `Σ ${sum(f.values.map((x) => x.n))} + NA ${f.na ?? 0}`);
}
/** a numeric facet against the ground truth: per sample, Σ bins = samples with a number, Σ bins + NA = selected */
async function checkNum(label: string, studies: string[], attribute: string, samples?: string[]) {
  const [r, numeric, selected] = await Promise.all([explore(studies, attribute, samples), truthNumeric(studies, attribute, samples), selectedCount(studies, samples)]);
  const fs = facetsOf(r, attribute);
  ok(`${label}: one ${attribute} facet, per sample, numeric`, fs.length === 1 && fs[0].per === "sample" && fs[0].kind === "num",
    fs.map((f) => f.per + "/" + f.kind).join(", "));
  const f = fs[0] as Num | undefined;
  if (!f || f.kind !== "num") return;
  const bins = sum((f.bins || []).map((b) => b.count));
  ok(`${label}: Σ bins = the ${numeric} selected samples with a number`, bins === numeric, `Σ bins ${bins}`);
  ok(`${label}: Σ bins + NA = the ${selected} selected samples`, bins + (f.naCount ?? 0) === selected, `Σ bins ${bins} + NA ${f.naCount ?? 0}`);
}

// ---- B1, B2: the issue's repro --------------------------------------------------------------------
await row("B1", async () => {
  const r = await explore([TRACERX, CAS], "HISTOLOGY", [TRACERX + ":CRUK0030-R1", CAS + ":LUAD_01"]);
  const fs = facetsOf(r, "HISTOLOGY");
  ok("B1: CRUK0030-R1 + LUAD_01 — one HISTOLOGY facet, per sample", fs.length === 1 && fs[0].per === "sample",
    fs.map((f) => f.per + "/" + f.kind).join(", "));
  const f = fs[0] as Cat;
  ok("B1: Adenocarcinoma 1, Invasive adenocarcinoma 1, NA 0 (the portal: Invasive adenocarcinoma 4)",
    f?.kind === "cat" && show(countsOf(f)) === "Adenocarcinoma=1, Invasive adenocarcinoma=1" && (f.na ?? 0) === 0,
    f?.kind === "cat" ? show(countsOf(f)) + ", NA " + (f.na ?? 0) : "no categorical facet");
});
await row("B2", async () => {
  const r = await explore([TRACERX, CAS], "HISTOLOGY", [TRACERX + ":CRUK0030-R1", TRACERX + ":CRUK0030-R2", CAS + ":LUAD_01"]);
  const f = facetsOf(r, "HISTOLOGY")[0] as Cat | undefined;
  ok("B2: CRUK0030-R1, -R2 + LUAD_01 — Invasive adenocarcinoma 2, Adenocarcinoma 1, NA 0",
    f?.kind === "cat" && f.per === "sample" && show(countsOf(f)) === "Adenocarcinoma=1, Invasive adenocarcinoma=2" && (f.na ?? 0) === 0,
    f?.kind === "cat" ? f.per + ": " + show(countsOf(f)) + ", NA " + (f.na ?? 0) : "no categorical facet");
});

// ---- B3, B4: against the ground truth ---------------------------------------------------------------
await row("B3", async () => {
  const samples = [...await multiSampleSelection(TRACERX, 16, 8), ...await firstSamples(CAS, 10)];
  await checkCat(`B3: ${samples.length} samples (one or two of each of 16 multi-sample tracerx patients, 10 of luad_cas)`, [TRACERX, CAS], "HISTOLOGY", samples);
});
await row("B4", async () => { await checkCat("B4: no filter", [TRACERX, CAS], "HISTOLOGY"); });

// ---- B5: no conflict, no lifting --------------------------------------------------------------------
await row("B5", async () => {
  const r = await buildExplore({ study: TRACERX, conn, skipGenes: true, skipBins: true, attributes: ["HISTOLOGY"],
    draft: { all: [{ kind: "sampleList", ids: [TRACERX + ":CRUK0030-R1"] }] } as never });
  const f = facetsOf(r, "HISTOLOGY")[0] as Cat | undefined;
  ok("B5: tracerx alone, CRUK0030-R1 — per patient, Invasive adenocarcinoma 1",
    f?.kind === "cat" && f.per === "patient" && show(countsOf(f)) === "Invasive adenocarcinoma=1",
    f?.kind === "cat" ? f.per + ": " + show(countsOf(f)) : "no categorical facet");
});

// ---- B6, B7: a numeric attribute ----------------------------------------------------------------------
await row("B6", async () => {
  const samples = [...await multiSampleSelection(HISTIO, 8, 4), ...await firstSamples(BLCA, 12)];
  await checkNum(`B6: ${samples.length} samples (one or two of each of 8 multi-sample histiocytosis patients, 12 of blca)`, [HISTIO, BLCA], "TOTAL_MUTATIONS", samples);
});
await row("B7", async () => { await checkNum("B7: no filter", [HISTIO, BLCA], "TOTAL_MUTATIONS"); });

console.log(failures ? `\n${failures} conflicting-level check(s) FAILED` : "\nall conflicting-level checks passed");
process.exit(failures ? 1 : 0);
