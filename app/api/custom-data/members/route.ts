import { cohortMembership, withRequestCustomData } from "../../../../lib/custom-data-server.ts";

export const maxDuration = 60;

/**
 * The patients in a cohort and the rest of each study, for "save as feature": the browser
 * freezes them into a yes/no custom dataset. The cohort may itself use custom data.
 */
export async function POST(req: Request) {
  try {
    const { customData, def, studies } = await req.json();
    if (!def || typeof def !== "object" || !Array.isArray(studies)) throw new Error("def (a cohort definition) and studies are required");
    return Response.json({ studies: await withRequestCustomData(customData, () => cohortMembership(def, studies.map(String))) });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
