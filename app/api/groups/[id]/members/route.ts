import { requirePrincipal, AccessError } from "../../../../../lib/auth.ts";
import { addMember } from "../../../../../lib/groups.ts";

// Add someone to a group by email, signed in yet or not (admins): POST { email, role? }.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const p = requirePrincipal(req, "change a group");
    const body = await req.json().catch(() => ({}));
    return Response.json({ group: await addMember(p, (await params).id, body.email, body.role ?? "member") });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });
  }
}
