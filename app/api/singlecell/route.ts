import { parseBody, SingleCellRequest } from "../../../lib/api-schemas.ts";
import { cellExplorerCatalog, crosswalk, referenceCounts } from "../../../lib/singlecell-server.ts";

export const maxDuration = 60;

// The single-cell review page's server questions (lib/singlecell-server.ts). The crosswalk and the
// reference counts name a study's patients and samples, so they answer from a patient-level instance only.
export async function POST(req: Request) {
  try {
    const body = parseBody(SingleCellRequest, await req.json());
    if (body.mode === "catalog") return Response.json({ datasets: await cellExplorerCatalog() });
    if (body.mode === "reference") return Response.json(await referenceCounts(body.study));
    return Response.json(await crosswalk(body.study, body.level, body.values, body.attribute));
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
