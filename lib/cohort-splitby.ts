// Auto-split ONE existing cohort into an arm per distinct value of a categorical clinical
// attribute — the pure decision logic (which values become their own arm, which pool into a
// disclosed "Other", when to refuse outright), injected with a callback for the live value
// distribution so this is unit-testable without a database.
//
// The third member of the "resolve once, live, before compilation" family: lib/cohort-extends.ts
// is pure and sync (splices in a parent's clauses), lib/cohort-percentile.ts is async with an
// injected quantileFor callback (resolves a percentile leaf's value), and this one is async with
// an injected distributionFor callback (resolves which values exist and how many patients each
// has). All three run as a pre-pass so whatever sees the document next — the compiler, for
// extends/percentile; the per-view cohort loop, for this — already has an ordinary structure to
// work with, with nothing left to resolve.
import type { CohortDef, ClinicalLeaf, OqlLeaf, SplitBy } from "./types.ts";
import { parseOql } from "./oql.ts";
import { ATTR_NAME_RE, attributeLabel } from "./custom-data-names.ts";

import { chooseArmValues, SPLIT_BY_DEFAULT_MAX_ARMS, SPLIT_BY_DEFAULT_MIN_COUNT } from "./partition-arms.ts";
export { SPLIT_BY_DEFAULT_MAX_ARMS, SPLIT_BY_DEFAULT_MIN_COUNT };
/** hard ceiling on `maxArms` (attribute mode) and on how many queries `oql` mode takes. Set to
 *  the compiler's own `{any:[...]}` leaf cap (lib/cohort2.ts) rather than the document's looser
 *  16-cohort budget: the Other arm's def negates "any of" every named arm/query in ONE clause,
 *  and so does the overlap-check def that discloses how many patients landed in more than one
 *  arm — both need every named leaf to fit inside a single `any`, which the compiler refuses
 *  outright past 8. A higher ceiling here would build a def the compiler then rejects. */
export const SPLIT_BY_MAX_ARMS_CEILING = 8;

export interface SplitByValue { v: string; n: number }
/** what the caller's live lookup reports back for one attribute within the base cohort */
export interface AttributeDistribution {
  kind: "cat" | "num";
  per: "patient" | "sample";
  values?: SplitByValue[];
  /** set when the site itself refused to answer (e.g. over its own distinct-value cap) rather
   *  than actually reporting a distribution */
  skipped?: string;
}

export interface SplitByArm { name: string; def: CohortDef }
export interface SplitByResolved {
  arms: SplitByArm[];
  /** raw attribute values this split saw but pooled into "Other" rather than giving their own
   *  arm — either there were more than `maxArms` distinct values, or too few patients had them.
   *  Attribute mode only. */
  otherValues: string[];
  /** the attribute/gene/oql list actually used, normalized (trimmed, gene uppercased) — echo
   *  this back rather than the caller's own raw splitBy fields, which may differ in whitespace */
  attribute?: string; gene?: string; oql?: string[];
  /** which arm in `arms` (if any) is the "Other" bucket — leftover attribute values, or oql's
   *  "matched none of the given queries" — so the caller can exclude it from the overlap sum and
   *  (oql mode only, where unlike attribute mode there's no pre-fetched distribution to check
   *  against before committing to include it) drop it from the result if its live count comes
   *  back 0 rather than showing an always-empty "Other". */
  otherArmName?: string;
  /** when 2+ NAMED (non-"Other") arms exist, a cohort def matching "any of them" — the caller
   *  evaluates it and compares to the sum of individual arm counts to disclose how many patients
   *  landed in more than one arm (arms are not forced into a partition; see SplitBy's own gene
   *  vs attribute/oql comment). Omitted when overlap is impossible by construction (gene mode's
   *  two arms) or moot (fewer than 2 named arms). */
  overlapCheckDef?: CohortDef;
}

const ATTR_RE = ATTR_NAME_RE;
const GENE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/;

function checkCollision(splitBy: SplitBy, existingCohortNames: string[], arms: SplitByArm[]): void {
  const collision = arms.find((a) => existingCohortNames.includes(a.name));
  if (collision) throw new Error("splitBy: the arm “" + collision.name + "” it would create has the same name as an existing cohort — rename that cohort first");
}

