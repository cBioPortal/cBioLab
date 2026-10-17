import { parseBody, PartitionRequest } from "../../../lib/api-schemas.ts";
import { proposePartition } from "../../../lib/analysis.ts";
import { withRequestCustomData } from "../../../lib/custom-data-server.ts";

export const maxDuration = 60;

// Proposes a partition's arms from the data ("split this cohort by X"); the caller puts the
// returned definition into its document and runs it like any other edit.
export async function POST(req: Request) {
  try {
    const { customData, customRefs, ...body } = parseBody(PartitionRequest, await req.json());
    return Response.json(await withRequestCustomData(customData, () => proposePartition(body as unknown as Parameters<typeof proposePartition>[0]), { refs: customRefs, req, uses: body }));
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
