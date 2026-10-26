import { parseBody, AssayEntitiesRequest } from "../../../lib/api-schemas.ts";
import { chQuery, PRIMARY } from "../../../lib/ch";
import { studyRouting } from "../../../lib/federation";
import { peerForStudy } from "../../../lib/federation-remote.ts";
import { assayEntitySearchSql } from "../../../lib/generic-assay.ts";

// A generic-assay profile's entities found by name, for an axis's entity picker: reference data
// (signatures, arms, probes), never patient rows.
export async function POST(req: Request) {
  try {
    const body = parseBody(AssayEntitiesRequest, await req.json());
    if (await peerForStudy(body.study)) return Response.json({ entities: [], total: 0, note: "a peer's generic assays are not searchable here" });
    const conn = (await studyRouting()).get(body.study);
    if (!conn) return Response.json({ error: "Study '" + body.study + "' not found" }, { status: 400 });
    const r = await chQuery<{ entity: string; name: string; gene: string; total: string }>(
      assayEntitySearchSql(body.study, conn.db || PRIMARY.db, body.profile, body.q || ""), conn);
    return Response.json({
      entities: r.data.map((x) => ({ entity: x.entity, ...(x.name && x.name !== x.entity ? { name: x.name } : {}), ...(x.gene ? { gene: x.gene } : {}) })),
      total: r.data.length ? Number(r.data[0].total) : 0,
    });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
