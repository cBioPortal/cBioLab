import { parseBody, TableRequest } from "../../../lib/api-schemas.ts";
import { runAnalysis } from "../../../lib/analysis.ts";
import { PAGED_KINDS, TABLE_CHUNK, pagedTable } from "../../../lib/views/rows.ts";
import { csvField, describeQuery } from "../../../lib/table-query.ts";
import { withRequestCustomData } from "../../../lib/custom-data-server.ts";
import { isDrawn, type AnalysisDoc, type TableRows, type ViewResult } from "../../../lib/types.ts";
import { TABLE_COLUMNS_MAX } from "../../../lib/clinical-table.ts";
import { caseFileBreaks, caseFileHeader, caseFileLine, caseFileLineBreaks, caseFileColumnsCut, type CaseFileFormat } from "../../../lib/study-view-case-files.ts";
import { portalDisposition, portalMatrix } from "../../../lib/views/datafiles/portal-file.ts";

export const maxDuration = 300;

/**
 * A table view's every row the query keeps, with every column, as CSV — the download of every
 * table view (the clinical table, the mutation table, and any later one).
 *
 * The rows come from the view itself, a page at a time (RunOpts.page), so this route adds no
 * data path of its own: a study that may not disclose patients contributes no rows here exactly as
 * it contributes none on screen. A download cut short ends with a # line saying so. The engine runs
 * uncached: a whole table is not an answer to keep.
 *
 * Takes a form post whose `payload` field is JSON — { doc, view, customData?, customRefs? }, the
 * same body /api/view-page takes — so the browser saves the file as it streams; or that JSON as
 * the request body.
 */
export async function POST(req: Request) {
  let doc: AnalysisDoc, body: Record<string, unknown>;
  try {
    const type = req.headers.get("content-type") || "";
    body = parseBody(TableRequest, type.includes("application/json") ? await req.json() : JSON.parse(String((await req.formData()).get("payload") || "{}")));
    doc = (typeof body.doc === "string" ? JSON.parse(body.doc) : body.doc) as AnalysisDoc;
    const vi = body.view as number;
    const view = doc && Array.isArray(doc.views) ? doc.views[vi] : null;
    if (!view || !PAGED_KINDS.includes(view.kind)) throw new Error("view " + body.view + " is not a table view");
    doc = { ...doc, views: [view] };
  } catch (e) {
    return new Response("cannot download: " + String((e as Error)?.message || e) + "\n", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const run = <T,>(fn: () => Promise<T>) => withRequestCustomData(body.customData, fn, { refs: body.customRefs, req, uses: body });
  const table = typeof body.table === "string" ? body.table : undefined;
  const first = await run(() => runAnalysis(doc, { table })).catch((e) => ({ views: [{ kind: doc.views![0].kind, cohorts: [], error: String((e as Error)?.message || e) } as ViewResult] }));
  const v = first.views[0];
  const t = pagedTable(v, table);
  if (!t || !isDrawn(v)) return new Response("cannot download: " + (v.error || "the view returned nothing") + "\n", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  if (body.format === "tsv" || body.format === "tsv-transposed") return portalFile(v, t, table, body.format === "tsv-transposed", run, doc);
  if (body.caseFile) return caseFileResponse(t, body.caseFile as CaseFileFormat, (offset) => run(() => runAnalysis(doc, { page: { offset, limit: TABLE_CHUNK }, table })), table);
  const line = (xs: unknown[]) => xs.map(csvField).join(",") + "\r\n";
  // the header row comes first, so the file opens as a table anywhere; what the query kept and who
  // was left out are on screen and in the view's caveat, and the file name says it was filtered
  const filtered = !!describeQuery(t.query, t.columns);
  const studies = [...new Set(t.lists.map((l) => l.study))];
  const name = "cohort-lab_" + (studies.length === 1 ? studies[0] : studies.length + "-studies") + "_" +
    (v.kind === "table" ? "clinical_" + v.table.unit + "s" : v.kind === "timeline" ? "timeline_patients"
      : v.kind === "alterations" ? (table && v.alterations?.patient ? v.alterations.patient.id + "_" + table : "alterations_patients")
      : v.kind === "evolution" ? (table && v.evolution?.patient ? v.evolution.patient.id + "_evolution_" + table : "evolution_patients")
      : v.kind === "signatures" ? "signatures_patients"
      : v.kind === "mutations" ? v.mutations.gene + "_mutations" : v.kind === "sv" ? v.sv.genes.join("-") + "_structural_variants"
      : v.kind === "datafiles" ? (table && table !== "cases" ? table.replace(/^profile:/, "") : "alterations_by_sample") : v.kind) + (filtered ? "_filtered" : "") + ".csv";
  // every line leads with the row's cohort and study, so a table's own column of the same name is not repeated
  const keep = t.columns.map((c, i) => (c.id === "cohort" || c.id === "study" ? -1 : i)).filter((i) => i >= 0);
  const stream = pageStream(t.total, (offset) => run(() => runAnalysis(doc, { page: { offset, limit: TABLE_CHUNK }, table })), table, {
    head: () => line(["cohort", "study", ...keep.map((i) => t.columns[i].id)]),
    rows: (p) => p.rows.map((row) => line([row.cohort, row.study, ...keep.map((i) => row.values[i])])).join(""),
    // a download cut short must say so in the file, not end as if it were whole
    cut: (why) => line(["# DOWNLOAD INCOMPLETE: " + why]),
  });
  return new Response(stream, { headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": "attachment; filename=\"" + name.replace(/[^A-Za-z0-9._-]/g, "_") + "\""
  } });
}

/**
 * The table's shown columns as a cBioPortal Study View file (download-cases.md PC, clinical-tab-cases.md
 * CT11-CT12): TSV, a line per row, the line breaks the format says. The studies left out, that may not list their patients, are
 * named in the x-left-out header. A download cut short ends with a # line, as the CSV does.
 */
function caseFileResponse(t: TableRows<unknown>, format: CaseFileFormat, page: (offset: number) => Promise<{ views: ViewResult[] }>, table: string | undefined): Response {
  const shown = t.shown.filter((id) => id !== "cohort" && id !== "study" && id !== "samples");
  const at = shown.map((id) => t.columns.findIndex((c) => c.id === id)).filter((i) => i >= 0);
  const { before, after } = caseFileBreaks(format);
  const stream = pageStream(t.total, page, table, {
    head: () => caseFileHeader(at.map((i) => t.columns[i]), format) + after,
    rows: (p) => p.rows.map((row) => before + caseFileLine(row.study, at.map((i) => String(row.values[i] ?? "")), format) + after).join(""),
    cut: (why) => (before || "") + "# DOWNLOAD INCOMPLETE: " + why.replace(/\s+/g, " ") + after,
  });
  const left = (t.excluded || []).map((e) => e.study + ": " + e.reason).join("; ");
  const cut = caseFileColumnsCut(t as TableRows<unknown> & { attributesOf?: number }, at.filter((i) => !["patient", "sample"].includes(t.columns[i].id)).length);
  return new Response(stream, { headers: {
    "content-type": "text/tab-separated-values; charset=utf-8",
    // what the file must hold to be whole, so the page can tell a cut one from a finished one
    "x-line-breaks": String(caseFileLineBreaks(t.total, format)),
    ...(left ? { "x-left-out": encodeURIComponent(left) } : {}),
    ...(cut ? { "x-columns-cut": encodeURIComponent(cut.held + " of the " + cut.of + " attributes (a table holds at most " + TABLE_COLUMNS_MAX + ")") } : {}),
  } });
}

/**
 * A table's rows streamed whole, a page of TABLE_CHUNK at a time in one order across every cohort and
 * study: the header, each page's lines, and on any failure (the header's included) a last line saying
 * the file was cut short.
 */
function pageStream(total: number, page: (offset: number) => Promise<{ views: ViewResult[] }>, table: string | undefined,
  write: { head: () => string; rows: (p: TableRows<unknown>) => string; cut: (why: string) => string }): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(enc.encode(write.head()));
        for (let offset = 0; offset < total; offset += TABLE_CHUNK) {
          const r = await page(offset);
          const p = pagedTable(r.views[0], table);
          if (!p) throw new Error(r.views[0].error || "the page at row " + offset + " returned nothing");
          controller.enqueue(enc.encode(write.rows(p)));
        }
      } catch (e) {
        controller.enqueue(enc.encode(write.cut(String((e as Error)?.message || e))));
      }
      controller.close();
    }
  });
}

