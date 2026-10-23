// Partitions: split one named cohort into child cohorts that are, by construction, disjoint and
// together exactly the parent — the grouping a comparison needs, as opposed to a set of
// independent filters that may overlap or quietly lose patients.
//
// Arms are an ORDERED list of clauses and the first match wins. Before a patient can be tested
// against an arm, every condition needed to decide the earlier arms must be knowable for them:
// an OQL arm needs the patient profiled for that gene and alteration type (the panel-aware
// rule — a patient whose panel omits KRAS is not KRAS wild-type), a clinical arm needs a
// recorded value. The pre-pass walks the arms as a decision chain:
//
//   for each arm j:
//     for each evaluability condition e of arm j not already required:
//       child "not evaluable for e"  = S ∧ ¬e        then S := S ∧ e
//     child arm j                   = S ∧ p_j       then S := S ∧ ¬p_j
//   child "Other"                   = S
//
// Every child branches off the running conjunction S with one condition and S continues with its
// complement, so the children partition the parent exactly. runAnalysis counts every child and
// checks the sum against the parent's count rather than trusting the construction.
//
// Pure and sync, like lib/cohort-extends.ts, and resolved just before it: every child is an
// ordinary cohort that `extends` its parent, so by the time anything compiles a cohort there is
// no partition left to know about.
import type { AnalysisDoc, Clause, CohortDef, Leaf, PartitionDef, ProfiledLeaf } from "./types.ts";
import { parseOql } from "./oql.ts";
import { OQL_PROFILE } from "./oql-parse.ts";

export const PARTITION_MAX_ARMS = 8;
export const PARTITION_SEP = " / ";

export type PartitionChildRole = "arm" | "other" | "notEvaluable";
export interface PartitionChild { name: string; role: PartitionChildRole; label: string }
export interface PartitionPlan {
  /** "<cohort> / <split>": the split's address, and the prefix of every child it makes */
  name: string; of: string;
  /** the split's own name, as stored on the cohort */
  split: string;
  children: PartitionChild[];
  /** arm conditions whose evaluability this engine cannot check (no "not evaluable" child is
   *  generated for them), named so the reader knows the Other arm may hold unknowns */
  unchecked: string[];
}

const PROFILE_WORD: Record<ProfiledLeaf["type"], string> = { MUTATION: "mutations", CNA: "copy number", SV: "structural variants" };

interface Evaluability { leaves: Leaf[]; unchecked: string[] }

function leafEvaluability(leaf: Leaf): Evaluability {
  const kind = (leaf as { kind?: string }).kind;
  if (kind === "oql") {
    const leaves: Leaf[] = [];
    const unchecked: string[] = [];
    for (const entry of parseOql((leaf as { q: string }).q)) {
      for (const spec of entry.specs) {
        const types = OQL_PROFILE[spec.type];
        if (!types) { unchecked.push(entry.gene + ": " + spec.type); continue; }
        for (const type of types) leaves.push({ kind: "profiled", type, gene: entry.gene });
      }
    }
    return { leaves, unchecked };
  }
  if (kind === "proteinPosition") return { leaves: [{ kind: "profiled", type: "MUTATION", gene: (leaf as { gene: string }).gene }], unchecked: [] };
  if (kind === "clinical") {
    const c = leaf as { attribute: string; per?: "patient" | "sample" };
    return { leaves: [{ kind: "clinical", attribute: c.attribute, ...(c.per === "sample" ? { per: "sample" as const } : {}), op: "!=", value: "" }], unchecked: [] };
  }
  // Membership facts (a list, a case list, a profiling status, the held-out half) are known for
  // every patient. Measurements and timelines are not, and this engine has no "was measured"
  // condition for them yet, so they are named rather than silently treated as known.
  if (kind === "patientList" || kind === "sampleList" || kind === "caseList" || kind === "profiled" || kind === "split" || kind === "upload")
    return { leaves: [], unchecked: [] };
  return { leaves: [], unchecked: [describeLeafBrief(leaf)] };
}

function clauseEvaluability(clause: Clause): Evaluability {
  if ((clause as { not?: unknown }).not) return clauseEvaluability((clause as { not: Clause }).not);
  const any = (clause as { any?: Leaf[] }).any;
  // "none of these" is only knowable when every one of them is
  const parts = Array.isArray(any) ? any.map(leafEvaluability) : [leafEvaluability(clause as Leaf)];
  return { leaves: parts.flatMap((p) => p.leaves), unchecked: parts.flatMap((p) => p.unchecked) };
}

