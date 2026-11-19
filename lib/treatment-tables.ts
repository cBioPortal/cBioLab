// cBioPortal's treatment tables (STS-OT-6), "Treatment per Patient" and "Treatment per Sample
// (pre/post)": the timeline events they read, the clause a selection on them adds, and the sample
// table's row order. No server imports, so the page, the compiler and the tests read the same rules.
import { CLINICAL_VALUES_LIMIT, limitRefusal } from "./filter-limits.ts";

/** a treatment is an event of this type (any case) with an AGENT */
export const TREATMENT_EVENT = "treatment";
/** a sample's time is the start of an event of one of these types (any case) naming it by SAMPLE_ID; the portal reads no other */
export const SAMPLE_TIME_EVENTS = ["sample acquisition", "specimen"] as const;

export type TreatmentTime = "Pre" | "Post";
/** a sample-table row's key: the agent and the time */
export const sampleTreatmentKey = (agent: string, time: TreatmentTime) => agent + "::" + time;

function parseSampleKey(key: string): { agent: string; time: TreatmentTime } | null {
  const m = /^(.*)::(Pre|Post)$/.exec(key);
  return m ? { agent: m[1], time: m[2] as TreatmentTime } : null;
}

/**
 * The clause a table adds for its checked rows (Union, the portal's default: any of them), or why
 * it cannot. Patient rows are agents; sample rows are agent and time, one leaf per time.
 */
export function treatmentClause(level: "patient" | "sample", keys: string[], op: "union" | "intersection" = "union"): { clauses: unknown[] } | { why: string } {
  if (!keys.length) return { why: "no treatment is checked" };
  if (keys.some((k) => !k || /^::(Pre|Post)$/.test(k))) return { why: "a treatment with no name cannot be filtered on" };
  // Intersection, as on the gene tables (STS-GT-9): each checked row its own clause, every one must hold
  if (op === "intersection" && keys.length > 1) {
    const one = keys.map((k) => treatmentClause(level, [k]));
    const bad = one.find((r): r is { why: string } => "why" in r);
    return bad ?? { clauses: one.flatMap((r) => (r as { clauses: unknown[] }).clauses) };
  }
  if (level === "patient") {
    const refusal = limitRefusal(keys.length, CLINICAL_VALUES_LIMIT, "treatments");
    return refusal ? { why: refusal } : { clauses: [{ kind: "treatment", agents: keys, ifHeld: true }] };
  }
  const rows = keys.map(parseSampleKey).filter((r): r is NonNullable<typeof r> => !!r);
  const leaves = (["Pre", "Post"] as const).map((time) => ({ time, agents: rows.filter((r) => r.time === time).map((r) => r.agent) }))
    .filter((l) => l.agents.length);
  for (const l of leaves) {
    const refusal = limitRefusal(l.agents.length, CLINICAL_VALUES_LIMIT, l.time + " treatments");
    if (refusal) return { why: refusal };
  }
  // ifHeld: over several studies, one that never gives an agent has none of its cases rather than refusing
  const as = leaves.map((l) => ({ kind: "treatment", agents: l.agents, time: l.time, ifHeld: true }));
  return { clauses: [as.length === 1 ? as[0] : { any: as }] };
}

/** a top-level clause of this table's own: its treatment leaves, or none */
export function ownTreatmentLeaves(c: unknown, level: "patient" | "sample"): { agents: string[]; time?: TreatmentTime }[] {
  const mine = (x: unknown) => { const l = x as { kind?: string; time?: unknown; agents?: unknown };
    return !!l && l.kind === "treatment" && Array.isArray(l.agents) && (level === "sample") === (l.time != null); };
  const any = (c as { any?: unknown[] })?.any;
  const leaves = Array.isArray(any) ? any : [c];
  return leaves.length && leaves.every(mine) ? leaves as { agents: string[]; time?: TreatmentTime }[] : [];
}

/** the rows a draft's top-level clauses already filter on, as row keys */
export function appliedTreatmentKeys(def: { all?: unknown[] } | null | undefined, level: "patient" | "sample"): string[] {
  const out = new Set<string>();
  for (const c of def?.all || []) for (const l of ownTreatmentLeaves(c, level))
    for (const a of l.agents) out.add(level === "patient" ? String(a) : sampleTreatmentKey(String(a), l.time!));
  return [...out];
}

/**
 * The sample table's order, as the portal's: a treatment's Pre and Post rows together, the
 * treatments by their larger count, then Pre before Post ("Fluorouracil Pre 155, Fluorouracil Post
 * 1, Leucovorin Pre 136 …").
 */
export function sampleTreatmentOrder<T extends { agent: string; time: TreatmentTime; n: number }>(rows: T[]): T[] {
  const top = new Map<string, number>();
  for (const r of rows) top.set(r.agent, Math.max(top.get(r.agent) ?? 0, r.n));
  return [...rows].sort((a, b) => top.get(b.agent)! - top.get(a.agent)! || (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0) ||
    (a.time === b.time ? 0 : a.time === "Pre" ? -1 : 1));
}

/** each table's ⓘ, as the portal's chart description (StudyViewUtils' chart metas) */
export const TREATMENT_TABLE_DESCRIPTIONS = {
  patient: "List of treatments and the corresponding number of patients treated",
  sample: "List of treatments and the corresponding number of samples acquired before treatment or after/on treatment",
} as const;

/** a table's Download ▸ Data, as the portal writes it (getPatientTreatmentDownloadData / getSampleTreatmentDownloadData): its rows in the order shown */
export function treatmentTableTsv(level: "patient" | "sample", rows: { agent: string; time?: TreatmentTime; n: number }[]): string {
  const head = level === "patient" ? ["Treatment", "#"] : ["Treatment", "Pre/Post", "#"];
  return [head, ...rows.map((r) => level === "patient" ? [r.agent, String(r.n)] : [r.agent, String(r.time ?? ""), String(r.n)])].map((l) => l.join("\t")).join("\n");
}
