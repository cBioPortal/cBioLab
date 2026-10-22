import { parseBody, TableRequest } from "../../../lib/api-schemas.ts";
import { runAnalysis } from "../../../lib/analysis.ts";
import { PAGED_KINDS, TABLE_CHUNK, pagedTable } from "../../../lib/views/rows.ts";
import { csvField, describeQuery } from "../../../lib/table-query.ts";
import { withRequestCustomData } from "../../../lib/custom-data-server.ts";
import { isDrawn, type AnalysisDoc, type ViewResult } from "../../../lib/types.ts";

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
  const line = (xs: unknown[]) => xs.map(csvField).join(",") + "\r\n";
  const enc = new TextEncoder();
  // the header row comes first, so the file opens as a table anywhere; what the query kept and who
  // was left out are on screen and in the view's caveat, and the file name says it was filtered
  const filtered = !!describeQuery(t.query, t.columns);
  const studies = [...new Set(t.lists.map((l) => l.study))];
  const name = "cohort-lab_" + (studies.length === 1 ? studies[0] : studies.length + "-studies") + "_" +
    (v.kind === "table" ? "clinical_" + v.table.unit + "s" : v.kind === "timeline" ? "timeline_patients"
      : v.kind === "alterations" ? (table && v.alterations?.patient ? v.alterations.patient.id + "_" + table : "alterations_patients")
      : v.kind === "mutations" ? v.mutations.gene + "_mutations" : v.kind) + (filtered ? "_filtered" : "") + ".csv";
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(enc.encode(line(["cohort", "study", ...t.columns.map((c) => c.id)])));
        // one order across every cohort and study: page through it whole, as the page view does
        for (let offset = 0; offset < t.total; offset += TABLE_CHUNK) {
          const r = await run(() => runAnalysis(doc, { page: { offset, limit: TABLE_CHUNK }, table }));
          const page = r.views[0];
          const p = pagedTable(page, table);
          if (!p) throw new Error(page.error || "the page at row " + offset + " returned nothing");
          controller.enqueue(enc.encode(p.rows.map((row) => line([row.cohort, row.study, ...row.values])).join("")));
        }
        controller.close();
      } catch (e) {
        // a download cut short must say so in the file, not end as if it were whole
        controller.enqueue(enc.encode(line(["# DOWNLOAD INCOMPLETE: " + String((e as Error)?.message || e)])));
        controller.close();
      }
    }
  });
  return new Response(stream, { headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": "attachment; filename=\"" + name.replace(/[^A-Za-z0-9._-]/g, "_") + "\""
  } });
}