function describeLeafBrief(leaf: Leaf): string {
  const l = leaf as unknown as Record<string, unknown>;
  if (l.kind === "genomicData") return String(l.gene) + " " + String(l.profileType);
  if (l.kind === "genericAssay") return String(l.entity) + " " + String(l.profileType);
  if (l.kind === "event" || (l.a && l.rel)) return "a timeline event";
  if (l.kind === "derived") return "the derived metric " + String(l.metric);
  return String(l.kind || "clause");
}

function notEvaluableLabel(e: Leaf): string {
  const l = e as unknown as Record<string, unknown>;
  if (l.kind === "profiled") return "Not profiled: " + String(l.gene) + " " + PROFILE_WORD[l.type as ProfiledLeaf["type"]];
  if (l.kind === "clinical") return "No " + String(l.attribute) + " recorded";
  return "Not evaluable";
}

/**
 * The running conjunction S. Conditions that hold are kept as clauses; "not this arm" conditions
 * are pooled, because ¬a ∧ ¬b = ¬(a ∨ b) lets every one of them share a single
 * {not: {any: [...]}} clause (8 leaves each) — a cohort takes at most 8 clauses, and an arm late
 * in a long list would otherwise need one per earlier arm.
 */
class Chain {
  private holds: Clause[] = [];
  private excluded: Leaf[] = [];
  require(c: Clause) { this.holds.push(c); }
  exclude(arm: Clause) {
    const inner = (arm as { not?: Leaf | { any: Leaf[] } }).not;
    if (inner) { this.holds.push(inner); return; }
    const any = (arm as { any?: Leaf[] }).any;
    for (const l of Array.isArray(any) ? any : [arm as Leaf])
      if (!this.excluded.some((x) => JSON.stringify(x) === JSON.stringify(l))) this.excluded.push(l);
  }
  clauses(): Clause[] {
    const out = [...this.holds];
    for (let i = 0; i < this.excluded.length; i += 8) {
      const chunk = this.excluded.slice(i, i + 8);
      out.push(chunk.length === 1 ? { not: chunk[0] } : { not: { any: chunk } });
    }
    return out;
  }
}

function validateArmName(partition: string, n: unknown): string {
  const name = typeof n === "string" ? n.trim() : "";
  if (!name) throw new Error("split “" + partition + "”: every arm needs a name");
  if (name.length > 80) throw new Error("split “" + partition + "”: arm name “" + name.slice(0, 40) + "…” is longer than 80 characters");
  return name;
}

/** The child cohort a partition generates for one of its arms (or Other / a not-evaluable bucket). */
export function partitionChildName(partition: string, label: string): string {
  return partition + PARTITION_SEP + label;
}

/** Plan one partition: the children's names, roles and defs, from the parent def. */
export function planPartition(name: string, def: Omit<PartitionDef, "split"> & { split?: string }, parent: CohortDef): { plan: PartitionPlan; defs: Record<string, CohortDef> } {
  if (!def || typeof def !== "object") throw new Error("split “" + name + "” must be an object");
  if (!Array.isArray(def.arms) || !def.arms.length) throw new Error("split “" + name + "” needs at least one arm");
  if (def.arms.length > PARTITION_MAX_ARMS)
    throw new Error("split “" + name + "” has " + def.arms.length + " arms; at most " + PARTITION_MAX_ARMS);
  if (parent.a && parent.rel && !parent.all)
    throw new Error("split “" + name + "”: “" + def.of + "” uses the shorthand event form — write it as all: [...] to split it");

  // Children are evaluated exactly where the parent is: same studies, same line gap.
  const inherit: CohortDef = {
    ...(parent.study ? { study: parent.study } : {}),
    ...(parent.studies ? { studies: parent.studies } : {}),
    ...(parent.lineGap != null ? { lineGap: parent.lineGap } : {})
  };
  const otherLabel = def.other == null ? "Other" : validateArmName(name, def.other);
  const children: PartitionChild[] = [];
  const defs: Record<string, CohortDef> = {};
  const add = (role: PartitionChildRole, label: string, all: Clause[]) => {
    const childName = partitionChildName(name, label);
    if (defs[childName]) throw new Error("split “" + name + "”: two children would both be named “" + label + "”");
    children.push({ name: childName, role, label });
    defs[childName] = { ...inherit, extends: def.of, all };
  };

  const S = new Chain();
  const required = new Set<string>();
  const unchecked: string[] = [];
  for (const arm of def.arms) {
    const label = validateArmName(name, arm && arm.name);
    if (!arm.where || typeof arm.where !== "object") throw new Error("split “" + name + "”: arm “" + label + "” needs a where clause");
    const ev = clauseEvaluability(arm.where);
    for (const u of ev.unchecked) if (!unchecked.includes(u)) unchecked.push(u);
    for (const e of ev.leaves) {
      const key = JSON.stringify(e);
      if (required.has(key)) continue;
      required.add(key);
      add("notEvaluable", notEvaluableLabel(e), [...S.clauses(), { not: e }]);
      S.require(e);
    }
    add("arm", label, [...S.clauses(), arm.where]);
    S.exclude(arm.where);
  }
  add("other", otherLabel, S.clauses());
  return { plan: { name, of: def.of, split: def.split || name, children, unchecked }, defs };
}

