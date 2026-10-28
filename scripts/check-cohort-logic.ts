/**
 * Cohort logic, checked by its consequences on the live database.
 *
 * There is no reference library for "which patients are in this cohort", so these checks do not
 * compare against one. They test relationships that must hold whatever the right answer is: the
 * patients matching "A and B" must be exactly those in both A and B, a cohort and its negation
 * must together be the whole study, a split must account for every patient once. The engine's
 * SQL computes each side; the comparison is done here, in plain set arithmetic over patient ids,
 * so a mistake in how the compiler combines clauses cannot also be made by the check. For the
 * simpler leaves there is a reference after all, written here: generated definitions are evaluated
 * over the study's raw rows and compared with the compiled SQL (the last section).
 *
 * Every check is exact. Run: npm run check:cohorts
 * With RECORD=1 (npm run verify) it writes docs/verification/cohort-logic.json, which /verification reads
 * (or REPORT_DIR/cohort-logic.json when REPORT_DIR is set, as in CI).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { compileCohortDef, memberSamplesSql } from "../lib/cohort2.ts";
import { runAnalysis, studyProfiles } from "../lib/analysis.ts";
import { chQuery, DB, PRIMARY } from "../lib/ch.ts";
import { oncokbPin } from "../lib/annotation.ts";
import fc from "fast-check";
import type { CohortDef, Clause, AnalysisDoc } from "../lib/types.ts";

/** the report's folder: docs/verification/ (what the page shows), or REPORT_DIR (what CI uploads) */
const OUT = new URL("cohort-logic.json", process.env.REPORT_DIR ? pathToFileURL(process.env.REPORT_DIR + "/") : new URL("../docs/verification/", import.meta.url));

interface Check { study: string; group: string; claim: string; detail: string; pass: boolean }
const checks: Check[] = [];
const record = (study: string, group: string, claim: string, pass: boolean, detail: string) => {
  checks.push({ study, group, claim, detail, pass });
  console.log(`${pass ? "PASS" : "FAIL"} [${study}] ${claim}  (${detail})`);
};

