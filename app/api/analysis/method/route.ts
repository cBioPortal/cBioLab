// POST /api/analysis/method — one view's Python script (its method record's `python`), asked for
// when the reader opens it. The page's analysis requests leave the script out (it can be most of a
// view's response, and is read only on demand), so the body is the same one-view document the
// page sent for that view: it is answered from the same result cache, not run again.
import { parseBody, AnalysisRequest } from "../../../../lib/api-schemas.ts";
import type { AnalysisDoc } from "../../../../lib/types.ts";
import { cachedAnalysis } from "../../../../lib/next-cache.ts";
import { withRequestCustomData } from "../../../../lib/custom-data-server.ts";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { customData, customRefs, ...doc } = parseBody(AnalysisRequest, await req.json());
    const result = await withRequestCustomData(customData, () => cachedAnalysis(doc as unknown as AnalysisDoc, { oncoprint: "spec" }), { refs: customRefs, req });
    const view = result.views[0];
    if (!view || view.error) return Response.json({ error: view ? view.error : "the document has no view" }, { status: 422 });
    return Response.json({ python: view.method?.python ?? null });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
