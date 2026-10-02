import { cachedAnalysis } from "../../../lib/next-cache.ts";
import { withRequestCustomData } from "../../../lib/custom-data-server.ts";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    // `customData` rides beside the document, never inside it: a shared ?doc= link must not
    // carry patient-level values (lib/custom-data.ts)
    const { customData, customRefs, ...doc } = await req.json();
    // the web app draws its own oncoprints; ?oncoprint=spec skips rendering them here
    const mode = new URL(req.url).searchParams.get("oncoprint") === "spec" ? "spec" as const : "svg" as const;
    return Response.json(await withRequestCustomData(customData, () => cachedAnalysis(doc, { oncoprint: mode }), { refs: customRefs, req }));
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