/**
 * A Download-tab gene-by-sample file in the portal's format (Tab Delimited Format, or its Transposed
 * Matrix): every row read first, since the transposed file's lines run across all of them; a read cut
 * short refuses the file rather than writing part of it.
 */
async function portalFile(v: ViewResult, t: NonNullable<ReturnType<typeof pagedTable>>, table: string | undefined, transposed: boolean,
  run: <T>(fn: () => Promise<T>) => Promise<T>, doc: AnalysisDoc): Promise<Response> {
  const file = v.kind === "datafiles" ? v.datafiles?.files.find((f) => f.id === table && f.portalFile) : undefined;
  if (!file) return new Response("cannot download: the portal's tab-delimited formats are for the Download tab's gene-by-sample files\n", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  const genes = t.columns.slice(2).map((c) => c.name);
  const rows: { study: string; sample: string; values: string[] }[] = [];
  try {
    for (let offset = 0; offset < t.total; offset += TABLE_CHUNK) {
      const r = await run(() => runAnalysis(doc, { page: { offset, limit: TABLE_CHUNK }, table }));
      const p = pagedTable(r.views[0], table);
      if (!p) throw new Error(r.views[0].error || "the page at row " + offset + " returned nothing");
      for (const row of p.rows) rows.push({ study: row.study, sample: row.sample, values: row.values.slice(2).map(String) });
    }
  } catch (e) {
    return new Response("cannot download: " + String((e as Error)?.message || e) + "\n", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const name = transposed ? file.portalFile!.replace(/\.txt$/, "_transposed.txt") : file.portalFile!;
  return new Response(portalMatrix(genes, rows, transposed), { headers: {
    "content-type": "text/plain; charset=utf-8",
    "content-disposition": portalDisposition(name)
  } });
}
