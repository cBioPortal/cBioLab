import { runAnalysis } from "../../../lib/analysis.ts";
import type { AnalysisDoc, MutationsResult, TableResult } from "../../../lib/types.ts";

export const maxDuration = 60;

/** Kinds whose rows are paged: their result is one page of a single order the view defines. */
const PAGED = new Set(["mutations", "table"]);
const PAGE_MAX = 1000;

/**
 * One page of a paged view (the mutation table, the clinical table): rows `offset` to
 * `offset + limit` of the view's one order. The page is the reader's (browser state, like scroll),
 * so it is not in the document: the view is run once more with RunOpts.page, adding no data path
 * of its own — a study that may not disclose patients contributes no rows here exactly as it
 * contributes none to the first page. Uncached: a page is cheap to recompute.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const doc: AnalysisDoc = body.doc, vi = Number(body.view);
    const view = doc && Array.isArray(doc.views) ? doc.views[vi] : null;
    if (!view || !PAGED.has(view.kind)) throw new Error("view " + body.view + " is not a paged view (" + [...PAGED].join(", ") + ")");
    const offset = Math.max(0, Math.floor(Number(body.offset) || 0)), limit = Math.floor(Number(body.limit) || 25);
    if (!(limit >= 1 && limit <= PAGE_MAX)) throw new Error("limit is 1 to " + PAGE_MAX);
    const r = await runAnalysis({ ...doc, views: [view] }, { page: { offset, limit } });
    const v = r.views[0] as { error?: string; mutations?: MutationsResult; table?: TableResult };
    const t = v.mutations || v.table;
    if (!t) throw new Error(v.error || "the view returned no rows");
    return Response.json({ rows: t.rows, total: t.total, offset });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
