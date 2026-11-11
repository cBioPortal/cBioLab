// Mutations view: the mutation table for one gene, on lib/table-query.ts
import type { ViewResult } from "../../types.ts";
import { geneSymbols } from "../../gene-tracks.ts";
import { MUTATION_COLUMNS, MUTATION_DEFAULT_COLUMNS, mutationRowSource, alterationOf } from "../../mutation-table.ts";
import { checkQuery, describeQuery, shownColumns } from "../../table-query.ts";
import type { ViewRun } from "../run.ts";
import { TABLE_ROWS_MAX, rowHolders, runRows, tableTail, viewQuery, type Rows } from "../rows.ts";
import { overLimit, refuse } from "../shared.ts";
import type { MutationsView } from "./types.ts";
import { mutationsMethod } from "./method.ts";
import { describePins, studiesWithoutVariantAnnotation, variantPins } from "../../variant-annotation.ts";
import { twoDigits } from "../../mutation-cell-text.ts";

/** A row's value in a column, from the query's row (numbers as numbers, the annotation spelled out as the SQL spells it). */
function mutationValue(r: Record<string, unknown>, id: string, pin: string | null): string | number | null {
  const num = (x: unknown) => x == null || x === "" ? null : Number(x);
  switch (id) {
    case "sample": return String(r.sid ?? "");
    case "annotation": {
      const o = String(r.oncogenicity || ""), lv = String(r.level || "");
      return o ? o + (lv ? " · " + lv.replace(/^LEVEL_/, "Level ") : "") : "";
    }
    case "vaf": return r.vaf == null ? null : Math.round(Number(r.vaf) * 1000) / 1000;
    case "alteration": return alterationOf(String(r.mutationType ?? ""), Number(r.drv) === 1, pin);
    case "altCount": case "refCount": case "mutCount": case "start": case "end": return num(r[id]);
    case "proteinPos": return r.pos == null ? "" : String(r.pos);
    case "clinvar": return r.clinvar ? String(r.clinvar) + (r.clinvarConflicting ? "(" + String(r.clinvarConflicting) + ")" : "") : "";
    case "signal": return r.signalFreq == null ? "" : twoDigits(Number(r.signalFreq));
    default: return r[id] == null ? "" : String(r[id]);
  }
}

/**
 * What a row's cells show beyond their text: whether its variant has a stored annotation, ClinVar's
 * record, SIGNAL's germline entry, and the study's genome (HGVSg links to that genome's Genome Nexus).
 */
function mutationDetail(r: Record<string, unknown>, build: string | undefined): Record<string, unknown> | undefined {
  const d: Record<string, unknown> = {};
  // the portal draws ClinVar's cell from the record whenever there is one, an empty significance included
  if (Number(r.clinvarId) > 0 || r.clinvar) d.clinvar = { significance: String(r.clinvar || ""), conflicting: String(r.clinvarConflicting || ""), id: Number(r.clinvarId) || null };
  if (Number(r.gnOk) === 1) d.annotated = true;
  if (r.sig) { try { d.signal = JSON.parse(String(r.sig)); } catch { /* not JSON: shown without its table */ } }
  if (build === "hg38") d.grch38 = true;
  return Object.keys(d).length ? d : undefined;
}