const pin = await oncokbPin();
const profileCache = new Map<string, { profiles: string[]; gaProfiles: string[] }>();
async function cohortSql(study: string, def: CohortDef | null): Promise<string> {
  if (!profileCache.has(study)) profileCache.set(study, await studyProfiles(study));
  return compileCohortDef(def, { study, db: DB, oncokbPin: pin, ...profileCache.get(study)! });
}
/** A cohort is a set of samples: every check below is set arithmetic over its sample ids. */
async function ids(study: string, def: CohortDef | null): Promise<Set<string>> {
  const sql = memberSamplesSql(await cohortSql(study, def));
  return new Set((await chQuery<{ sid: string }>("SELECT sid FROM (" + sql + ")", PRIMARY)).data.map((r) => r.sid));
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
  ? `${label}: ${n(ours)} samples, identical`
  : `${label}: engine ${n(ours)}, expected ${n(expected)} (${minus(ours, expected).size} extra, ${minus(expected, ours).size} missing)`;

/** The algebra of clauses, for one study and three conditions of different kinds. */
async function algebra(study: string, A: Clause, B: Clause, C: Clause) {
  const base = await ids(study, null);
  const [a, b, c] = await Promise.all([leaf(study, A), leaf(study, B), leaf(study, C)]);
  record(study, "sanity", "each test condition picks out a real, partial group of samples",
    [a, b, c].every((s) => s.size > 0 && s.size < base.size && within(s, base)),
    `${n(a)}, ${n(b)} and ${n(c)} of ${n(base)} samples`);

  const ab = await ids(study, { all: [A, B] });
  record(study, "and", "\"A and B\" is exactly the samples in both A and B", same(ab, and(a, b)), diff("A and B", ab, and(a, b)));
  const ba = await ids(study, { all: [B, A] });
  record(study, "and", "the order conditions are written in does not change the cohort", same(ab, ba), diff("B and A vs A and B", ba, ab));
  const abc = await ids(study, { all: [A, B, C] });
  record(study, "and", "adding a condition can only narrow a cohort, never grow it", within(abc, ab) && within(ab, a),
    `A ${n(a)} ⊇ A and B ${n(ab)} ⊇ A and B and C ${n(abc)}`);
  record(study, "and", "three conditions combine the same way two do", same(abc, and(and(a, b), c)), diff("A and B and C", abc, and(and(a, b), c)));

  const aOrB = await ids(study, { all: [{ any: [A, B] as never }] });
  record(study, "or", "\"A or B\" is exactly the samples in either", same(aOrB, or(a, b)), diff("A or B", aOrB, or(a, b)));
  record(study, "or", "counts add up: |A or B| = |A| + |B| − |A and B|", aOrB.size === a.size + b.size - ab.size,
    `${n(aOrB)} = ${n(a)} + ${n(b)} − ${n(ab)}`);

  const notA = await ids(study, { all: [{ not: A as never }] });
  record(study, "not", "\"not A\" is every other sample in the study", same(notA, minus(base, a)), diff("not A", notA, minus(base, a)));
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

/**
 * A profiled clause naming several genes selects exactly the patients profiled for each of them —
 * the intersection of the one-gene clauses — and "not altered, profiled for all" never reaches a
 * patient some gene's panel did not cover.
 */
async function profiledGeneList(study: string, type: "MUTATION" | "CNA", genes: string[]) {
  const [list, ...singles] = await Promise.all([
    leaf(study, { kind: "profiled", type, genes } as Clause),
    ...genes.map((gene) => leaf(study, { kind: "profiled", type, gene } as Clause)),
  ]);
  const expected = singles.slice(1).reduce((a, b) => and(a, b), singles[0]);
  record(study, "profiled", `profiled for ${type} in every one of ${genes.join(", ")} is the intersection of each gene's profiled patients`,
    list.size > 0 && same(list, expected), diff("gene list", list, expected) + " · each gene: " + singles.map(n).join(" / "));
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
  record(study, "splits", "the engine reports that the split's children's samples add up to the parent's",
    !!part?.conserved, part ? `${part.children.map((c) => c.samples.toLocaleString()).join(" + ")} = ${part.sum.toLocaleString()} of ${part.parentSamples.toLocaleString()} samples` : "no split result");
  // first match wins, per sample: each arm is its condition, minus every sample an earlier arm took
  let remaining = await ids(study, parentDef);
  const expected: Record<string, number> = {};
  for (const arm of arms) {
    const hit = and(remaining, await leaf(study, arm.where));
    expected[arm.name] = hit.size;
    remaining = minus(remaining, hit);
  }
  const got = Object.fromEntries((part?.children || []).map((c) => [c.label, c.samples]));
  const notProfiled = (part?.children || []).filter((c) => c.role === "notEvaluable").reduce((t, c) => t + c.samples, 0);
  const armsAgree = arms.every((a) => got[a.name] === expected[a.name]);
  const restAgree = (got[other] ?? 0) + notProfiled === remaining.size;
  record(study, "splits", "every arm holds exactly the samples a by-hand first-match-wins pass puts there",
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

// ---- generated definitions against a reference evaluator ------------------------------------
//
// The checks above test relationships between the engine's own answers, so a leaf the compiler
// gets wrong on both sides of an identity passes them. These compare the compiled SQL with a second
// implementation instead: the study's raw rows (patients, their clinical values, their calls in a
// few genes) fetched with plain queries, and each definition evaluated over them here, in
// JavaScript, as the DSL reference states it. fast-check writes the definitions — all/any/not
// nested three deep over a pool of leaves — and shrinks any disagreement to the smallest
// definition that shows it. The seed is fixed, so a run is repeatable; FC_SEED overrides it.

/** What one study holds that the generated leaves read, fetched once. Every set is of sample ids. */
interface RawStudy {
  base: Set<string>;
  /** patient -> its samples */
  samplesOf: Map<string, string[]>;
  /** attribute -> each row: its patient, its sample (a sample-level row), its level, its value */
  clinical: Map<string, { pid: string; sid: string; type: string; value: string }[]>;
  /** gene -> each call: the sample it was called in, what it is */
  calls: Map<string, { sid: string; variantType: string; status: string | null; cna: number | null; variant: string | null }[]>;
}

async function rawStudy(study: string, attrs: string[], genes: string[]): Promise<RawStudy> {
  const bare = (u: string) => u.startsWith(study + "_") ? u.slice(study.length + 1) : u;
  const lit = (xs: string[]) => xs.map((x) => "'" + x.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'").join(",");
  const [base, clin, calls] = await Promise.all([
    chQuery<{ u: string; s: string }>("SELECT patient_unique_id AS u, sample_unique_id AS s FROM " + DB + ".sample_derived WHERE cancer_study_identifier = '" + study + "'", PRIMARY),
    chQuery<{ u: string; s: string; type: string; a: string; v: string }>("SELECT patient_unique_id AS u, sample_unique_id AS s, type, attribute_name AS a, attribute_value AS v FROM " + DB +
      ".clinical_data_derived WHERE cancer_study_identifier = '" + study + "' AND attribute_name IN (" + lit(attrs) + ")", PRIMARY),
    chQuery<{ s: string; g: string; vt: string; st: string | null; cna: number | null; mv: string | null }>(
      "SELECT sample_unique_id AS s, hugo_gene_symbol AS g, variant_type AS vt, mutation_status AS st, cna_alteration AS cna, mutation_variant AS mv FROM " + DB +
      ".genomic_event_derived WHERE cancer_study_identifier = '" + study + "' AND hugo_gene_symbol IN (" + lit(genes) + ")", PRIMARY),
  ]);
  const samplesOf = new Map<string, string[]>();
  for (const r of base.data) samplesOf.set(bare(r.u), [...(samplesOf.get(bare(r.u)) ?? []), bare(r.s)]);
  const clinical = new Map(attrs.map((a) => [a, [] as RawStudy["clinical"] extends Map<string, infer R> ? R : never]));
  for (const r of clin.data) clinical.get(r.a)!.push({ pid: bare(r.u), sid: bare(r.s), type: r.type, value: r.v });
  const byGene = new Map(genes.map((g) => [g, [] as RawStudy["calls"] extends Map<string, infer R> ? R : never]));
  for (const r of calls.data) byGene.get(r.g)!.push({ sid: bare(r.s), variantType: r.vt, status: r.st, cna: r.cna == null ? null : Number(r.cna), variant: r.mv });
  return { base: new Set(base.data.map((r) => bare(r.s))), samplesOf, clinical, calls: byGene };
}

/** a clinical value as the DSL compares it: case and surrounding spaces folded */
const fold = (v: string) => v.trim().toLowerCase();
/** a clinical value read as a number, or null when it is not a finite one */
const finite = (v: string) => { const x = v.trim() === "" ? NaN : Number(v); return Number.isFinite(x) ? x : null; };

/**
 * The samples a leaf selects, read off the raw rows by the DSL reference's rules: a sample-level
 * leaf (a sample attribute, an alteration, a sample list) selects the samples that match it; a
 * patient-level one (a patient attribute, a patient list) every sample of the patients that match.
 */
function evalLeaf(raw: RawStudy, leaf: any): Set<string> {
  const ofPatients = (pids: Iterable<string>) => new Set([...pids].flatMap((p) => raw.samplesOf.get(p) ?? []));
  if (leaf.kind === "oql") {
    const [, gene, spec] = /^(\w+): (.+)$/.exec(leaf.q)!;
    const called = raw.calls.get(gene)!.filter((c) => c.status !== "UNCALLED");
    const match = (c: (typeof called)[number], s: string) =>
      s === "MUT" ? c.variantType === "mutation"
      : s === "AMP" ? c.variantType === "cna" && (c.cna ?? 0) >= 2
      : s === "HOMDEL" ? c.variantType === "cna" && (c.cna ?? 0) <= -2
      : c.variantType === "mutation" && c.variant === s;
    return new Set(called.filter((c) => spec.split(" ").some((s) => match(c, s))).map((c) => c.sid).filter((s) => raw.base.has(s)));
  }
  if (leaf.kind === "clinical") {
    // the level is the study's: a sample attribute's rows name their sample, a patient attribute's their patient
    const rows = raw.clinical.get(leaf.attribute)!;
    const ok = (v: string) => {
      if (leaf.values) return leaf.values.map(fold).includes(fold(v));
      if (leaf.range) {
        const x = finite(v);
        return x != null && (leaf.range.gte == null || x >= leaf.range.gte) && (leaf.range.lt == null || x < leaf.range.lt);
      }
      if (typeof leaf.value === "number") {
        const x = finite(v);
        return x != null && (leaf.op === ">=" ? x >= leaf.value : leaf.op === "<" ? x < leaf.value : leaf.op === "=" ? x === leaf.value : x !== leaf.value);
      }
      return leaf.op === "=" ? fold(v) === fold(leaf.value) : fold(v) !== fold(leaf.value);
    };
    const hits = rows.filter((r) => ok(r.value));
    return or(new Set(hits.filter((r) => r.type === "sample").map((r) => r.sid).filter((s) => raw.base.has(s))),
      ofPatients(hits.filter((r) => r.type === "patient").map((r) => r.pid)));
  }
  const listed = (ids: string[]) => ids.map((x) => x.split(":")).filter(([s]) => s === leaf.study).map(([, id]) => id);
  if (leaf.kind === "patientList") return ofPatients(listed(leaf.ids));
  if (leaf.kind === "sampleList") return new Set(listed(leaf.ids).filter((id) => raw.base.has(id)));
  throw new Error("no reference for leaf " + JSON.stringify(leaf));
}
function evalClause(raw: RawStudy, c: any): Set<string> {
  if (c.any) return c.any.map((x: any) => evalClause(raw, x)).reduce(or, new Set<string>());
  if (c.not) return minus(raw.base, evalClause(raw, c.not));
  return evalLeaf(raw, c);
}
const evalDef = (raw: RawStudy, def: { all: unknown[] }) => def.all.map((c) => evalClause(raw, c)).reduce(and, raw.base);

/**
 * Every leaf alone, then `runs` generated definitions over them: each must select exactly the
 * patients the reference does.
 */
async function generated(study: string, attrs: string[], genes: string[], leavesOf: (raw: RawStudy) => Clause[], runs: number) {
  const raw = await rawStudy(study, attrs, genes);
  const leaves = leavesOf(raw);
  const strip = (l: any) => { const { study: _s, ...rest } = l; return rest as Clause; };
  const mismatches: string[] = [];
  for (const l of leaves) {
    const ours = await leaf(study, strip(l)), ref = evalLeaf(raw, l);
    if (!same(ours, ref)) mismatches.push(diff(JSON.stringify(strip(l)), ours, ref));
  }
  const sizes = leaves.map((l) => evalLeaf(raw, l).size);
  record(study, "reference", "each leaf alone selects exactly the samples the raw rows say it should",
    !mismatches.length && sizes.every((s) => s > 0 && s < raw.base.size),
    mismatches.length ? mismatches.join("; ") : `${leaves.length} leaves (OQL, clinical values and numbers, patient and sample lists), each a partial group of ${n(raw.base)} samples`);

  // the grammar: a clause is a leaf, {any: [leaves]} or {not: clause}
  const leafArb = fc.constantFrom(...leaves);
  const anyArb = fc.record({ any: fc.array(leafArb, { minLength: 1, maxLength: 4 }) });
  const { clause } = fc.letrec<{ clause: any }>((tie) => ({
    clause: fc.oneof({ depthSize: "small", maxDepth: 3, withCrossShrink: true }, leafArb, anyArb, fc.record({ not: tie("clause") })),
  }));
  const defArb = fc.record({ all: fc.array(clause, { minLength: 1, maxLength: 4 }) });
  const seed = Number(process.env.FC_SEED ?? 20261024);
  let failure = "";
  const out = await fc.check(fc.asyncProperty(defArb, async (def) => {
    const clean = JSON.parse(JSON.stringify(def, (k, v) => k === "study" ? undefined : v));
    const ours = await ids(study, clean), ref = evalDef(raw, def);
    if (!same(ours, ref)) { failure = JSON.stringify(clean) + " — " + diff("cohort", ours, ref); return false; }
    return true;
  }), { numRuns: runs, seed });
  record(study, "reference", "every generated definition (all / any / not, not nested up to three deep) selects exactly what the reference does",
    !out.failed, out.failed ? (failure ? "smallest disagreement: " + failure : "the check itself failed: " + String(out.errorInstance ?? "").slice(0, 400) + " on " + JSON.stringify(out.counterexample)) + " (seed " + seed + ")" : `${runs} definitions over ${leaves.length} leaves agree exactly (seed ${seed})`);
}

const CHORD = "msk_chord_2024";
await algebra(CHORD, { kind: "oql", q: "TP53: MUT" }, { kind: "clinical", attribute: "SMOKING_PREDICTIONS_3_CLASSES", values: ["Never"] } as Clause,
  { kind: "event", a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] }, rel: { type: "NONE" } } as Clause);
await algebra("brca_tcga", { kind: "oql", q: "PIK3CA: MUT" }, { kind: "oql", q: "MYC: AMP" }, { kind: "clinical", attribute: "AGE", op: ">=", value: 60 } as Clause);
await oqlNesting(CHORD, "KRAS", "G12C");
await oqlNesting("brca_tcga", "PIK3CA", "H1047R");
await clinicalPartition(CHORD, "GENDER", ["Female", "Male", "Unknown"], "CURRENT_AGE_DEID", 65);
await splitByHand(CHORD, { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] } as Clause] },
  [{ name: "G12C", where: { kind: "oql", q: "KRAS: G12C" } }, { name: "other KRAS", where: { kind: "oql", q: "KRAS: MUT" } }], "KRAS wild-type");