/**
 * Gene mode: exactly two arms (mutated / not, via OQL) — no live query needed, unlike attribute
 * mode, since the two group names are fixed regardless of the data. `maxArms`/`minCount` don't
 * mean anything here and are refused rather than silently ignored, so a document that sets them
 * alongside `gene` doesn't quietly imply a knob that does nothing.
 */
function resolveSplitByGene(splitBy: SplitBy, existingCohortNames: string[], baseDef: CohortDef): SplitByResolved {
  if (splitBy.maxArms != null || splitBy.minCount != null)
    throw new Error("splitBy: maxArms/minCount only apply when splitting by attribute — gene mode always produces exactly 2 arms");
  const gene = String(splitBy.gene).trim().toUpperCase();
  if (!GENE_RE.test(gene)) throw new Error("splitBy: '" + gene + "' is not a valid gene symbol");
  const baseAll = baseDef.all || [];
  const nameFor = (label: string) => splitBy.cohort + " — " + gene + ": " + label;
  const mutLeaf: OqlLeaf = { kind: "oql", q: gene + ": MUT" };
  const arms: SplitByArm[] = [
    { name: nameFor("Mutated"), def: { ...baseDef, all: [...baseAll, mutLeaf] } },
    { name: nameFor("Not mutated"), def: { ...baseDef, all: [...baseAll, { not: mutLeaf }] } }
  ];
  checkCollision(splitBy, existingCohortNames, arms);
  return { arms, otherValues: [], gene };
}

/**
 * OQL mode: one arm per query, named from the query text itself — reaches anything OQL can
 * express (mutation type, driver-only, copy number, multi-gene co-alteration), not just plain
 * mutation status. Unlike attribute mode, whether patients overlap between arms, or whether
 * anyone matches none of them, can't be decided here — there's no live count yet, only defs —
 * so the caller evaluates every arm (Other included) and drops Other if it comes back empty.
 */
function resolveSplitByOql(splitBy: SplitBy, existingCohortNames: string[], baseDef: CohortDef): SplitByResolved {
  if (splitBy.maxArms != null || splitBy.minCount != null)
    throw new Error("splitBy: maxArms/minCount only apply when splitting by attribute — oql mode uses exactly the queries you give it, nothing to pool");
  const queries = (splitBy.oql || []).map((q) => String(q).trim()).filter(Boolean);
  if (!queries.length) throw new Error("splitBy: oql needs at least 1 query");
  if (queries.length > SPLIT_BY_MAX_ARMS_CEILING)
    throw new Error("splitBy: oql takes at most " + SPLIT_BY_MAX_ARMS_CEILING + " queries; got " + queries.length);
  for (const q of queries) {
    try { parseOql(q); } catch (e) { throw new Error("splitBy: '" + q + "' is not valid OQL — " + (e as Error).message, { cause: e }); }
  }
  const baseAll = baseDef.all || [];
  const leaves: OqlLeaf[] = queries.map((q) => ({ kind: "oql", q }));
  const nameFor = (label: string) => splitBy.cohort + " — " + label;
  const arms: SplitByArm[] = leaves.map((leaf) => ({ name: nameFor(leaf.q), def: { ...baseDef, all: [...baseAll, leaf] } }));
  const otherArmName = nameFor("Other");
  arms.push({ name: otherArmName, def: { ...baseDef, all: [...baseAll, { not: { any: leaves } }] } });
  checkCollision(splitBy, existingCohortNames, arms);
  const overlapCheckDef: CohortDef | undefined = leaves.length > 1
    ? { ...baseDef, all: [...baseAll, { any: leaves }] } : undefined;
  return { arms, otherValues: [], oql: queries, otherArmName, overlapCheckDef };
}

/**
 * Decide which values become their own arm and which pool into "Other", or refuse outright.
 * Pure apart from `distributionFor` — inject a fake for tests; lib/analysis.ts injects the real
 * attributeStats-backed lookup, merged across every study the base cohort spans.
 */
