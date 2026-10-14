import { parseBody, AnalysisRequest } from "../../../lib/api-schemas.ts";
import type { AnalysisDoc } from "../../../lib/types.ts";
import { cachedAnalysis } from "../../../lib/next-cache.ts";
import { withRequestCustomData } from "../../../lib/custom-data-server.ts";
import { viewToSvg } from "../../../lib/view-svg.ts";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    // `customData` rides beside the document, never inside it: a shared ?doc= link must not
    // carry patient-level values (lib/custom-data.ts)
    const { customData, customRefs, ...doc } = parseBody(AnalysisRequest, await req.json());
    const url = new URL(req.url);
    // the web app draws its own oncoprints; ?oncoprint=spec skips rendering them here
    const mode = url.searchParams.get("oncoprint") === "spec" ? "spec" as const : "svg" as const;
    const result = await withRequestCustomData(customData, () => cachedAnalysis(doc as unknown as AnalysisDoc, { oncoprint: mode }), { refs: customRefs, req });
    // ?figures=svg: every view drawn by the shared server renderer (the portal pages show these)
    if (url.searchParams.get("figures") === "svg")
      return Response.json({ ...result, views: result.views.map((v) => v.svg || v.error ? v : { ...v, svg: viewToSvg(v) || undefined }) });
    // the web app draws every other figure itself, at its card's width (app/lab/figure.tsx): a
    // figure drawn here as well would travel unused
    if (mode === "spec") return Response.json({ ...result, views: result.views.map(({ svg: _svg, ...v }) => v) });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
