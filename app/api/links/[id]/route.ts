import { connection } from "next/server";
import { AccessError } from "../../../../lib/auth.ts";
import { readLink } from "../../../../lib/link-store.ts";

// A stored link's parameters (lib/link-store.ts). Its id is the hash of what it holds, so the
// answer never changes and may be cached for good; a missing one is not cached.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await params;
    return Response.json({ id, params: await readLink(id) }, { headers: { "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400, headers: { "Cache-Control": "no-store" } });
  }
}
