import { runAnalysis } from "../../../lib/analysis.ts";
import { TABLE_CHUNK } from "../../../lib/clinical-table.ts";
import type { AnalysisDoc, TableResult } from "../../../lib/types.ts";

export const maxDuration = 300;

/**
 * A table view's every row, as TSV — the Clinical Data tab's download.
 *
 * The rows come from the table view itself, a page at a time (`tableChunk`), so this route adds no
 * data path of its own: a study that may not disclose patients contributes no rows here exactly as
 * it contributes none on screen, and the header says which studies were left out. The engine runs
 * uncached: a whole table is not an answer to keep, and a page is cheap to recompute.
 *
 * Takes a form post (`doc`, the analysis document as JSON, and `view`, the table view's index) so
 * the browser saves the file as it streams, or the same fields as JSON.
 */
export async function POST(req: Request) {
  let doc: AnalysisDoc, vi: number;
  try {
    const type = req.headers.get("content-type") || "";
    const body = type.includes("application/json") ? await req.json() : Object.fromEntries((await req.formData()).entries());
    doc = typeof body.doc === "string" ? JSON.parse(body.doc) : body.doc;
    vi = Number(body.view);
    const view = doc && Array.isArray(doc.views) ? doc.views[vi] : null;
    if (!view || view.kind !== "table") throw new Error("view " + body.view + " is not a table view");
    doc = { ...doc, views: [view] };
  } catch (e) {
    return new Response("cannot download: " + String((e as Error)?.message || e) + "\n", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const first = await runAnalysis(doc).catch((e) => ({ views: [{ kind: "table", error: String((e as Error)?.message || e) }] }));
  const v = first.views[0] as { error?: string; table?: TableResult };
  if (!v.table) return new Response("cannot download: " + (v.error || "the table view returned nothing") + "\n", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  const t = v.table;
  const cell = (s: unknown) => String(s ?? "").replace(/[\t\r\n]+/g, " ");
  const line = (xs: unknown[]) => xs.map(cell).join("\t") + "\n";
  const enc = new TextEncoder();
  const studies = [...new Set(t.lists.map((l) => l.study))];
  const name = "cohort-lab_" + (studies.length === 1 ? studies[0] : studies.length + "-studies") + "_clinical_" + t.unit + "s.tsv";
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (t.excluded && t.excluded.length)
          controller.enqueue(enc.encode("# left out (do not disclose patients): " + t.excluded.map((e) => e.study + " — " + e.patients + " patients").join("; ") + "\n"));
        controller.enqueue(enc.encode(line(["cohort", "study", "patient_id", t.unit === "sample" ? "sample_id" : "samples", ...t.columns.map((c) => c.id)])));
        for (const l of t.lists) {
          for (let offset = 0; offset < l.total; offset += TABLE_CHUNK) {
            const r = await runAnalysis(doc, { tableChunk: { cohort: l.cohort, study: l.study, offset, limit: TABLE_CHUNK } });
            const page = (r.views[0] as { error?: string; table?: TableResult });
            if (!page.table) throw new Error(page.error || "a page of " + l.cohort + " in " + l.study + " returned nothing");
            controller.enqueue(enc.encode(page.table.rows.map((row) =>
              line([row.cohort, row.study, row.patient, t.unit === "sample" ? row.sample : row.samples, ...row.values])).join("")));
          }
        }
        controller.close();
      } catch (e) {
        // a download cut short must say so in the file, not end as if it were whole
        controller.enqueue(enc.encode("# DOWNLOAD INCOMPLETE: " + cell((e as Error)?.message || e) + "\n"));
        controller.close();
      }
    }
  });
  return new Response(stream, { headers: {
    "content-type": "text/tab-separated-values; charset=utf-8",
    "content-disposition": "attachment; filename=\"" + name.replace(/[^A-Za-z0-9._-]/g, "_") + "\""
  } });
}
