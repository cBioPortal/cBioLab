import { requirePrincipal, AccessError } from "../../../../../lib/auth.ts";
import { shareIdSet } from "../../../../../lib/id-set-store.ts";

// Who a stored id set is shared with (its owner only; lib/access.ts). Body as for
// /api/artifacts/[id]/sharing. Its ids are patient-level: nothing shares them but this.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return Response.json({ set: await shareIdSet(requirePrincipal(req, "use stored id sets"), id, await req.json().catch(() => null)) });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });
  }
}
