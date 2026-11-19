// The facts the Mutations table's default columns follow (lib/mutation-table.ts mutationDefaultColumns),
// shared by the mutations view, whose table shows them, and the hotspots view, whose plot a search
// of that table narrows over the same columns.
import { MUTATION_COLUMNS, MUTATION_DEFAULT_COLUMNS, mutationDefaultColumns, mutationRowSource, type MutationDefaultFacts, type TablePart } from "../mutation-table.ts";
import { clinicalColumns, type ClinicalColumn } from "../mutation-clinical.ts";
import { tableAttributesSql, TABLE_COLUMNS_MAX } from "../clinical-table.ts";
import type { ViewResolver } from "./shared.ts";
import type { RowSource } from "../table-query.ts";
import type { LollipopOql } from "../federation.ts";
import type { ResolvedDrivers } from "../driver-settings.ts";
import { variantPins } from "../variant-annotation.ts";
import type { ViewRun } from "./run.ts";
import { runRows } from "./rows.ts";

/**
 * Over every row of the gene's table whatever its search and filters (the portal reads its table's
 * allData): whether a queried study has a discrete CNA profile, whether a row has a non-zero allele
 * frequency, how many Cancer Type Detailed values the rows hold. A study whose peer did not describe
 * its profiles (`unanswered`) leaves the first unknown, unless another study has the profile.
 */
export async function mutationDefaultFacts(ctx: ViewRun, holders: string[], source: (parts: TablePart[]) => (db: string) => RowSource): Promise<MutationDefaultFacts> {
  const valuesOf = async (column: string, numeric: boolean) =>
    (await runRows(ctx, "mutations", holders, {}, MUTATION_DEFAULT_COLUMNS, MUTATION_DEFAULT_COLUMNS, 1, source, { column, numeric })).values;
  const [vaf, types, studies] = await Promise.all([valuesOf("vaf", true), valuesOf("cancerType", false),
    Promise.all(ctx.vStudies.map((st) => ctx.studyProfiles(st)))]);
  // a study with the profile settles it; otherwise every study must have answered for "none" to be known
  const discrete = studies.some((p) => (p.catalog || []).some((x) => x.type === "COPY_NUMBER_ALTERATION" && x.datatype === "DISCRETE"));
  const known = studies.every((p) => p.catalog && !p.unanswered);
  return {
    ...(discrete || known ? { discreteCna: discrete } : {}),
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
