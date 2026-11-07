// Structural-variants view: the cohort-wide structural-variant table for the queried genes, on lib/table-query.ts
import type { ViewResult } from "../../types.ts";
import { SV_COLUMNS, SV_DEFAULT_COLUMNS, svRowSource } from "../../sv-table.ts";
import { checkQuery, describeQuery, shownColumns } from "../../table-query.ts";
import type { ViewRun } from "../run.ts";
import { TABLE_ROWS_MAX, rowHolders, runRows, tableTail, viewQuery, type Rows } from "../rows.ts";
import { answering, askEachSite, overLimit, plural, refuse } from "../shared.ts";
import type { SvView, SvProfiled } from "./types.ts";
import { svMethod } from "./method.ts";
import { svProfiledSql } from "./sql.ts";

/** the most genes one view lists: a gene list's own limit (lib/gene-tracks.ts) */
export const SV_MAX_GENES = 32;
const GENE = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;

/** A row's value in a column, from the query's row (numbers as numbers, the annotation spelled out as the SQL spells it). */
function svValue(r: Record<string, unknown>, c: { id: string; numeric: boolean }): string | number | null {
  switch (c.id) {
    case "sample": return String(r.sid ?? "");
    case "annotation": {
      const o = String(r.oncogenicity || ""), lv = String(r.level || "");
      return o ? o + (lv ? " · " + lv.replace(/^LEVEL_/, "Level ") : "") : "";
    }
    default: {
      const x = r[c.id];
      if (!c.numeric) return x == null ? "" : String(x);
      return x == null || x === "" ? null : Number(x);
    }
  }
}

/** The view's genes, upper-cased and de-duplicated in order; a string naming what is wrong instead. */
export function svGenes(genes: unknown): string[] | string {
  if (!Array.isArray(genes) || !genes.length) return "a structural-variants view needs genes, e.g. [\"ALK\", \"ROS1\", \"RET\"]";
  const out: string[] = [];
  for (const raw of genes) {
    const g = typeof raw === "string" ? raw.trim().toUpperCase() : "";
    if (!GENE.test(g)) return "genes are gene symbols; " + JSON.stringify(raw) + " is not one";
    if (!out.includes(g)) out.push(g);
  }
  return out.length > SV_MAX_GENES ? "a structural-variants view lists at most " + SV_MAX_GENES + " genes; this names " + out.length : out;
}

/** the caveat's sentence on profiling: per gene, summed over the cohorts and studies (each cohort's own when there are several) */
function profiledText(p: SvProfiled[], genes: string[], cohorts: string[]): string {
  const per = (rows: SvProfiled[]) => genes.map((g) => {
    const x = rows.filter((r) => r.gene === g);
    const sum = (k: "samples" | "profiled" | "altered" | "alteredProfiled") => x.reduce((n, r) => n + r[k], 0);
    const samples = sum("samples"), profiled = sum("profiled"), altered = sum("altered"), viaPartner = altered - sum("alteredProfiled");
    return g + ": " + plural(altered, "sample") + " with a call, " + profiled.toLocaleString("en-US") + " of " + samples.toLocaleString("en-US") + " profiled" +
      (viaPartner ? " (" + viaPartner.toLocaleString("en-US") + " of the samples with a call are on a panel that omits " + g + ": reported through the partner gene)" : "");
  }).join("; ");
  return cohorts.length > 1 ? cohorts.map((c) => "“" + c + "” — " + per(p.filter((r) => r.cohort === c))).join(". ") : per(p);
}

