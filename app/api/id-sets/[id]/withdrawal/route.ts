import { requirePrincipal, AccessError } from "../../../../../lib/auth.ts";
import { withdrawIdSet, restoreIdSet } from "../../../../../lib/id-set-store.ts";

// A stored id set's withdrawal (its owner only; lib/id-set-store.ts, docs/LINKS.md).
//   PUT    { note?, replacedBy? }  withdraw it, or change the note and replacement of a withdrawn one
//   DELETE                        restore it: documents naming it read it again

const fail = (e: unknown) => Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { note?: unknown; replacedBy?: unknown } | null;
    return Response.json({ set: await withdrawIdSet(requirePrincipal(req, "withdraw stored id sets"), id, { note: body?.note, replacedBy: body?.replacedBy }) });
  } catch (e) { return fail(e); }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return Response.json({ set: await restoreIdSet(requirePrincipal(req, "restore stored id sets"), id) });
  } catch (e) { return fail(e); }
}
