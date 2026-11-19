// The facts the Mutations table's default columns follow (lib/mutation-table.ts mutationDefaultColumns),
// shared by the mutations view, whose table shows them, and the hotspots view, whose plot a search
// of that table narrows over the same columns.
import { MUTATION_DEFAULT_COLUMNS, mutationDefaultColumns, mutationRowSource, type MutationDefaultFacts, type TablePart } from "../mutation-table.ts";
import type { RowSource } from "../table-query.ts";
import type { LollipopOql } from "../federation.ts";
import type { ResolvedDrivers } from "../driver-settings.ts";
import { variantPins } from "../variant-annotation.ts";
import type { ViewRun } from "./run.ts";
import { runRows } from "./rows.ts";

/**
 * Over every row of the gene's table whatever its search and filters (the portal reads its table's
 * allData): whether a queried study has a discrete CNA profile, whether a row has a non-zero allele
 * frequency, how many Cancer Type Detailed values the rows hold. A study whose profiles could not be
 * read (an empty catalog: every study has at least its mutation profile) leaves the first unknown.
 */
export async function mutationDefaultFacts(ctx: ViewRun, holders: string[], source: (parts: TablePart[]) => (db: string) => RowSource): Promise<MutationDefaultFacts> {
  const valuesOf = async (column: string, numeric: boolean) =>
    (await runRows(ctx, "mutations", holders, {}, MUTATION_DEFAULT_COLUMNS, MUTATION_DEFAULT_COLUMNS, 1, source, { column, numeric })).values;
  const [vaf, types, catalogs] = await Promise.all([valuesOf("vaf", true), valuesOf("cancerType", false),
    Promise.all(ctx.vStudies.map(async (st) => (await ctx.studyProfiles(st)).catalog))]);
  return {
    ...(catalogs.every((c) => c && c.length) ? { discreteCna: catalogs.some((c) => c!.some((p) => p.type === "COPY_NUMBER_ALTERATION" && p.datatype === "DISCRETE")) } : {}),
    ...(vaf?.numeric ? { nonZeroVaf: vaf.max != null && vaf.max > 0 } : {}),
    ...(types && !types.numeric ? { cancerTypes: types.truncated ? Infinity : types.values.filter((x) => x.value !== "").length } : {}),
  };
}

/** The table's default columns for one gene, as the mutations view would show them under these settings, from the studies that may list its rows (`holders`). */
export async function mutationDefaults(ctx: ViewRun, holders: string[], gene: string, oql: LollipopOql | undefined, drivers: ResolvedDrivers | undefined): Promise<string[]> {
  if (!holders.length) return MUTATION_DEFAULT_COLUMNS;
  const pins = await variantPins();
  return mutationDefaultColumns(await mutationDefaultFacts(ctx, holders, (parts) => (db) => mutationRowSource(parts, db, gene, ctx.pin, pins, oql, drivers)));
}
