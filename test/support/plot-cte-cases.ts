// The plot SQL builders that open with a WITH clause of the cohort and its axes, each with the
// top-level CTEs that a materialized plot cohort (`{ cohortSql, materialized: true }`) makes
// MATERIALIZED (cohort, cases, xs, ys, vs, gs, cs, rs) and no others. Shared by the text test
// (test/materialized-cte.test.ts) and the run against the fixture study
// (test/plot-materialized-fixture.test.ts), so both cover the same calls.
import {
  axisSelect, plotBinsSql, plotBoxSql, plotCountSql, plotCoverageSql, plotMomentsSql, plotNegativesSql, plotOutlierPointsSql,
  plotPointsSql, plotRankedPointsSql, plotScatterPointsSql, plotStatsSql, plotTableSql, plotViolinSql,
  type AxisCtx, type PlotCohort, type Whiskers,
} from "../../lib/plot.ts";

export interface CteCase {
  /** builder and branch */
  name: string;
  /** the statement over this cohort: its SQL alone, or a plot context saying whether to materialize */
  sql: (cohort: PlotCohort) => string;
  /** the CTEs `materialized: true` makes MATERIALIZED, in the order they appear */
  materialized: string[];
  /** whether the rows come in an order the SQL fixes (else compared as a set) */
  ordered: boolean;
}

export interface CaseAxes {
  /** the plot's context, without `materialized`: each case adds what its cohort argument says */
  ctx: AxisCtx;
  /** two numeric axes, two categorical, for the scatter, box and table shapes */
  num1: Parameters<typeof axisSelect>[0]; num2: Parameters<typeof axisSelect>[0];
  cat1: Parameters<typeof axisSelect>[0]; cat2: Parameters<typeof axisSelect>[0];
  /** each box group's whiskers, for the outlier query */
  whiskers: Whiskers[];
  /** a scatter's grid and extent, for its sparse cells */
  extent: { x0: number; x1: number; y0: number; y1: number };
}

/** the ways a caller can hand a builder its cohort, and whether each asks for MATERIALIZED */
export type CohortForm = "sql string" | "context, materialized absent" | "context, materialized false" | "context, materialized true";
export const PLAIN_FORMS: CohortForm[] = ["sql string", "context, materialized absent", "context, materialized false"];
export function cohortArg(cohortSql: string, form: CohortForm): PlotCohort {
  switch (form) {
    case "sql string": return cohortSql;
    case "context, materialized absent": return { cohortSql };
    case "context, materialized false": return { cohortSql, materialized: false };
    case "context, materialized true": return { cohortSql, materialized: true };
  }
}

