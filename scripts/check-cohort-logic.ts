/**
 * Cohort logic, checked by its consequences on the live database.
 *
 * There is no reference library for "which patients are in this cohort", so these checks do not
 * compare against one. They test relationships that must hold whatever the right answer is: the
 * patients matching "A and B" must be exactly those in both A and B, a cohort and its negation
 * must together be the whole study, a split must account for every patient once. The engine's
 * SQL computes each side; the comparison is done here, in plain set arithmetic over patient ids,
 * so a mistake in how the compiler combines clauses cannot also be made by the check.
 *
 * Every check is exact. Run: npm run check:cohorts
 * With RECORD=1 (npm run verify) it writes docs/verification/cohort-logic.json, which /verification reads.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { compileCohortDef, basePatientsSql } from "../lib/cohort2.ts";
import { runAnalysis, studyProfiles } from "../lib/analysis.ts";
import { chQuery, DB, PRIMARY } from "../lib/ch.ts";
import { oncokbPin } from "../lib/annotation.ts";
import type { CohortDef, Clause, AnalysisDoc } from "../lib/types.ts";

const OUT = new URL("../docs/verification/cohort-logic.json", import.meta.url);

interface Check { study: string; group: string; claim: string; detail: string; pass: boolean }
const checks: Check[] = [];
const record = (study: string, group: string, claim: string, pass: boolean, detail: string) => {
  checks.push({ study, group, claim, detail, pass });
  console.log(`${pass ? "PASS" : "FAIL"} [${study}] ${claim}  (${detail})`);
};

const pin = await oncokbPin();
const profileCache = new Map<string, { profiles: string[]; gaProfiles: string[] }>();
async function ids(study: string, def: CohortDef | null): Promise<Set<string>> {
  if (!profileCache.has(study)) profileCache.set(study, await studyProfiles(study));
  const sql = def ? compileCohortDef(def, { study, db: DB, oncokbPin: pin, ...profileCache.get(study)! }) : basePatientsSql(study, DB);
  return new Set((await chQuery<{ pid: string }>("SELECT pid FROM (" + sql + ")", PRIMARY)).data.map((r) => r.pid));
}
const leaf = (study: string, c: Clause) => ids(study, { all: [c] });

const and = (a: Set<string>, b: Set<string>) => new Set([...a].filter((x) => b.has(x)));
const or = (a: Set<string>, b: Set<string>) => new Set([...a, ...b]);
const minus = (a: Set<string>, b: Set<string>) => new Set([...a].filter((x) => !b.has(x)));
const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
const within = (a: Set<string>, b: Set<string>) => [...a].every((x) => b.has(x));
const n = (s: Set<string>) => s.size.toLocaleString();
/** a description of how two sets differ, for a failure; their sizes when they agree */
const diff = (label: string, ours: Set<string>, expected: Set<string>) => same(ours, expected)
  ? `${label}: ${n(ours)} patients, identical`
  : `${label}: engine ${n(ours)}, expected ${n(expected)} (${minus(ours, expected).size} extra, ${minus(expected, ours).size} missing)`;

/** The algebra of clauses, for one study and three conditions of different kinds. */
async function algebra(study: string, A: Clause, B: Clause, C: Clause) {
  const base = await ids(study, null);
  const [a, b, c] = await Promise.all([leaf(study, A), leaf(study, B), leaf(study, C)]);
  record(study, "sanity", "each test condition picks out a real, partial group of patients",
    [a, b, c].every((s) => s.size > 0 && s.size < base.size && within(s, base)),
    `${n(a)}, ${n(b)} and ${n(c)} of ${n(base)} patients`);

  const ab = await ids(study, { all: [A, B] });
  record(study, "and", "\"A and B\" is exactly the patients in both A and B", same(ab, and(a, b)), diff("A and B", ab, and(a, b)));
  const ba = await ids(study, { all: [B, A] });
  record(study, "and", "the order conditions are written in does not change the cohort", same(ab, ba), diff("B and A vs A and B", ba, ab));
  const abc = await ids(study, { all: [A, B, C] });
  record(study, "and", "adding a condition can only narrow a cohort, never grow it", within(abc, ab) && within(ab, a),
    `A ${n(a)} ⊇ A and B ${n(ab)} ⊇ A and B and C ${n(abc)}`);
  record(study, "and", "three conditions combine the same way two do", same(abc, and(and(a, b), c)), diff("A and B and C", abc, and(and(a, b), c)));

  const aOrB = await ids(study, { all: [{ any: [A, B] as never }] });
  record(study, "or", "\"A or B\" is exactly the patients in either", same(aOrB, or(a, b)), diff("A or B", aOrB, or(a, b)));
  record(study, "or", "counts add up: |A or B| = |A| + |B| − |A and B|", aOrB.size === a.size + b.size - ab.size,
    `${n(aOrB)} = ${n(a)} + ${n(b)} − ${n(ab)}`);

  const notA = await ids(study, { all: [{ not: A as never }] });
  record(study, "not", "\"not A\" is every other patient in the study", same(notA, minus(base, a)), diff("not A", notA, minus(base, a)));
  record(study, "not", "A and \"not A\" share nobody and together are the whole study",
    and(a, notA).size === 0 && same(or(a, notA), base), `${n(a)} + ${n(notA)} = ${n(base)}`);
  const notAorB = await ids(study, { all: [{ not: { any: [A, B] } as never }] });
  const notAnotB = await ids(study, { all: [{ not: A as never }, { not: B as never }] });
  record(study, "not", "\"not (A or B)\" equals \"not A and not B\" (De Morgan's law)",
    same(notAorB, notAnotB) && same(notAorB, minus(base, or(a, b))), diff("not (A or B)", notAorB, minus(base, or(a, b))));
}

