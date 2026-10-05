import { runAnalysis } from "../../../lib/analysis.ts";
import { withRequestCustomData } from "../../../lib/custom-data-server.ts";
import type { AnalysisDoc, MutationsResult, TableResult } from "../../../lib/types.ts";

export const maxDuration = 60;

/** Table views: their rows are paged, searched, filtered and sorted by lib/table-query.ts. */
const PAGED = new Set(["mutations", "table"]);
const PAGE_MAX = 1000;

/**
 * One page of a table view — rows `offset` to `offset + limit` of the view's one order, as its
 * search, filters and sort keep and order them — or, with `values: <column id>`, the values that
 * column takes among the rows the rest of the query keeps (what its filter offers). The page is the
 * reader's (browser state, like scroll), so it is not in the document: the view is run once more
 * with RunOpts.page / RunOpts.values, adding no data path of its own — a study that may not
 * disclose patients contributes nothing here exactly as it contributes nothing to the first page.
 * Uncached: a page is cheap to recompute.
 */
export async function POST(req: Request) {
  try {
    const { customData, customRefs, ...body } = await req.json();
    const doc: AnalysisDoc = body.doc, vi = Number(body.view);
    const view = doc && Array.isArray(doc.views) ? doc.views[vi] : null;
    if (!view || !PAGED.has(view.kind)) throw new Error("view " + body.view + " is not a table view (" + [...PAGED].join(", ") + ")");
    const one = { ...doc, views: [view] };
    const run = (opts: Parameters<typeof runAnalysis>[1]) => withRequestCustomData(customData, () => runAnalysis(one, opts), { refs: customRefs, req });
    const pick = (r: Awaited<ReturnType<typeof runAnalysis>>) => {
      const v = r.views[0] as { error?: string; mutations?: MutationsResult; table?: TableResult };
      const t = v.mutations || v.table;
      if (!t) throw new Error(v.error || "the view returned no rows");
      return t;
    };
    if (body.values != null) {
      const t = pick(await run({ values: String(body.values) }));
      return Response.json({ values: t.values });
    }
    const offset = Math.max(0, Math.floor(Number(body.offset) || 0)), limit = Math.floor(Number(body.limit) || 25);
    if (!(limit >= 1 && limit <= PAGE_MAX)) throw new Error("limit is 1 to " + PAGE_MAX);
    const t = pick(await run({ page: { offset, limit } }));
    return Response.json({ rows: t.rows, total: t.total, offset });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
