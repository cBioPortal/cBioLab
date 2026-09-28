/**
 * A basic performance regression guard for `splitBy` — the first of its kind in this repo (see
 * docs/PERFORMANCE.md: everything else here is a manual, point-in-time snapshot, not a gate).
 *
 * The risk splitBy specifically introduces: total query cost is already O(cohorts × views that
 * use them) (see the comment above the 16-cohort/6-view caps in lib/analysis.ts), and splitBy
 * turns ONE cohort into up to SPLIT_BY_MAX_ARMS_CEILING of them for a single view with one click
 * — the multiplication a hand-written document would have to opt into deliberately, one cohort
 * at a time. Two things are asserted against the live database, neither a hardcoded exact number
 * (too brittle to internal implementation details):
 *
 *   1. QUERY COUNT SCALES ROUGHLY LINEARLY with arm count, not worse. Compares a small split
 *      (2 arms) against a large one (near the ceiling) on the exact same view and asserts the
 *      query count ratio tracks the arm count ratio, with slack for fixed overhead — not
 *      quadratic or worse, which an accidental per-arm-pair query (a cross-arm comparison,
 *      say) would produce.
 *   2. WALL-CLOCK stays under a generous absolute budget for the largest split. Generous on
 *      purpose: this must not be flaky on a loaded CI runner, so it exists to catch a genuine
 *      regression (a query newly gone quadratic, a missing index), not to enforce a tight
 *      target docs/PERFORMANCE.md's own manual snapshot already covers better than a hardcoded
 *      number here ever could.
 *
 * Run: node --env-file=.env.local scripts/check-splitby-perf.ts
 */
import { runAnalysis } from "../lib/analysis.ts";
import { SPLIT_BY_MAX_ARMS_CEILING } from "../lib/cohort-splitby.ts";

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

// breast_msk_2018's RECEPTOR_STATUS_PRIMARY has ~10 distinct values — enough to reach or nearly
// reach the ceiling with a low minCount, so this genuinely exercises the worst case rather than
// a split that would have pooled almost everything into "Other" regardless of the cap.
const STUDY = "breast_msk_2018";
const ATTRIBUTE = "RECEPTOR_STATUS_PRIMARY";

async function runSplit(maxArms: number): Promise<{ arms: number; queries: number; ms: number }> {
  const t0 = Date.now();
  const doc: any = {
    study: STUDY,
    cohorts: { "all patients": { all: [] } },
    views: [{ kind: "compare", genes: ["TP53", "PIK3CA"],
      splitBy: { cohort: "all patients", attribute: ATTRIBUTE, maxArms, minCount: 1 } }]
  };
  const r = await runAnalysis(doc);
  const v: any = r.views[0];
  if (v.error) throw new Error("splitBy view errored: " + v.error);
  return { arms: (v.splitBy?.arms || []).length, queries: (v.queries || []).length, ms: Date.now() - t0 };
}

async function main() {
  const small = await runSplit(2);
  const large = await runSplit(SPLIT_BY_MAX_ARMS_CEILING);

  ok("a small split (2 arms) actually produced 2 arms", small.arms === 2, "got " + small.arms);
  ok(`a near-ceiling split produced more than 2 arms (attribute has enough real values to test the cap)`,
    large.arms > 2, "got " + large.arms + " arms from " + ATTRIBUTE + " in " + STUDY);

  // Linear-or-better: query count per arm should not grow with arm count. A generous 2x slack
  // absorbs fixed per-view overhead that doesn't scale with arm count at all (the distinct-value
  // lookup itself, run once regardless of how many arms it produces).
  const perArmSmall = small.queries / small.arms, perArmLarge = large.queries / large.arms;
  ok("query count scales with arm count, not worse (no accidental cross-arm blowup)",
    perArmLarge <= perArmSmall * 2 + 1,
    `${small.arms} arms -> ${small.queries}q (${perArmSmall.toFixed(1)}/arm); ${large.arms} arms -> ${large.queries}q (${perArmLarge.toFixed(1)}/arm)`);

  // Generous on purpose — see file header. This is a regression guard, not a performance target.
  const BUDGET_MS = 20000;
  ok(`a ${large.arms}-arm split completes well under a generous ${BUDGET_MS}ms budget`,
    large.ms < BUDGET_MS, large.ms + "ms");

  console.log(failures ? `\n${failures} splitBy performance check(s) FAILED` : "\nall splitBy performance checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
