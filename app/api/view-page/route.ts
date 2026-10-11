import { parseBody, ViewPageRequest } from "../../../lib/api-schemas.ts";
import { runAnalysis } from "../../../lib/analysis.ts";
import { withRequestCustomData } from "../../../lib/custom-data-server.ts";
import { PAGED_KINDS, pagedTable } from "../../../lib/views/rows.ts";
import type { AnalysisDoc } from "../../../lib/types.ts";

export const maxDuration = 60;

/**
 * One page of a table view — rows `offset` to `offset + limit` of the view's one order, as its
 * search, filters and sort keep and order them — or, with `values: <column id>`, the values that
 * column takes among the rows the rest of the query keeps (what its filter offers). A view holding
 * several tables (the alterations view) names one with `table`. The page is the
 * reader's (browser state, like scroll), so it is not in the document: the view is run once more
 * with RunOpts.page / RunOpts.values, adding no data path of its own — a study that may not
 * disclose patients contributes nothing here exactly as it contributes nothing to the first page.
 * Uncached: a page is cheap to recompute.
 */
export async function POST(req: Request) {
  try {
    const { customData, customRefs, ...body } = parseBody(ViewPageRequest, await req.json());
    const doc = body.doc as unknown as AnalysisDoc, vi = body.view;
    const view = Array.isArray(doc.views) ? doc.views[vi] : null;
    if (!view || !PAGED_KINDS.includes(view.kind)) throw new Error("view " + body.view + " is not a table view (" + PAGED_KINDS.join(", ") + ")");
    const one = { ...doc, views: [view] };
    const run = (opts: Parameters<typeof runAnalysis>[1]) => withRequestCustomData(customData, () => runAnalysis(one, opts), { refs: customRefs, req });
    const pick = (r: Awaited<ReturnType<typeof runAnalysis>>) => {
      const v = r.views[0];
      const t = pagedTable(v, body.table);
      if (!t) throw new Error(v.error || "the view returned no rows");
      return t;
    };
    if (body.values != null) {
      const t = pick(await run({ values: String(body.values), table: body.table }));
      return Response.json({ values: t.values });
    }
    const { offset, limit } = body;
    const t = pick(await run({ page: { offset, limit }, table: body.table }));
    return Response.json({ rows: t.rows, total: t.total, offset });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
