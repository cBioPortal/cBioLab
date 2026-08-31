import { runAnalysis } from "../../../lib/analysis.ts";

export const maxDuration = 60;

export async function POST(req) {
  try {
    const doc = await req.json();
    return Response.json(await runAnalysis(doc));
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 400 });
  }
}
