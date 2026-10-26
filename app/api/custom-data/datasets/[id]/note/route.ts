import { requirePrincipal, AccessError } from "../../../../../../lib/auth.ts";
import { setDatasetNote } from "../../../../../../lib/custom-store.ts";

// A custom dataset's note, `{ note }` (whoever may add versions to it). Saves no version.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null) as { note?: unknown } | null;
    return Response.json({ dataset: await setDatasetNote(requirePrincipal(req), id, body?.note) });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });
  }
}
