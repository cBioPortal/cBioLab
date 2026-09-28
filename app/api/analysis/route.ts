import { cachedAnalysis } from "../../../lib/next-cache.ts";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const doc = await req.json();
    // the web app draws its own oncoprints; ?oncoprint=spec skips rendering them here
    const mode = new URL(req.url).searchParams.get("oncoprint") === "spec" ? "spec" as const : "svg" as const;
    return Response.json(await cachedAnalysis(doc, { oncoprint: mode }));
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