/** Refinements of one gene's alterations must nest, and OQL's union must be a union. */
async function oqlNesting(study: string, gene: string, allele: string) {
  const [allele_, mut, amp, mutAmp, driver] = await Promise.all([
    leaf(study, { kind: "oql", q: `${gene}: ${allele}` }), leaf(study, { kind: "oql", q: `${gene}: MUT` }),
    leaf(study, { kind: "oql", q: `${gene}: AMP` }), leaf(study, { kind: "oql", q: `${gene}: MUT AMP` }),
    leaf(study, { kind: "oql", q: `${gene}: MUT_DRIVER` }),
  ]);
  record(study, "oql", `${gene} ${allele} patients are all among ${gene}-mutated patients`, allele_.size > 0 && within(allele_, mut),
    `${n(allele_)} ⊆ ${n(mut)}`);
  record(study, "oql", `${gene} driver mutations are a subset of all ${gene} mutations`, driver.size > 0 && within(driver, mut),
    `${n(driver)} ⊆ ${n(mut)}`);
  record(study, "oql", `"${gene}: MUT AMP" is exactly mutated or amplified`, same(mutAmp, or(mut, amp)), diff("MUT AMP", mutAmp, or(mut, amp)));
}

/** A categorical attribute's values partition the patients who have one; a threshold splits a number. */
async function clinicalPartition(study: string, attribute: string, values: string[], numeric: string, cut: number) {
  const recorded = await leaf(study, { kind: "clinical", attribute, op: "!=", value: "" } as Clause);
  const parts = await Promise.all(values.map((v) => leaf(study, { kind: "clinical", attribute, values: [v] } as Clause)));
  const union = parts.reduce(or, new Set<string>());
  const overlap = parts.reduce((t, p, i) => t + parts.slice(i + 1).reduce((u, q) => u + and(p, q).size, 0), 0);
  record(study, "clinical", `each patient has exactly one ${attribute}: the values share nobody and cover everyone recorded`,
    overlap === 0 && same(union, recorded), `${parts.map(n).join(" + ")} = ${n(union)}; recorded ${n(recorded)}; overlap ${overlap}`);
  const lo = await leaf(study, { kind: "clinical", attribute: numeric, op: "<", value: cut } as Clause);
  const hi = await leaf(study, { kind: "clinical", attribute: numeric, op: ">=", value: cut } as Clause);
  const anyN = await leaf(study, { kind: "clinical", attribute: numeric, range: { gte: -1e12 } } as Clause);
  record(study, "clinical", `${numeric} below ${cut} and at-or-above ${cut} share nobody and cover everyone with a value`,
    and(lo, hi).size === 0 && same(or(lo, hi), anyN), `${n(lo)} + ${n(hi)} = ${n(anyN)}`);
}

