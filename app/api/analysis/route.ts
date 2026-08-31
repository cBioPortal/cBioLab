import { runAnalysis } from "../../../lib/analysis.ts";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const doc = await req.json();
    return Response.json(await runAnalysis(doc));
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