export function cteCases(a: CaseAxes): CteCase[] {
  // the axis context a caller would hold for this cohort argument: a string is a context without `materialized`
  // (read when a statement is built, so a caller may fill a.ctx in after listing the cases)
  const ctxOf = (c: PlotCohort): AxisCtx => typeof c === "string" ? { ...a.ctx, cohortSql: c } : { ...a.ctx, ...c };
  const n1 = (c: PlotCohort) => axisSelect(a.num1, ctxOf(c), "num"), n2 = (c: PlotCohort) => axisSelect(a.num2, ctxOf(c), "num");
  const c1 = (c: PlotCohort) => axisSelect(a.cat1, ctxOf(c), "cat"), c2 = (c: PlotCohort) => axisSelect(a.cat2, ctxOf(c), "cat");
  const sparse = { grid: [10, 10] as [number, number], extent: a.extent, cellMax: 2 };
  return [
    { name: "pairCte via plotCountSql (numeric)", sql: (c) => plotCountSql(n1(c), n2(c), c, true), materialized: ["cohort", "xs", "ys"], ordered: false },
    { name: "pairCte via plotCountSql (categorical)", sql: (c) => plotCountSql(c1(c), c2(c), c, false), materialized: ["cohort", "xs", "ys"], ordered: false },
    { name: "pairCte via plotStatsSql", sql: (c) => plotStatsSql(n1(c), n2(c), c), materialized: ["cohort", "xs", "ys"], ordered: false },
    { name: "pairCte via plotMomentsSql", sql: (c) => plotMomentsSql(n1(c), n2(c), c), materialized: ["cohort", "xs", "ys"], ordered: false },
    { name: "pairCte via plotBinsSql", sql: (c) => plotBinsSql(n1(c), n2(c), c, [12, 8]), materialized: ["cohort", "xs", "ys"], ordered: false },
    { name: "pairCte via plotTableSql", sql: (c) => plotTableSql(c1(c), c2(c), c), materialized: ["cohort", "xs", "ys"], ordered: false },
    { name: "plotNegativesSql", sql: (c) => plotNegativesSql(n1(c), c), materialized: ["cohort", "xs"], ordered: false },
    { name: "plotCoverageSql (an AxisCtx)", sql: (c) => plotCoverageSql(n1(c), c1(c), ctxOf(c)), materialized: ["cohort", "cases", "xs", "ys"], ordered: false },
    { name: "plotBoxSql", sql: (c) => plotBoxSql(n1(c), c1(c), c), materialized: ["cohort", "vs", "gs"], ordered: false },
    { name: "plotViolinSql", sql: (c) => plotViolinSql(n1(c), c1(c), c, 20), materialized: ["cohort", "vs", "gs"], ordered: false },
    { name: "plotViolinSql with a colour", sql: (c) => plotViolinSql(n1(c), c1(c), c, 20, c2(c)), materialized: ["cohort", "vs", "gs", "cs"], ordered: false },
    { name: "plotViolinSql over a shared range", sql: (c) => plotViolinSql(n1(c), c1(c), c, 20, undefined, [0, 100]), materialized: ["cohort", "vs", "gs"], ordered: false },
    { name: "boxCasesHead via plotPointsSql", sql: (c) => plotPointsSql(n1(c), c1(c), c, 5000), materialized: ["cohort", "vs", "gs"], ordered: false },
    { name: "boxCasesHead via plotPointsSql with colour and ring", sql: (c) => plotPointsSql(n1(c), c1(c), c, 5000, c2(c), c1(c)),
      materialized: ["cohort", "vs", "gs", "cs", "rs"], ordered: false },
    { name: "boxCasesHead via plotOutlierPointsSql", sql: (c) => plotOutlierPointsSql(n1(c), c1(c), c, a.whiskers, 5000), materialized: ["cohort", "vs", "gs"], ordered: true },
    { name: "pairIdCte via plotRankedPointsSql (box)", sql: (c) => plotRankedPointsSql(n1(c), c1(c), c, "box", true, { by: "x", n: 3 }),
      materialized: ["cohort", "xs", "ys"], ordered: false },
    { name: "pairIdCte via plotRankedPointsSql (scatter, by y)", sql: (c) => plotRankedPointsSql(n1(c), n2(c), c, "scatter", true, { by: "y", n: 3 }),
      materialized: ["cohort", "xs", "ys"], ordered: false },
    { name: "pairIdCte via plotRankedPointsSql (scatter, residual)", sql: (c) => plotRankedPointsSql(n1(c), n2(c), c, "scatter", true,
      { by: "residual", n: 5, slope: 0.002, intercept: 0.1 }), materialized: ["cohort", "xs", "ys"], ordered: true },
    { name: "plotScatterPointsSql (all points)", sql: (c) => plotScatterPointsSql(n1(c), n2(c), c, 5000), materialized: ["cohort", "xs", "ys"], ordered: false },
    { name: "plotScatterPointsSql (all points, colour and ring)", sql: (c) => plotScatterPointsSql(n1(c), n2(c), c, 5000, undefined, c1(c), c2(c)),
      materialized: ["cohort", "xs", "ys", "cs", "rs"], ordered: false },
    { name: "plotScatterPointsSql (sparse cells)", sql: (c) => plotScatterPointsSql(n1(c), n2(c), c, 5000, sparse), materialized: ["cohort", "xs", "ys"], ordered: false },
  ];
}

/** the names of the CTEs a statement's top-level WITH declares `AS MATERIALIZED (`, in order */
export function materializedNames(sql: string): string[] {
  return [...sql.matchAll(/(?:^WITH |,\n {5})([a-z]+) AS MATERIALIZED \(/g)].map((m) => m[1]);
}
