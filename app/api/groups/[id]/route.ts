import { requirePrincipal, AccessError } from "../../../../lib/auth.ts";
import { getGroup, updateGroup, deleteGroup } from "../../../../lib/groups.ts";

// One group (members only see it): GET with its members, PATCH { name?, description? } and DELETE
// (admins). Deleting a group makes what was shared with it private again.
const fail = (e: unknown) => Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try { return Response.json({ group: await getGroup(requirePrincipal(req, "see a group"), (await params).id) }); }
  catch (e) { return fail(e); }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const p = requirePrincipal(req, "change a group");
    const body = await req.json().catch(() => ({}));
    return Response.json({ group: await updateGroup(p, (await params).id, { name: body.name, description: body.description }) });
  } catch (e) { return fail(e); }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    await deleteGroup(requirePrincipal(req, "delete a group"), (await params).id);
    return Response.json({ deleted: true });
  } catch (e) { return fail(e); }
}