export async function resolveSplitBy(
  splitBy: SplitBy, existingCohortNames: string[], baseDef: CohortDef,
  distributionFor: (attribute: string) => Promise<AttributeDistribution>
): Promise<SplitByResolved> {
  const hasAttribute = splitBy.attribute != null && String(splitBy.attribute).trim() !== "";
  const hasGene = splitBy.gene != null && String(splitBy.gene).trim() !== "";
  const hasOql = splitBy.oql != null;
  const modeCount = (hasAttribute ? 1 : 0) + (hasGene ? 1 : 0) + (hasOql ? 1 : 0);
  if (modeCount !== 1)
    throw new Error("splitBy: name exactly one of attribute, gene, or oql" + (modeCount > 1 ? " — more than one was given" : ""));
  if (hasGene) return resolveSplitByGene(splitBy, existingCohortNames, baseDef);
  if (hasOql) return resolveSplitByOql(splitBy, existingCohortNames, baseDef);

  const attribute = String(splitBy.attribute || "").trim();
  if (!ATTR_RE.test(attribute)) throw new Error("splitBy: '" + attribute + "' is not a valid attribute name");

  const rawMaxArms = splitBy.maxArms;
  const maxArms = rawMaxArms == null ? SPLIT_BY_DEFAULT_MAX_ARMS : Number(rawMaxArms);
  if (!Number.isFinite(maxArms) || maxArms < 2 || maxArms > SPLIT_BY_MAX_ARMS_CEILING || !Number.isInteger(maxArms))
    throw new Error("splitBy: maxArms must be a whole number from 2 to " + SPLIT_BY_MAX_ARMS_CEILING + "; got " + rawMaxArms);

  const rawMinCount = splitBy.minCount;
  const minCount = rawMinCount == null ? SPLIT_BY_DEFAULT_MIN_COUNT : Number(rawMinCount);
  if (!Number.isFinite(minCount) || minCount < 1 || !Number.isInteger(minCount))
    throw new Error("splitBy: minCount must be a positive whole number; got " + rawMinCount);

  const dist = await distributionFor(attribute);
  if (dist.skipped) throw new Error("splitBy: " + dist.skipped);
  if (dist.kind === "num")
    throw new Error("splitBy: '" + attribute + "' is numeric — split by a categorical attribute, " +
      "or use a percentile cutoff on a clinical leaf to threshold a continuous one instead");
  const values = (dist.values || []).filter((x) => x.n > 0);
  if (!values.length)
    throw new Error("splitBy: no patient in “" + splitBy.cohort + "” has a recorded value for '" + attribute + "'");

  // the same rule a partition's "split by" uses (lib/partition-arms.ts)
  const { own: ownValues, pooled } = chooseArmValues(values, maxArms, minCount);
  const eligible = values.filter((x) => x.n >= minCount);
  const thin = values.filter((x) => x.n < minCount);

  if (eligible.length < 2)
    throw new Error("splitBy: '" + attribute + "' has fewer than 2 values with at least " + minCount +
      " patients each in “" + splitBy.cohort + "” — not enough variation to split on" +
      (thin.length ? " (" + thin.length + " value" + (thin.length === 1 ? "" : "s") + " short of that floor)" : ""));

  const otherValues = pooled.map((x) => x.v);

  const clause = (v: string): ClinicalLeaf => ({ kind: "clinical", attribute, per: dist.per, op: "=", value: v });
  const baseAll = baseDef.all || [];
  const nameFor = (label: string) => splitBy.cohort + " — " + attributeLabel(attribute, "short") + ": " + label;
  const arms: SplitByArm[] = ownValues.map((x) => ({ name: nameFor(x.v), def: { ...baseDef, all: [...baseAll, clause(x.v)] } }));
  if (otherValues.length) {
    arms.push({
      name: nameFor("Other"),
      // "has SOME value (not empty) AND isn't one of the promoted values" — correctly covers
      // both the too-thin and the beyond-maxArms values without enumerating either list, and
      // never silently folds in a patient with no recorded value at all (that patient belongs
      // in no arm, same as the base histogram never counted them as a value in the first place).
      def: { ...baseDef, all: [...baseAll,
        { kind: "clinical", attribute, per: dist.per, op: "!=", value: "" },
        { not: { any: ownValues.map((x) => clause(x.v)) } }
      ] }
    });
  }
  checkCollision(splitBy, existingCohortNames, arms);
  const overlapCheckDef: CohortDef | undefined = ownValues.length > 1
    ? { ...baseDef, all: [...baseAll, { any: ownValues.map((x) => clause(x.v)) }] } : undefined;
  return { arms, otherValues, attribute, overlapCheckDef, ...(otherValues.length ? { otherArmName: nameFor("Other") } : {}) };
}
