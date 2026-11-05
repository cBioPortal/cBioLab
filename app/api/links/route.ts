import { principalFor } from "../../../lib/auth.ts";
import { saveLink } from "../../../lib/link-store.ts";

// Store a page's long URL parameters under a short id (lib/link-store.ts, docs/LINKS.md):
// `{ params: {name: value} }` → `{ id }`. No sign-in: a stored link carries no more than the
// ?doc= link it stands for. Storing the same parameters again answers the same id.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { params?: unknown } | null;
    return Response.json(await saveLink(principalFor(req), body?.params), { status: 201 });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
