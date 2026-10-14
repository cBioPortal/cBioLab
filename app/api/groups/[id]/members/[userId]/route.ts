import { requirePrincipal, AccessError } from "../../../../../../lib/auth.ts";
import { setRole, removeMember, getGroup } from "../../../../../../lib/groups.ts";

// One member of a group: PATCH { role } (admins), DELETE removes them (admins) or leaves (yourself).
const fail = (e: unknown) => Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });
type Ctx = { params: Promise<{ id: string; userId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const p = requirePrincipal(req, "change a group");
    const { id, userId } = await params;
    const body = await req.json().catch(() => ({}));
    return Response.json({ group: await setRole(p, id, userId, body.role) });
  } catch (e) { return fail(e); }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const p = requirePrincipal(req, "change a group");
    const { id, userId } = await params;
    await removeMember(p, id, userId);
    // after leaving, the group is no longer yours to see
    return Response.json({ group: userId === p ? null : await getGroup(p, id) });
  } catch (e) { return fail(e); }
}
