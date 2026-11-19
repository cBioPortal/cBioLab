/**
 * Live check: the treatment tables (STS-OT-6) count what the portal's rule says, and a click on a
 * row SELECTS what the row counts.
 *
 * The tables come from one pair of queries (lib/explore.ts buildTreatmentFacets) and a click's
 * cohort from a compiled treatment clause (lib/cohort2.ts); nothing else forces them to agree. On the
 * committed fixture study (test/fixtures/peer-study, served by scripts/peer-db.ts) the expected
 * tables are worked out here from the study's own files, by the portal's rule, with no SQL:
 *   - a patient counts once under each AGENT of its Treatment events;
 *   - a sample's time is the start of its Sample Acquisition or Specimen event; it is "Pre" an
 *     agent when that is on or before the patient's FIRST treatment with it, else "Post"
 *     (FX-P01 gets OSIMERTINIB at days 17 and 343 and has a sample at 270: Post, not Pre);
 *   - an event naming a sample the study does not hold is ignored.
 * Then every row's click is compiled and counted, undrafted and under a draft. On the warehouse,
 * coadread's rows are pinned to cbioportal.org's `/api/treatments/{patient,sample}-counts/fetch`.
 *
 * Run: node --env-file=.env.local scripts/check-treatments.ts
 */
import { readFileSync } from "node:fs";
import { compileCohortDef } from "../lib/cohort2.ts";
import { buildTreatmentFacets } from "../lib/explore.ts";
import { chQuery, connById, type ChConn } from "../lib/ch.ts";
import { sampleTreatmentKey, treatmentClause } from "../lib/treatment-tables.ts";
import type { TreatmentFacets } from "../lib/types.ts";