await splitByHand(CHORD, { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Breast Cancer"] } as Clause] },
  [{ name: "PIK3CA", where: { kind: "oql", q: "PIK3CA: MUT" } }, { name: "TP53", where: { kind: "oql", q: "TP53: MUT" } }], "neither");
await profiledGeneList(CHORD, "MUTATION", ["KRAS", "NRAS", "BRAF", "NTRK3", "SOX9"]);
await profiledGeneList("brca_tcga", "CNA", ["KRAS", "TP53", "PIK3CA"]);
await lineNesting(CHORD);
await heldOutHalves(CHORD);

/** every seventh patient, and two ids the study does not have: a list leaf naming a partial group */
const someOf = (study: string, raw: RawStudy): Clause => ({ kind: "patientList", study,
  ids: [...[...raw.samplesOf.keys()].sort().filter((_, i) => i % 7 === 0), "NOT-A-PATIENT", "ALSO-NOT"].map((id) => study + ":" + id) } as unknown as Clause);
/** every fifth sample, and an id the study does not have */
const someSamples = (study: string, raw: RawStudy): Clause => ({ kind: "sampleList", study,
  ids: [...[...raw.base].sort().filter((_, i) => i % 5 === 0), "NOT-A-SAMPLE"].map((id) => study + ":" + id) } as unknown as Clause);
await generated("brca_tcga", ["SEX", "AGE", "ER_STATUS_BY_IHC", "SAMPLE_TYPE", "TMB_NONSYNONYMOUS"], ["PIK3CA", "TP53", "MYC", "PTEN", "CDH1", "ERBB2"], (raw) => [
  { kind: "oql", q: "PIK3CA: MUT" }, { kind: "oql", q: "PIK3CA: H1047R" }, { kind: "oql", q: "TP53: MUT" }, { kind: "oql", q: "MYC: AMP" },
  { kind: "oql", q: "PTEN: HOMDEL" }, { kind: "oql", q: "CDH1: MUT HOMDEL" }, { kind: "oql", q: "ERBB2: AMP" },
  { kind: "clinical", attribute: "SEX", values: [" female "] }, { kind: "clinical", attribute: "SEX", op: "!=", value: "FEMALE" },
  { kind: "clinical", attribute: "AGE", op: ">=", value: 60 }, { kind: "clinical", attribute: "AGE", range: { gte: 40, lt: 55 } },
  { kind: "clinical", attribute: "ER_STATUS_BY_IHC", values: ["Positive", "Indeterminate"] },
  { kind: "clinical", attribute: "SAMPLE_TYPE", values: ["Metastasis"] },
  { kind: "clinical", attribute: "TMB_NONSYNONYMOUS", range: { gte: 1 } },
  someOf("brca_tcga", raw), someSamples("brca_tcga", raw),
] as Clause[], 60);
await generated(CHORD, ["GENDER", "CURRENT_AGE_DEID", "SMOKING_PREDICTIONS_3_CLASSES", "CANCER_TYPE", "TMB_NONSYNONYMOUS"], ["KRAS", "TP53", "EGFR", "CDKN2A", "ERBB2"], (raw) => [
  { kind: "oql", q: "KRAS: G12C" }, { kind: "oql", q: "KRAS: MUT" }, { kind: "oql", q: "TP53: MUT" }, { kind: "oql", q: "EGFR: MUT AMP" },
  { kind: "oql", q: "CDKN2A: HOMDEL" }, { kind: "oql", q: "ERBB2: AMP" },
  { kind: "clinical", attribute: "GENDER", values: ["  MALE"] }, { kind: "clinical", attribute: "SMOKING_PREDICTIONS_3_CLASSES", op: "=", value: "never" },
  { kind: "clinical", attribute: "CURRENT_AGE_DEID", op: "<", value: 50 },
  { kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer", "Colorectal Cancer"] },
  { kind: "clinical", attribute: "TMB_NONSYNONYMOUS", range: { gte: 10 } },
  someOf(CHORD, raw), someSamples(CHORD, raw),
] as Clause[], 40);

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