/**
 * Expand every partition into its child cohorts. Partitions may split a child of another
 * partition, so they resolve in dependency order; a cycle or a missing parent is rejected.
 */
export function resolvePartitions(doc: AnalysisDoc, parts: Record<string, Omit<PartitionDef, "split"> & { split?: string }>): { doc: AnalysisDoc; plans: PartitionPlan[] } {
  const names = Object.keys(parts);
  if (!names.length) return { doc, plans: [] };
  const cohorts: Record<string, CohortDef> = { ...(doc.cohorts || {}) };
  const plans: Record<string, PartitionPlan> = {};
  const producer: Record<string, string> = {}; // child cohort name -> partition producing it
  for (const n of names) {
    if (!n.trim()) throw new Error("split names must be non-empty");
    if (cohorts[n]) throw new Error("split “" + n + "” has the same name as a cohort — name the split differently");
  }
  // A child's name is fixed by its partition's name and arm labels, so who-produces-what is known
  // before any partition is planned.
  for (const n of names) {
    const p = parts[n];
    for (const arm of p?.arms || []) if (arm && typeof arm.name === "string") producer[partitionChildName(n, arm.name.trim())] = n;
  }
  const resolve = (n: string, chain: string[]): void => {
    if (plans[n]) return;
    if (chain.includes(n)) throw new Error("split “" + n + "” splits its own descendant: " + [...chain, n].join(" -> "));
    const p = parts[n];
    if (!p || typeof p.of !== "string" || !p.of) throw new Error("split “" + n + "” needs `of`: the cohort it splits");
    if (!cohorts[p.of] && producer[p.of]) resolve(producer[p.of], [...chain, n]);
    const parent = cohorts[p.of];
    if (!parent) throw new Error("split “" + n + "” splits unknown cohort “" + p.of + "”");
    const { plan, defs } = planPartition(n, p, parent);
    for (const [cn, cd] of Object.entries(defs)) {
      if (cohorts[cn]) throw new Error("split “" + n + "” would create “" + cn + "”, which already exists");
      cohorts[cn] = cd;
    }
    plans[n] = plan;
  };
  for (const n of names) resolve(n, []);
  return { doc: { ...doc, cohorts }, plans: names.map((n) => plans[n]) };
}

/** The children a view compares when it names a partition: the arms and Other, never the
 *  not-evaluable buckets (those are disclosed in the partition's own readback). */
/**
 * After `extends` has spliced each child's ancestors in, a child may need more clauses than a
 * cohort takes. Say which, and why, instead of the compiler's generic refusal.
 */
export function assertPartitionChildrenFit(cohorts: Record<string, CohortDef>, plans: PartitionPlan[], max = 8): void {
  for (const plan of plans) for (const c of plan.children) {
    const n = (cohorts[c.name]?.all || []).length;
    if (n > max)
      throw new Error("split “" + plan.name + "”: “" + c.label + "” needs " + n + " conditions (those of “" + plan.of +
        "” and every split above it, plus this split's own), and a cohort takes at most " + max +
        " — simplify the cohort being split, or split it in fewer levels");
  }
}

export function comparableChildren(plan: PartitionPlan): string[] {
  return plan.children.filter((c) => c.role !== "notEvaluable").map((c) => c.name);
}