export async function runMutations(view: MutationsView, ctx: ViewRun): Promise<ViewResult> {
  const { vNames, pin } = ctx;
  { const e = overLimit("a mutations view", 6, vNames.length); if (e) return refuse("mutations", ctx, e.replace("at most 6", "at most 6 cohorts")); }
  let gene: string;
  try { [gene] = geneSymbols([view.gene]); } catch (e) { return refuse("mutations", ctx, (e as Error).message); }
  if (!gene) return refuse("mutations", ctx, "a mutations view needs a gene, e.g. KRAS");
  const size = view.rows == null ? 25 : Math.floor(Number(view.rows));
  if (!(size >= 1 && size <= TABLE_ROWS_MAX)) return refuse("mutations", ctx, "rows (the page size) is 1 to " + TABLE_ROWS_MAX);
  const q = viewQuery(view);
  const bad = checkQuery(q, MUTATION_COLUMNS);
  if (bad) return refuse("mutations", ctx, bad);

  const { holders, excluded } = rowHolders(ctx);
  const [pins, unannotated] = await Promise.all([variantPins(), studiesWithoutVariantAnnotation(holders)]);
  if (!holders.length) return refuse("mutations", ctx, "no study here may disclose patients' mutations (" + excluded.map((e) => e.study + ": " + e.reason).join("; ") + ")");
  let r: Rows;
  try {
    r = await runRows(ctx, "mutations", holders, q, MUTATION_DEFAULT_COLUMNS, shownColumns(q, MUTATION_COLUMNS, MUTATION_DEFAULT_COLUMNS), size, (parts) => (db) => mutationRowSource(parts, db, gene, pin, pins),
      ctx.values ? { column: ctx.values, numeric: !!MUTATION_COLUMNS.find((c) => c.id === ctx.values)?.numeric } : undefined);
  } catch (e) { return refuse("mutations", ctx, (e as Error).message); }
  const rows = r.rows.map((x) => {
    const detail = mutationDetail(x, x.build == null ? undefined : String(x.build));
    return { cohort: String(x.cohort ?? ""), study: String(x.study ?? ""), patient: String(x.patient ?? ""), sample: String(x.sid ?? ""),
      values: MUTATION_COLUMNS.map((c) => mutationValue(x, c.id, pin)), ...(detail ? { detail } : {}) };
  });
  const gn = describePins(pins);
  const shown = shownColumns(q, MUTATION_COLUMNS, MUTATION_DEFAULT_COLUMNS);
  const mutations = { gene, columns: MUTATION_COLUMNS, shown, defaults: MUTATION_DEFAULT_COLUMNS, query: q, rows, offset: r.offset, pageSize: size, lists: r.lists, total: r.total, all: r.all, oncokbPin: pin, variantPins: pins,
    ...(unannotated.length ? { unannotated } : {}),
    ...(r.groups > 1 ? { instances: r.groups } : {}), ...(excluded.length ? { excluded } : {}), ...(r.values ? { values: r.values } : {}) };
  if (ctx.page || ctx.values) return { kind: "mutations", cohorts: vNames, mutations, participation: ctx.participationFor(ctx.vStudies, true) };
  return {
    kind: "mutations", cohorts: vNames, mutations,
    method: mutationsMethod({ gene, cohorts: vNames, oncokbPin: pin, variantPins: gn, queryText: describeQuery(q, MUTATION_COLUMNS),
      sortName: q.sort ? MUTATION_COLUMNS.find((c) => c.id === q.sort!.column)?.name || q.sort.column : null, desc: !!q.sort?.desc,
      shown: rows.length, lists: r.lists, excluded, instances: r.groups }),
    participation: ctx.participationFor(ctx.vStudies, true),
    ...(ctx.vStudies.length > 1 ? { studies: ctx.vStudies } : {}),
    caveat: "Every " + gene + " mutation call in " + (vNames.length > 1 ? "each cohort's" : "the cohort's") + " samples, one row per call; uncalled mutations are left out, as the portal leaves them out. " +
      (pin ? "Annotation is OncoKB " + pin + " (oncogenicity and its highest sensitivity level for the gene). " : "No OncoKB version is pinned here, so the annotation column is empty. ") +
      (gn ? "HGVSc, ClinVar and SIGNAL are " + gn + ", read from the offline store; HGVSc is on the canonical transcript of " + gene + " (MSKCC overrides). " +
        (unannotated.length ? "Not yet annotated, so blank in those columns: " + (unannotated.length <= 3 ? unannotated.join(", ") : unannotated.length + " studies") + ". " : "")
        : "No Genome Nexus release is stored here, so HGVSc, ClinVar and SIGNAL are empty. ") +
      "Allele frequency is variant reads over variant + reference reads; # Mut in Sample is the study's own MUTATION_COUNT, blank where it records none. " +
      tableTail(r, q, MUTATION_COLUMNS, "mutation", "drivers first, then by codon", excluded, vNames.length > 1)
  };
}
