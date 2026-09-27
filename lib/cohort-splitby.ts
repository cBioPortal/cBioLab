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
import type { CohortDef, ClinicalLeaf, SplitBy } from "./types.ts";

export const SPLIT_BY_DEFAULT_MAX_ARMS = 8;
export const SPLIT_BY_DEFAULT_MIN_COUNT = 10;
/** hard ceiling on `maxArms` itself — well under the document's own 16-cohort cap, since a
 *  split's arms are only ever ONE view's worth of cohorts, not the whole document's budget */
export const SPLIT_BY_MAX_ARMS_CEILING = 12;

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
   *  arm — either there were more than `maxArms` distinct values, or too few patients had them */
  otherValues: string[];
}

const ATTR_RE = /^[A-Za-z0-9_]{1,64}$/;

/**
 * Decide which values become their own arm and which pool into "Other", or refuse outright.
 * Pure apart from `distributionFor` — inject a fake for tests; lib/analysis.ts injects the real
 * attributeStats-backed lookup, merged across every study the base cohort spans.
 */
export async function resolveSplitBy(
  splitBy: SplitBy, existingCohortNames: string[], baseDef: CohortDef,
  distributionFor: (attribute: string) => Promise<AttributeDistribution>
): Promise<SplitByResolved> {
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

  // Most frequent first, ties broken alphabetically — deterministic and reproducible from the
  // same data, not an artifact of whatever order the query happened to return rows in.
  const sorted = [...values].sort((a, b) => b.n - a.n || (a.v < b.v ? -1 : 1));
  const eligible = sorted.filter((x) => x.n >= minCount);
  const thin = sorted.filter((x) => x.n < minCount); // always pools, regardless of maxArms

  if (eligible.length < 2)
    throw new Error("splitBy: '" + attribute + "' has fewer than 2 values with at least " + minCount +
      " patients each in “" + splitBy.cohort + "” — not enough variation to split on" +
      (thin.length ? " (" + thin.length + " value" + (thin.length === 1 ? "" : "s") + " short of that floor)" : ""));

  const ownValues = eligible.slice(0, maxArms - 1);
  const pooled = [...eligible.slice(maxArms - 1), ...thin];
  const otherValues = pooled.map((x) => x.v);

  const clause = (v: string): ClinicalLeaf => ({ kind: "clinical", attribute, per: dist.per, op: "=", value: v });
  const baseAll = baseDef.all || [];
  const nameFor = (label: string) => splitBy.cohort + " — " + attribute + ": " + label;
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
  const collision = arms.find((a) => existingCohortNames.includes(a.name));
  if (collision) throw new Error("splitBy: the arm “" + collision.name + "” it would create has the same name as an existing cohort — rename that cohort first");
  return { arms, otherValues };
}
