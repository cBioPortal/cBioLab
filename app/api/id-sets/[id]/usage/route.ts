import { connection } from "next/server";
import { requirePrincipal, AccessError } from "../../../../../lib/auth.ts";
import { idSetUsage } from "../../../../../lib/id-set-store.ts";

/** How many saved cohorts, analyses and stored links name this set (its owner only), before withdrawing it. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await params;
    return Response.json({ usage: await idSetUsage(requirePrincipal(req, "use stored id sets"), id) });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });
  }
}
