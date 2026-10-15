import { parseBody, CellExplorerRequest } from "../../../lib/api-schemas.ts";
import { withRequestCustomData } from "../../../lib/custom-data-server.ts";
import { cohortCellsLink, cohortFromCells } from "../../../lib/cell-explorer-server.ts";

export const maxDuration = 60;

// Cell Explorer, both ways: a cohort's cells as a link, or a Cell Explorer link (or donor ids)
// as a cohort. Both name patients, so both answer only from a patient-level instance.
export async function POST(req: Request) {
  try {
    const body = parseBody(CellExplorerRequest, await req.json());
    if (body.mode === "import") return Response.json(await cohortFromCells(body));
    const { customData, customRefs, doc, cohort } = body;
    return Response.json(await withRequestCustomData(customData, () => cohortCellsLink({ doc, cohort }), { refs: customRefs, req }));
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