const FIXTURE = "cbiolab_peer_fixture";
const DRAFT = { all: [{ kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] };

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

/** a fixture file's rows by its header */
const rowsOf = (file: string): Record<string, string>[] => {
  const lines = readFileSync(new URL("../test/fixtures/peer-study/" + file, import.meta.url), "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
  const head = lines[0].split("\t");
  return lines.slice(1).map((l) => Object.fromEntries(l.split("\t").map((v, i) => [head[i], v])));
};

/** the tables by the portal's rule, from the fixture's files */
function expected(): { patients: Map<string, number>; samples: Map<string, number> } {
  const held = new Set(rowsOf("data_clinical_sample.txt").map((r) => r.SAMPLE_ID));
  const tx = rowsOf("data_timeline_treatment.txt").filter((r) => r.EVENT_TYPE.toLowerCase() === "treatment" && r.AGENT);
  const firstStart = new Map<string, number>();   // patient|agent → first start
  for (const r of tx) {
    const k = r.PATIENT_ID + "|" + r.AGENT;
    firstStart.set(k, Math.min(firstStart.get(k) ?? Infinity, Number(r.START_DATE)));
  }
  const patients = new Map<string, number>();
  for (const k of firstStart.keys()) { const agent = k.split("|")[1]; patients.set(agent, (patients.get(agent) || 0) + 1); }
  const taken = new Map<string, { patient: string; t: number }>();
  for (const r of rowsOf("data_timeline_specimen.txt"))
    if (["sample acquisition", "specimen"].includes(r.EVENT_TYPE.toLowerCase()) && held.has(r.SAMPLE_ID)) {
      const was = taken.get(r.SAMPLE_ID);
      taken.set(r.SAMPLE_ID, { patient: r.PATIENT_ID, t: Math.min(was?.t ?? Infinity, Number(r.START_DATE)) });
    }
  const samples = new Map<string, number>();
  for (const [k, st] of firstStart) {
    const [patient, agent] = k.split("|");
    for (const s of taken.values()) if (s.patient === patient) {
      const key = sampleTreatmentKey(agent, s.t <= st ? "Pre" : "Post");
      samples.set(key, (samples.get(key) || 0) + 1);
    }
  }
  return { patients, samples };
}

const asMaps = (t: TreatmentFacets | null) => ({
  patients: new Map((t?.patients || []).map((r) => [r.agent, r.n])),
  samples: new Map((t?.samples || []).map((r) => [sampleTreatmentKey(r.agent, r.time), r.n])),
});
const diff = (a: Map<string, number>, b: Map<string, number>) =>
  [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).map((k) => `${k}: ${a.get(k)} vs ${b.get(k)}`);

/** what a definition selects in one study: its patients and its samples */
const selects = async (def: unknown, study: string, conn: ChConn) => {
  const sql = compileCohortDef(def as never, { study, db: conn.db });
  const r = (await chQuery<{ p: string; s: string }>(`SELECT uniqExact(pid) AS p, uniqExact(sid) AS s FROM (${sql})`, conn)).data[0];
  return { patients: Number(r.p), samples: Number(r.s) };
};
const tablesOf = (study: string, conn: ChConn, draft: unknown) =>
  buildTreatmentFacets({ studies: [study], connByStudy: new Map([[study, conn]]), profilesByStudy: new Map([[study, {}]]), draft: draft as never });

/** every row of both tables selects, under `draft`, exactly what it counts */
async function clicksAgree(study: string, conn: ChConn, t: TreatmentFacets, draft: { all: unknown[] } | null): Promise<string[]> {
  const bad: string[] = [];
  const base = draft ? draft.all : [];
  for (const r of t.patients) {
    const c = treatmentClause("patient", [r.agent]);
    if (!("clauses" in c)) { bad.push(r.agent + ": " + c.why); continue; }
    const got = (await selects({ all: [...base, ...c.clauses] }, study, conn)).patients;
    if (got !== r.n) bad.push(`patients ${r.agent}: shows ${r.n}, selects ${got}`);
  }
  for (const r of t.samples) {
    const c = treatmentClause("sample", [sampleTreatmentKey(r.agent, r.time)]);
    if (!("clauses" in c)) { bad.push(r.agent + ": " + c.why); continue; }
    const got = (await selects({ all: [...base, ...c.clauses] }, study, conn)).samples;
    if (got !== r.n) bad.push(`samples ${r.agent} ${r.time}: shows ${r.n}, selects ${got}`);
  }
  return bad;
}

const fx = connById("b");
if (!fx) ok("connection b (the fixture study)", false, "no such connection");
else {
  const plain = await tablesOf(FIXTURE, fx, null);
  const want = expected(), got = asMaps(plain);
  const dp = diff(want.patients, got.patients), ds = diff(want.samples, got.samples);
  ok(`${FIXTURE}: patients per agent, as the files say by the portal's rule`, dp.length === 0 && want.patients.size > 0,
    dp.length ? dp.slice(0, 3).join("; ") : `${want.patients.size} agents agree`);
  ok(`${FIXTURE}: samples per agent and time, as the files say (first start, held samples only)`, ds.length === 0 && want.samples.size > 0,
    ds.length ? ds.slice(0, 3).join("; ") : `${want.samples.size} rows agree`);
  const osiPost = want.samples.get(sampleTreatmentKey("OSIMERTINIB", "Post"));
  ok(`${FIXTURE}: a later course of the same agent does not make an earlier sample Pre (FX-P01-T2)`,
    osiPost != null && osiPost > 0 && got.samples.get(sampleTreatmentKey("OSIMERTINIB", "Post")) === osiPost, `Post ${osiPost}`);
  for (const draft of [null, DRAFT]) {
    const t = draft ? await tablesOf(FIXTURE, fx, draft) : plain;
    const bad = t ? await clicksAgree(FIXTURE, fx, t, draft) : ["no tables"];
    ok(`${FIXTURE}${draft ? " (drafted)" : ""}: every row selects what it shows`, bad.length === 0,
      bad.length ? bad.slice(0, 3).join("; ") : `${(t?.patients.length || 0) + (t?.samples.length || 0)} rows agree exactly`);
  }
  // an agent the study never gives: refused by name, or nobody with ifHeld
  let refusal = "";
  try { await selects({ all: [{ kind: "treatment", agents: ["Osimertinib"] }] }, FIXTURE, fx); } catch (e) { refusal = String((e as Error).message); }
  ok(`${FIXTURE}: an unknown agent is refused by name`, /no patient in \S+ is treated with 'Osimertinib'/.test(refusal), refusal.slice(0, 160));
  ok(`${FIXTURE}: with ifHeld it matches nobody`,
    (await selects({ all: [{ kind: "treatment", agents: ["Osimertinib"], time: "Pre", ifHeld: true }] }, FIXTURE, fx)).samples === 0);
}

const wh = connById("a");
if (wh) {
  // cbioportal.org, coadread_tcga_pan_can_atlas_2018, tier Agent
  const study = "coadread_tcga_pan_can_atlas_2018";
  const t = await tablesOf(study, wh, null), m = asMaps(t);
  const pins: [string, number | undefined, number][] = [
    ["patients Fluorouracil", m.patients.get("Fluorouracil"), 156], ["patients Leucovorin", m.patients.get("Leucovorin"), 137],
    ["samples Fluorouracil Pre", m.samples.get("Fluorouracil::Pre"), 155], ["samples Fluorouracil Post", m.samples.get("Fluorouracil::Post"), 1],
    ["samples Leucovorin Pre", m.samples.get("Leucovorin::Pre"), 136], ["patients treated", t?.totalPatients, 214], ["samples", t?.totalSamples, 214],
  ];
  const off = pins.filter(([, g, w]) => g !== w);
  ok(`${study}: as cbioportal.org counts it`, off.length === 0 && m.patients.size === 33 && m.samples.size === 37,
    off.length ? off.map(([k, g, w]) => `${k} ${g} vs ${w}`).join("; ") : `33 agents, 37 rows`);
  const td = await tablesOf(study, wh, DRAFT);
  const bad = td ? await clicksAgree(study, wh, { ...td, patients: td.patients.slice(0, 5), samples: td.samples.slice(0, 6) }, DRAFT) : ["no tables"];
  ok(`${study} (drafted): rows select what they show`, bad.length === 0, bad.slice(0, 3).join("; "));
}

console.log(failures ? `\n${failures} treatment check(s) FAILED` : "\nall treatment checks passed");
process.exit(failures ? 1 : 0);
