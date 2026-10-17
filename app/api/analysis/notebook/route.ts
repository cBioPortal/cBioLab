// POST /api/analysis/notebook — one view's method record as a Jupyter notebook (.ipynb).
//
// The body is the analysis document, with `notebookView` naming the view. The server runs the
// document (through the result cache), takes that view's recorded queries and rebuilds the files
// its Python script reads from them (lib/method-data.ts), so what is exported is what the view
// computed from, never SQL a caller supplied. A view whose rows came from a federated peer is
// refused (403), and so is a result past the size limits (413).
import { parseBody, NotebookRequest } from "../../../../lib/api-schemas.ts";
import type { AnalysisDoc } from "../../../../lib/types.ts";
import { cachedAnalysis } from "../../../../lib/next-cache.ts";
import { withRequestCustomData } from "../../../../lib/custom-data-server.ts";
import { ExportRefused, methodFiles } from "../../../../lib/method-data.ts";
import { methodNotebook } from "../../../../lib/method-notebook.ts";

export const maxDuration = 120;

const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "view";

export async function POST(req: Request) {
  try {
    const { customData, customRefs, notebookView, ...doc } = parseBody(NotebookRequest, await req.json());
    const nb = await withRequestCustomData(customData, async () => {
      const result = await cachedAnalysis(doc as unknown as AnalysisDoc, { oncoprint: "spec" });
      const view = result.views[notebookView.index];
      if (!view || view.kind !== notebookView.kind)
        throw new ExportRefused("the document has no " + notebookView.kind + " view at position " + (notebookView.index + 1), 422);
      if (view.error) throw new ExportRefused("this view failed, so there is nothing to export: " + view.error, 422);
      if (!view.method?.python) throw new ExportRefused("this view has no Python script to export", 422);
      const { files, missing } = await methodFiles(view);
      return methodNotebook({
        view, method: view.method, files, missing, doc, viewIndex: notebookView.index,
        origin: process.env.APP_BASE_URL || new URL(req.url).origin,
      });
    }, { refs: customRefs, req, uses: doc });
    const name = slug(notebookView.kind + "-" + String((doc as { study?: string }).study || "")) + ".ipynb";
    return new Response(JSON.stringify(nb), {
      headers: { "Content-Type": "application/x-ipynb+json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
    });
  } catch (e) {
    const status = e instanceof ExportRefused ? e.status : 400;
    return Response.json({ error: String((e as Error)?.message || e) }, { status });
  }
}
