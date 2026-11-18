// The plot SQL builders that open with a WITH clause of the cohort and its axes, each with the
// top-level CTEs that CLICKHOUSE_MATERIALIZED_CTE=1 makes MATERIALIZED (cohort, cases, xs, ys, vs,
// gs, cs, rs) and no others. Shared by the text test (test/materialized-cte.test.ts) and the run
// against the fixture study (test/plot-materialized-fixture.test.ts), so both cover the same calls.
import {
  axisSelect, plotBinsSql, plotBoxSql, plotCountSql, plotCoverageSql, plotMomentsSql, plotNegativesSql, plotOutlierPointsSql,
  plotPointsSql, plotRankedPointsSql, plotScatterPointsSql, plotStatsSql, plotTableSql, plotViolinSql,
  type AxisCtx, type Whiskers,
} from "../../lib/plot.ts";

export interface CteCase {
  /** builder and branch */
  name: string;
  /** the statement, built when called, so it reads the flag as it is at that moment */
  sql: () => string;
  /** the CTEs the flag makes MATERIALIZED, in the order they appear */
  materialized: string[];
  /** whether the rows come in an order the SQL fixes (else compared as a set) */
  ordered: boolean;
}

export interface CaseAxes {
  ctx: AxisCtx;
  /** two numeric axes, two categorical, for the scatter, box and table shapes */
  num1: Parameters<typeof axisSelect>[0]; num2: Parameters<typeof axisSelect>[0];
  cat1: Parameters<typeof axisSelect>[0]; cat2: Parameters<typeof axisSelect>[0];
  /** each box group's whiskers, for the outlier query */
  whiskers: Whiskers[];
  /** a scatter's grid and extent, for its sparse cells */
  extent: { x0: number; x1: number; y0: number; y1: number };
}

export function cteCases(a: CaseAxes): CteCase[] {
  const n1 = () => axisSelect(a.num1, a.ctx, "num"), n2 = () => axisSelect(a.num2, a.ctx, "num");
  const c1 = () => axisSelect(a.cat1, a.ctx, "cat"), c2 = () => axisSelect(a.cat2, a.ctx, "cat");
  // read when a statement is built, so a caller may fill the context in after listing the cases
  const co = () => a.ctx.cohortSql;
  const sparse = { grid: [10, 10] as [number, number], extent: a.extent, cellMax: 2 };
  return [
    { name: "pairCte via plotCountSql (numeric)", sql: () => plotCountSql(n1(), n2(), co(), true), materialized: ["cohort", "xs", "ys"], ordered: false },
    { name: "pairCte via plotCountSql (categorical)", sql: () => plotCountSql(c1(), c2(), co(), false), materialized: ["cohort", "xs", "ys"], ordered: false },
    { name: "pairCte via plotStatsSql", sql: () => plotStatsSql(n1(), n2(), co()), materialized: ["cohort", "xs", "ys"], ordered: false },
    { name: "pairCte via plotMomentsSql", sql: () => plotMomentsSql(n1(), n2(), co()), materialized: ["cohort", "xs", "ys"], ordered: false },
    { name: "pairCte via plotBinsSql", sql: () => plotBinsSql(n1(), n2(), co(), [12, 8]), materialized: ["cohort", "xs", "ys"], ordered: false },
    { name: "pairCte via plotTableSql", sql: () => plotTableSql(c1(), c2(), co()), materialized: ["cohort", "xs", "ys"], ordered: false },
    { name: "plotNegativesSql", sql: () => plotNegativesSql(n1(), co()), materialized: ["cohort", "xs"], ordered: false },
    { name: "plotCoverageSql", sql: () => plotCoverageSql(n1(), c1(), a.ctx), materialized: ["cohort", "cases", "xs", "ys"], ordered: false },
    { name: "plotBoxSql", sql: () => plotBoxSql(n1(), c1(), co()), materialized: ["cohort", "vs", "gs"], ordered: false },
    { name: "plotViolinSql", sql: () => plotViolinSql(n1(), c1(), co(), 20), materialized: ["cohort", "vs", "gs"], ordered: false },
    { name: "plotViolinSql with a colour", sql: () => plotViolinSql(n1(), c1(), co(), 20, c2()), materialized: ["cohort", "vs", "gs", "cs"], ordered: false },
    { name: "plotViolinSql over a shared range", sql: () => plotViolinSql(n1(), c1(), co(), 20, undefined, [0, 100]), materialized: ["cohort", "vs", "gs"], ordered: false },
    { name: "boxCasesHead via plotPointsSql", sql: () => plotPointsSql(n1(), c1(), co(), 5000), materialized: ["cohort", "vs", "gs"], ordered: false },
    { name: "boxCasesHead via plotPointsSql with colour and ring", sql: () => plotPointsSql(n1(), c1(), co(), 5000, c2(), c1()),
      materialized: ["cohort", "vs", "gs", "cs", "rs"], ordered: false },
    { name: "boxCasesHead via plotOutlierPointsSql", sql: () => plotOutlierPointsSql(n1(), c1(), co(), a.whiskers, 5000), materialized: ["cohort", "vs", "gs"], ordered: true },
    { name: "pairIdCte via plotRankedPointsSql (box)", sql: () => plotRankedPointsSql(n1(), c1(), co(), "box", true, { by: "x", n: 3 }),
      materialized: ["cohort", "xs", "ys"], ordered: false },
    { name: "pairIdCte via plotRankedPointsSql (scatter, by y)", sql: () => plotRankedPointsSql(n1(), n2(), co(), "scatter", true, { by: "y", n: 3 }),
      materialized: ["cohort", "xs", "ys"], ordered: false },
    { name: "pairIdCte via plotRankedPointsSql (scatter, residual)", sql: () => plotRankedPointsSql(n1(), n2(), co(), "scatter", true,
      { by: "residual", n: 5, slope: 0.002, intercept: 0.1 }), materialized: ["cohort", "xs", "ys"], ordered: true },
    { name: "plotScatterPointsSql (all points)", sql: () => plotScatterPointsSql(n1(), n2(), co(), 5000), materialized: ["cohort", "xs", "ys"], ordered: false },
    { name: "plotScatterPointsSql (all points, colour and ring)", sql: () => plotScatterPointsSql(n1(), n2(), co(), 5000, undefined, c1(), c2()),
      materialized: ["cohort", "xs", "ys", "cs", "rs"], ordered: false },
    { name: "plotScatterPointsSql (sparse cells)", sql: () => plotScatterPointsSql(n1(), n2(), co(), 5000, sparse), materialized: ["cohort", "xs", "ys"], ordered: false },
  ];
}

/** the names of the CTEs a statement's top-level WITH declares `AS MATERIALIZED (`, in order */
export function materializedNames(sql: string): string[] {
  return [...sql.matchAll(/(?:^WITH |,\n {5})([a-z]+) AS MATERIALIZED \(/g)].map((m) => m[1]);
}
