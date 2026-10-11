// Table view: the clinical data table, on lib/table-query.ts
import type { ViewResult, TableView } from "../types.ts";
import { tableAttributesSql, clinicalRowSource, idColumns, TABLE_COLUMNS_MAX, type TableColumn } from "../clinical-table.ts";
import { checkQuery, describeQuery, shownColumns } from "../table-query.ts";
import { tableMethod } from "../method.ts";
import type { ViewRun } from "./run.ts";
import { overLimit, ATTR_NAME, plural, refuse, type ViewResolver } from "./shared.ts";
import { TABLE_ROWS_MAX, rowHolders, runRows, tableTail, viewQuery, type Rows } from "./rows.ts";

export async function runTable(view: TableView, ctx: ViewRun): Promise<ViewResult> {
  const { vNames } = ctx;
  { const e = overLimit("a table view", 6, vNames.length); if (e) return refuse("table", ctx, e.replace("at most 6", "at most 6 cohorts")); }
  const unit: "sample" | "patient" = view.unit === "patient" ? "patient" : "sample";
  const show = view.rows == null ? 25 : Math.floor(Number(view.rows));
  if (!(show >= 1 && show <= TABLE_ROWS_MAX)) return refuse("table", ctx, "rows (the page size) is 1 to " + TABLE_ROWS_MAX);
  const q = viewQuery(view);
  if (q.columns && q.columns.some((a) => typeof a !== "string" || !ATTR_NAME.test(a) && !["patient", "sample", "samples"].includes(a)))
    return refuse("table", ctx, "columns is a list of column ids: patient, " + (unit === "sample" ? "sample" : "samples") + " and clinical attribute ids, e.g. [\"patient\", \"CANCER_TYPE\", \"AGE\"]");

  const { holders, excluded } = rowHolders(ctx);
  if (!holders.length) return refuse("table", ctx, "no study here may disclose patients' rows (" + excluded.map((e) => e.study + ": " + e.reason).join("; ") + ")");

  const all: TableColumn[] = [];
  for (const st of holders) {
    for (const m of await (ctx.resolvers[st] as ViewResolver).viewMeta("table:attributes", tableAttributesSql)) {
      if (all.some((c) => c.id === m.id)) continue;
      all.push({ id: String(m.id), name: String(m.name || m.id), per: Number(m.patient) === 1 ? "patient" : "sample", numeric: String(m.datatype).toUpperCase() === "NUMBER" });
    }
  }
  const usable = unit === "patient" ? all.filter((c) => c.per === "patient") : all;
  const ids = idColumns(unit);
  const known = [...ids, ...usable];
  const bad = checkQuery(q, known);
  if (bad) {
    const sampleAttr = unit === "patient" && [...(q.columns || []), ...Object.keys(q.filters || {}), ...(q.sort ? [q.sort.column] : [])].find((a) => all.some((c) => c.id === a && c.per === "sample"));
    return refuse("table", ctx, sampleAttr ? sampleAttr + " is a sample attribute; a per-patient table holds patient attributes only" : bad);
  }
  // the attributes the table holds: every one, unless the studies record more than a table carries
  const named = new Set([...(q.columns || []), ...Object.keys(q.filters || {}), ...(q.sort ? [q.sort.column] : [])]);
  const held = usable.length <= TABLE_COLUMNS_MAX ? usable
    : [...usable.filter((c) => named.has(c.id)), ...usable.filter((c) => !named.has(c.id))].slice(0, TABLE_COLUMNS_MAX);
  const defaults = [...ids.map((c) => c.id), ...held.map((c) => c.id)];

  let r: Rows;
  try {
    r = await runRows(ctx, "table", holders, q, defaults, shownColumns(q, known, defaults), show,
      (parts, reads) => (db) => clinicalRowSource(parts, db, unit, reads === "all" ? held : held.filter((c) => reads.includes(c.id))),
      ctx.values ? { column: ctx.values, numeric: !!known.find((c) => c.id === ctx.values)?.numeric } : undefined);
  } catch (e) { return refuse("table", ctx, (e as Error).message); }
  const columns = [...ids.map((c) => ({ id: c.id, name: c.name, numeric: c.numeric })), ...held.map((c) => ({ id: c.id, name: c.name, numeric: c.numeric }))];
  const shown = shownColumns(q, columns, defaults);
  const rows = r.rows.map((x) => {
    const m = (x.m || {}) as Record<string, string>;
    const own: Record<string, string> = { patient: String(x.patient ?? ""), sample: String(x.sample ?? ""), samples: String(x.samples ?? "") };
    return { cohort: String(x.cohort), study: String(x.study), patient: own.patient, sample: own.sample, values: columns.map((c) => c.id in own && ids.some((i) => i.id === c.id) ? own[c.id] : m[c.id] ?? "") };
  });
  const table = { unit, columns, shown, defaults, query: q, rows, offset: r.offset, pageSize: show, lists: r.lists, total: r.total, all: r.all,
    ...(r.groups > 1 ? { instances: r.groups } : {}), ...(excluded.length ? { excluded } : {}), ...(r.values ? { values: r.values } : {}) };
  if (ctx.page || ctx.values) return { kind: "table", cohorts: vNames, table, participation: ctx.participationFor(ctx.vStudies, true) };
  const one = unit === "sample" ? "sample" : "patient";
  return {
    kind: "table", cohorts: vNames,
    table,
    method: tableMethod({ unit, cohorts: vNames, columns: held.length, query: q, queryText: describeQuery(q, columns), sortName: q.sort ? columns.find((c) => c.id === q.sort!.column)?.name || q.sort.column : null,
      shown: rows.length, lists: r.lists, excluded, instances: r.groups }),
    participation: ctx.participationFor(ctx.vStudies, true),
    ...(ctx.vStudies.length > 1 ? { studies: ctx.vStudies } : {}),
    caveat: "One row per " + one + (unit === "sample" ? " of each cohort's patients, carrying its patient's attributes too" : "") +
      ", with " + plural(held.length, "attribute") + " as each study recorded them" + (held.length < usable.length ? " (of " + usable.length + "; name others in columns)" : "") +
      " — vocabularies are not harmonized across studies. " +
      tableTail(r, q, columns, one, "by patient and sample id", excluded, vNames.length > 1)
  };
}
