import { resolveCaseIds } from "../../../../lib/custom-data-server.ts";

export const maxDuration = 30;

/**
 * Match the case ids of an upload to the studies' patients or samples, before it is saved.
 * The browser keeps the result; nothing about the upload is stored here.
 */
export async function POST(req: Request) {
  try {
    const { studies, level, ids } = await req.json();
    if (!Array.isArray(studies) || !Array.isArray(ids)) throw new Error("studies and ids must be arrays");
    if (level !== "patient" && level !== "sample") throw new Error("level must be 'patient' or 'sample'");
    return Response.json(await resolveCaseIds(studies.map(String), level, ids.map(String)));
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