/** Splits, recomputed by hand from their arm conditions and compared child by child. */
async function splitByHand(study: string, parentDef: CohortDef, arms: { name: string; where: Clause }[], other: string) {
  const doc: AnalysisDoc = {
    study, cohorts: { P: { ...parentDef, splits: { S: { other, arms } } } as never },
    views: [],
  };
  const result = await runAnalysis(doc);
  const part = result.splits?.["P / S"];
  record(study, "splits", "the engine reports that the split's children add up to the parent",
    !!part?.conserved, part ? `${part.children.map((c) => c.count.toLocaleString()).join(" + ")} = ${part.sum.toLocaleString()} of ${part.parentCount.toLocaleString()}` : "no split result");
  // first match wins: each arm is its condition, minus everyone an earlier arm took
  let remaining = await ids(study, parentDef);
  const expected: Record<string, number> = {};
  for (const arm of arms) {
    const hit = and(remaining, await leaf(study, arm.where));
    expected[arm.name] = hit.size;
    remaining = minus(remaining, hit);
  }
  const got = Object.fromEntries((part?.children || []).map((c) => [c.label, c.count]));
  const notProfiled = (part?.children || []).filter((c) => c.role === "notEvaluable").reduce((t, c) => t + c.count, 0);
  const armsAgree = arms.every((a) => got[a.name] === expected[a.name]);
  const restAgree = (got[other] ?? 0) + notProfiled === remaining.size;
  record(study, "splits", "every arm holds exactly the patients a by-hand first-match-wins pass puts there",
    armsAgree && restAgree,
    arms.map((a) => `${a.name} ${got[a.name]}/${expected[a.name]}`).join(", ") + `, rest ${(got[other] ?? 0) + notProfiled}/${remaining.size}`);
}

/** Lines of therapy: reaching line k+1 requires reaching line k. */
async function lineNesting(study: string) {
  const line = (k: number) => leaf(study, { kind: "event", a: { eventType: "Treatment line (derived)", attrs: [{ key: "LINE_NO", value: String(k) }] }, rel: { type: "NONE" } } as Clause);
  const ls = [await line(1), await line(2), await line(3), await line(4)];
  record(study, "timeline", "everyone who reached a later line of therapy also reached every earlier one",
    ls.every((l, i) => i === 0 || within(l, ls[i - 1])) && ls[3].size > 0, ls.map((l, i) => `line ${i + 1}: ${n(l)}`).join(" ⊇ "));
}

/** The held-out halves used for discovery/validation: disjoint, complete, about even. */
async function heldOutHalves(study: string) {
  const base = await ids(study, null);
  const d = await leaf(study, { kind: "split", part: "discovery" });
  const v = await leaf(study, { kind: "split", part: "validation" });
  const share = d.size / base.size;
  record(study, "halves", "discovery and validation halves share nobody, cover everyone, and are close to 50/50",
    and(d, v).size === 0 && same(or(d, v), base) && Math.abs(share - 0.5) < 0.02, `${n(d)} + ${n(v)} = ${n(base)} (${(share * 100).toFixed(1)}% discovery)`);
  const again = await leaf(study, { kind: "split", part: "discovery" });
  record(study, "halves", "the halves are the same every time they are drawn", same(d, again), diff("discovery, twice", again, d));
}

const CHORD = "msk_chord_2024";
await algebra(CHORD, { kind: "oql", q: "TP53: MUT" }, { kind: "clinical", attribute: "SMOKING_PREDICTIONS_3_CLASSES", values: ["Never"] } as Clause,
  { kind: "event", a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] }, rel: { type: "NONE" } } as Clause);
await algebra("brca_tcga", { kind: "oql", q: "PIK3CA: MUT" }, { kind: "oql", q: "MYC: AMP" }, { kind: "clinical", attribute: "AGE", op: ">=", value: 60 } as Clause);
await oqlNesting(CHORD, "KRAS", "G12C");
await oqlNesting("brca_tcga", "PIK3CA", "H1047R");
await clinicalPartition(CHORD, "GENDER", ["Female", "Male", "Unknown"], "CURRENT_AGE_DEID", 65);
await splitByHand(CHORD, { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"], per: "sample" } as Clause] },
  [{ name: "G12C", where: { kind: "oql", q: "KRAS: G12C" } }, { name: "other KRAS", where: { kind: "oql", q: "KRAS: MUT" } }], "KRAS wild-type");
await splitByHand(CHORD, { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Breast Cancer"], per: "sample" } as Clause] },
  [{ name: "PIK3CA", where: { kind: "oql", q: "PIK3CA: MUT" } }, { name: "TP53", where: { kind: "oql", q: "TP53: MUT" } }], "neither");
await lineNesting(CHORD);
await heldOutHalves(CHORD);

const failed = checks.filter((c) => !c.pass).length;
if (process.env.RECORD) mkdirSync(new URL(".", OUT), { recursive: true });
if (process.env.RECORD) writeFileSync(OUT, JSON.stringify({
  ranAt: new Date().toISOString(),
  commit: (() => { try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return null; } })(),
  total: checks.length, pass: checks.length - failed,
  checks,
}, null, 1) + "\n");
console.log(failed ? `\n${failed} of ${checks.length} cohort-logic checks FAILED` : `\nall ${checks.length} cohort-logic checks hold`);
process.exit(failed ? 1 : 0);
