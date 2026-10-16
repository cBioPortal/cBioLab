import { parseBody, GenesRequest } from "../../../lib/api-schemas.ts";
import { checkGenes, searchGenes, geneSetMembers } from "../../../lib/genes.ts";

// The gene catalog behind the gene query dialog (lib/genes.ts): reference data, no patient rows.
export async function POST(req: Request) {
  try {
    const body = parseBody(GenesRequest, await req.json());
    if (body.geneset) return Response.json({ members: await geneSetMembers(body.geneset) });
    if (body.search != null) return Response.json(await searchGenes(body.search));
    return Response.json({ checks: await checkGenes(body.symbols || []) });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