export async function runSv(view: SvView, ctx: ViewRun): Promise<ViewResult> {
  const { vNames, pin } = ctx;
  const no = (msg: string) => refuse("sv", ctx, msg);
  { const e = overLimit("a structural-variants view", 6, vNames.length); if (e) return no(e.replace("at most 6", "at most 6 cohorts")); }
  const genes = svGenes(view.genes);
  if (typeof genes === "string") return no(genes);
  const size = view.rows == null ? 25 : Math.floor(Number(view.rows));
  if (!(size >= 1 && size <= TABLE_ROWS_MAX)) return no("rows (the page size) is 1 to " + TABLE_ROWS_MAX);
  const q = viewQuery(view);
  const bad = checkQuery(q, SV_COLUMNS);
  if (bad) return no(bad);

  const { holders, excluded } = rowHolders(ctx);
  if (!holders.length) return no("no study here may disclose patients' structural variants (" + excluded.map((e) => e.study + ": " + e.reason).join("; ") + ")");
  const shown = shownColumns(q, SV_COLUMNS, SV_DEFAULT_COLUMNS);
  const sub = ctx.page || ctx.values;
  let r: Rows, profiled: SvProfiled[];
  try {
    // every holder is a local participant, and every local participant answers view aggregates
    const { ok } = answering(ctx);
    const own = Object.fromEntries(holders.map((st) => [st, ok[st]]));
    [r, profiled] = await Promise.all([
      runRows(ctx, "sv", holders, q, SV_DEFAULT_COLUMNS, shown, size, (parts) => (db) => svRowSource(parts, db, genes, pin),
        ctx.values ? { column: ctx.values, numeric: !!SV_COLUMNS.find((c) => c.id === ctx.values)?.numeric } : undefined),
      sub ? Promise.resolve([]) : askEachSite(ctx, own, (n, _st, res) => res.viewAggregate("sv:profiled:" + n, ctx.doc.cohorts[n], (c, s, d) => svProfiledSql(c, s, d, genes)))
        .then((xs) => xs.flatMap(({ cohort, study, answer }) => genes.map((gene) => {
          const a = answer.find((x) => x.gene === gene);
          return { cohort, study, gene, samples: ctx.cohorts[cohort].perStudy[study]?.samples ?? Number(a?.samples ?? 0), profiled: Number(a?.profiled ?? 0),
            altered: Number(a?.altered ?? 0), alteredProfiled: Number(a?.altered_profiled ?? 0) };
        }))),
    ]);
  } catch (e) { return no((e as Error).message); }
  const rows = r.rows.map((x) => ({ cohort: String(x.cohort ?? ""), study: String(x.study ?? ""), patient: String(x.patient ?? ""), sample: String(x.sid ?? ""),
    values: SV_COLUMNS.map((c) => svValue(x, c)) }));
  const columns = SV_COLUMNS.map((c) => ({ id: c.id, name: c.name, numeric: c.numeric }));
  const sv = { genes, columns, shown, defaults: SV_DEFAULT_COLUMNS, query: q, rows, offset: r.offset, pageSize: size, lists: r.lists, total: r.total, all: r.all, oncokbPin: pin,
    ...(r.groups > 1 ? { instances: r.groups } : {}), ...(excluded.length ? { excluded } : {}), ...(r.values ? { values: r.values } : {}) };
  if (sub) return { kind: "sv", cohorts: vNames, sv, participation: ctx.participationFor(ctx.vStudies, true) };
  return {
    kind: "sv", cohorts: vNames, sv: { ...sv, profiled },
    method: svMethod({ genes, oncokbPin: pin, queryText: describeQuery(q, columns),
      sortName: q.sort ? columns.find((c) => c.id === q.sort!.column)?.name || q.sort.column : null, desc: !!q.sort?.desc,
      shown: rows.length, lists: r.lists, excluded, instances: r.groups, profiled }),
    participation: ctx.participationFor(ctx.vStudies, true),
    ...(ctx.vStudies.length > 1 ? { studies: ctx.vStudies } : {}),
    caveat: "Every structural variant in " + (vNames.length > 1 ? "each cohort's" : "the cohort's") + " samples whose gene 1 or gene 2 is " + (genes.length > 1 ? "one of " : "") + genes.join(", ") +
      ", one row per call as the portal lists them (a patient with several samples carrying the same event has a row for each" +
      (genes.length > 1 ? "; a call between two of the genes is listed once" : "") + "). " +
      (profiled.length ? "Profiling, panel-aware — " + profiledText(profiled, genes, vNames) + ". A sample not profiled for a gene's structural variants has no row and is not counted as without one. " : "") +
      (pin ? "Annotation is OncoKB " + pin + "'s gene-level fusion call (its 'Fusion' entry) for the stronger of the two partners, where its store holds one — not the portal's per-pair fusion annotation; a blank means no call for either gene. "
        : "No OncoKB version is pinned here, so the annotation column is empty. ") +
      "Genes 1 and 2 are as the study records the breakpoints (site 1, site 2), not reordered. " +
      tableTail(r, q, columns, "structural variant", (pin ? "drivers first, then " : "") + "by gene 1, then gene 2", excluded, vNames.length > 1),
  };
}
