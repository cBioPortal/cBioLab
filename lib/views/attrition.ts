// Attrition view: how each cohort's clauses narrow the study, one step at a time
import type { CohortDef, ViewResult, AttritionView, AttritionPanel } from "../types.ts";
import { cohortClauses, describeClause } from "../cohort2.ts";
import { attritionMethod } from "../method.ts";
import type { ViewRun } from "./run.ts";
import { overLimit } from "./shared.ts";

const ATTRITION_COHORT_LIMIT = 6;

/**
 * Every clause of `all` is ANDed, so the running count after the first k clauses is the cohort
 * a reader would get by stopping there. Each prefix is evaluated as its own cohort definition —
 * the same compiler, the same per-study counts — so the last step is the cohort's own count by
 * construction, not a separate calculation that could disagree with it.
 */
export async function runAttrition(view: AttritionView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, resolvers, vNames, vStudies } = ctx;
  const e = overLimit("an attrition view", ATTRITION_COHORT_LIMIT, vNames.length);
  if (e) return { kind: "attrition", error: e.replace("at most " + ATTRITION_COHORT_LIMIT, "at most " + ATTRITION_COHORT_LIMIT + " cohorts") };
  const queries: NonNullable<ViewResult["queries"]> = [];
  const panels: AttritionPanel[] = await Promise.all(vNames.map(async (name) => {
    const def = doc.cohorts[name];
    const clauses = cohortClauses(def);
    const prefix = (k: number): CohortDef => ({ ...(def || {}), all: clauses.slice(0, k), a: undefined, b: undefined, rel: undefined });
    const studies = cohorts[name].studies;
    const countAt = async (k: number): Promise<number> => {
      const per = await Promise.all(studies.map(async (st) => {
        const n = await resolvers[st].count(prefix(k));
        // count() is not a logged aggregate (cohort sizes are provenance of their own), so the
        // step's query is recorded here — after the count, because a remote peer only reports
        // its compiled SQL once it has answered.
        queries.push({ study: st, label: "attrition:" + name + ":step " + k,
          sql: "SELECT count() AS n FROM (" + resolvers[st].cohortSql(prefix(k)) + ")",
          ...(resolvers[st].instance.id === "peer" ? { remote: true } : {}) });
        return n;
      }));
      return per.reduce((a, b) => a + b, 0);
    };
    const counts = await Promise.all([0, ...clauses.map((_, i) => i + 1)].map(countAt));
    const base = counts[0];
    const steps = clauses.map((c, i) => ({
      label: describeClause(c),
      n: counts[i + 1],
      excluded: counts[i] - counts[i + 1],
      pctOfBase: base ? Math.round(1000 * counts[i + 1] / base) / 10 : null
    }));
    return { cohort: name, base, steps, studies };
  }));
  const mismatched = panels.filter((p) => (p.steps.length ? p.steps[p.steps.length - 1].n : p.base) !== cohorts[p.cohort].count);
  const multi = vStudies.length > 1;
  return {
    kind: "attrition", cohorts: vNames, attrition: panels, method: attritionMethod(panels),
    queries: queries.sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true })),
    participation: ctx.participationFor(vStudies, false),
    ...(multi ? { studies: vStudies } : {}),
    caveat: "Each step counts the patients left after ANDing that clause onto every clause above it, in the order the " +
      "cohort lists them. The order changes the path, never the final count: reorder the clauses to see a different " +
      "attrition sequence. Each view further drops patients who lack its own data (survival without follow-up, genes " +
      "never profiled), and says how many in its own caption." +
      (multi ? " Counts are summed across " + vStudies.length + " studies; patient overlap across studies is NOT deduplicated." : "") +
      (mismatched.length ? " WARNING: the last step for " + mismatched.map((p) => p.cohort).join(", ") +
        " does not equal that cohort's own count — the definition was evaluated twice and gave two answers." : "")
  };
}
