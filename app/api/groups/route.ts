import { requirePrincipal, AccessError } from "../../../lib/auth.ts";
import { listGroups, createGroup } from "../../../lib/groups.ts";

// The signed-in user's groups (lib/groups.ts): GET lists them, POST { name, description? } makes one,
// with its maker as admin.
const fail = (e: unknown) => Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });

export async function GET(req: Request) {
  try { return Response.json({ groups: await listGroups(requirePrincipal(req, "see your groups")) }); }
  catch (e) { return fail(e); }
}

export async function POST(req: Request) {
  try {
    const p = requirePrincipal(req, "make a group");
    const body = await req.json().catch(() => ({}));
    return Response.json({ group: await createGroup(p, body.name, body.description) }, { status: 201 });
  } catch (e) { return fail(e); }
}
