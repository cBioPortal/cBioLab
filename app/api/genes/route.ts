import { parseBody, GenesRequest } from "../../../lib/api-schemas.ts";
import { checkGenes, searchGenes, geneSetMembers, panelGenes } from "../../../lib/genes.ts";
import { studyRouting } from "../../../lib/federation.ts";
import { peerForStudy } from "../../../lib/federation-remote.ts";

// The gene catalog behind the gene query dialog (lib/genes.ts) and a gene panel's genes: reference
// data, no patient rows.
export async function POST(req: Request) {
  try {
    const body = parseBody(GenesRequest, await req.json());
    if (body.panel) {
      if (await peerForStudy(body.panel.study))
        throw new Error(body.panel.study + " is held by a federation peer; its gene panels' genes are not read from here");
      const conn = (await studyRouting()).get(body.panel.study);
      if (!conn) throw new Error("no database here holds " + body.panel.study);
      return Response.json({ genes: await panelGenes(body.panel.id, conn) });
    }
    if (body.geneset) return Response.json({ members: await geneSetMembers(body.geneset) });
    if (body.search != null) return Response.json(await searchGenes(body.search));
    return Response.json({ checks: await checkGenes(body.symbols || []) });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
