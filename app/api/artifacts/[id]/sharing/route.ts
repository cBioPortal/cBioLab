import { shareArtifact } from "../../../../../lib/artifacts.ts";
import { requirePrincipal, AccessError } from "../../../../../lib/auth.ts";

// Who a saved cohort or analysis is shared with (its owner only; lib/access.ts). Body:
// { visibility: "private" | "group" | "public", groupId?, groupCanEdit? }. For an analysis the answer
// also names the custom datasets it uses that its new audience cannot all read (`warnings`).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const r = await shareArtifact(requirePrincipal(req), id, await req.json().catch(() => null));
    if (!r) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(r);
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });
  }
}
