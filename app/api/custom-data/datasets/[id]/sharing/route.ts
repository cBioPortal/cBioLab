import { requirePrincipal, AccessError } from "../../../../../../lib/auth.ts";
import { shareDataset } from "../../../../../../lib/custom-store.ts";

// Who a custom dataset is shared with (its owner only; lib/access.ts). Body as for
// /api/artifacts/[id]/sharing. The rows are patient-level: nothing shares them but this.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return Response.json({ dataset: await shareDataset(requirePrincipal(req), id, await req.json().catch(() => null)) });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });
  }
}
