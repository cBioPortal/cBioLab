// The facts the Mutations table's default columns follow (lib/mutation-table.ts mutationDefaultColumns),
// shared by the mutations view, whose table shows them, and the hotspots view, whose plot a search
// of that table narrows over the same columns.
import { MUTATION_COLUMNS, MUTATION_DEFAULT_COLUMNS, mutationDefaultColumns, mutationRowSource, type MutationDefaultFacts, type TablePart } from "../mutation-table.ts";
import { clinicalColumns, type ClinicalColumn } from "../mutation-clinical.ts";
import { clinicalFreq, clinicalFreqSql } from "../mutation-clinical-freq.ts";
import { tableAttributesSql, TABLE_COLUMNS_MAX } from "../clinical-table.ts";
import type { ViewResolver } from "./shared.ts";
import { summaryOfValues, type ColumnSummary, type RowSource, type SummaryAsk } from "../table-query.ts";
import type { LollipopOql } from "../federation.ts";
import type { ResolvedDrivers } from "../driver-settings.ts";
import { variantPins } from "../variant-annotation.ts";
import type { ViewRun } from "./run.ts";
import { runRows } from "./rows.ts";

/** The columns the facts read off the rows, which a counts statement can summarise (runRows `summarize`). */
export const MUTATION_FACT_COLUMNS: SummaryAsk[] = [{ column: "vaf", numeric: true }, { column: "cancerType", numeric: false }];

/**
 * Over every row of the gene's table whatever its search and filters (the portal reads its table's
 * allData): whether a queried study has a discrete CNA profile, whether a row has a non-zero allele
 * frequency, how many Cancer Type Detailed values the rows hold. A study whose peer did not describe
 * its profiles (`unanswered`) leaves the first unknown, unless another study has the profile. The
 * rows' facts come from `summaries` (Rows.summaries of MUTATION_FACT_COLUMNS) where given; otherwise
 * each column's values are asked for.
 */
export async function mutationDefaultFacts(ctx: ViewRun, holders: string[], source: (parts: TablePart[]) => (db: string, materialized: boolean) => RowSource,
  summaries?: ColumnSummary[]): Promise<MutationDefaultFacts> {
  const summaryOf = async (column: string, numeric: boolean): Promise<ColumnSummary | undefined> => {
    const given = summaries?.find((x) => x.column === column);
    if (given) return given;
    const v = (await runRows(ctx, "mutations", holders, {}, MUTATION_DEFAULT_COLUMNS, MUTATION_DEFAULT_COLUMNS, 1, source, { column, numeric })).values;
    return v && summaryOfValues(v);
  };
  const [vaf, types, studies] = await Promise.all([summaryOf("vaf", true), summaryOf("cancerType", false),
    Promise.all(ctx.vStudies.map((st) => ctx.studyProfiles(st)))]);
  // a study with the profile settles it; otherwise every study must have answered for "none" to be known
  const discrete = studies.some((p) => (p.catalog || []).some((x) => x.type === "COPY_NUMBER_ALTERATION" && x.datatype === "DISCRETE"));
  const known = studies.every((p) => p.catalog && !p.unanswered);
  return {
    ...(discrete || known ? { discreteCna: discrete } : {}),
    ...(vaf?.numeric ? { nonZeroVaf: vaf.max != null && vaf.max > 0 } : {}),
    ...(types && !types.numeric ? { cancerTypes: types.truncated ? Infinity : types.values.filter((x) => x !== "").length } : {}),
  };
}

/** The table's default columns for one gene, as the mutations view would show them under these settings, from the studies that may list its rows (`holders`). */
export async function mutationDefaults(ctx: ViewRun, holders: string[], gene: string, oql: LollipopOql | undefined, drivers: ResolvedDrivers | undefined): Promise<string[]> {
  if (!holders.length) return MUTATION_DEFAULT_COLUMNS;
  const pins = await variantPins();
  return mutationDefaultColumns(await mutationDefaultFacts(ctx, holders, (parts) => (db, materialized) => mutationRowSource(parts, db, gene, ctx.pin, pins, oql, drivers, [], materialized)));
}

/**
 * The table's clinical-attribute columns (MUT-COL-36): every attribute the studies that may list rows
 * record, as the clinical table reads them (tableAttributesSql), each once, but those the table shows
 * as columns of its own.
 */
export async function mutationClinicalColumns(ctx: ViewRun, holders: string[]): Promise<ClinicalColumn[]> {
  // a participant that answers no metadata queries (a stand-in, a site on older code) adds no columns
  const perStudy = await Promise.all(holders.map((st) => {
    const r = ctx.resolvers[st] as Partial<ViewResolver>;
    return typeof r.viewMeta === "function" ? r.viewMeta("table:attributes", tableAttributesSql) : Promise.resolve([]);
  }));
  return clinicalColumns(perStudy, new Set(MUTATION_COLUMNS.map((c) => c.id))).slice(0, TABLE_COLUMNS_MAX);
}

/** the table's own columns the portal lists in its Columns menu's Clinical tab, with the attribute each one's Freq counts (null: every sample) */
export const CLINICAL_TAB_BUILTINS: ReadonlyMap<string, string | null> = new Map([
  ["studyOfOrigin", null], ["cancerTypeAll", "CANCER_TYPE"], ["cancerType", "CANCER_TYPE_DETAILED"], ["mutCount", "MUTATION_COUNT"],
]);

/**
 * The Columns menu's Freq (MUT-STM-15) for the Clinical tab's columns, by column id: 100 × the queried samples
 * with a value ÷ the queried samples, over every cohort and study that may list rows (lib/mutation-clinical-freq.ts).
 */
export async function mutationClinicalFreq(ctx: ViewRun, holders: string[], clinical: ClinicalColumn[]): Promise<Record<string, number>> {
  const attrs = [...clinical.map((c) => c.id), ...[...CLINICAL_TAB_BUILTINS.values()].filter((a): a is string => !!a)];
  const asks: Promise<Record<string, unknown>[]>[] = [];
  for (const cn of ctx.vNames) for (const st of ctx.cohorts[cn].studies.filter((s) => holders.includes(s))) {
    const r = ctx.resolvers[st] as Partial<ViewResolver>;
    if (typeof r.viewAggregate === "function") asks.push(r.viewAggregate("mutations:clinical-freq", ctx.doc.cohorts[cn], (c, s, d) => clinicalFreqSql(c, s, d, attrs)));
  }
  const byAttr = clinicalFreq(await Promise.all(asks), attrs);
  return Object.fromEntries([
    ...clinical.map((c) => [c.id, byAttr[c.id] ?? 0] as const),
    ...[...CLINICAL_TAB_BUILTINS].map(([col, attr]) => [col, attr ? byAttr[attr] ?? 0 : 100] as const),
  ]);
}
