import { proposePartition } from "../../../lib/analysis.ts";
import { withRequestCustomData } from "../../../lib/custom-data-server.ts";

export const maxDuration = 60;

// Proposes a partition's arms from the data ("split this cohort by X"); the caller puts the
// returned definition into its document and runs it like any other edit.
export async function POST(req: Request) {
  try {
    const { customData, customRefs, ...body } = await req.json();
    return Response.json(await withRequestCustomData(customData, () => proposePartition(body), { refs: customRefs, req }));
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
