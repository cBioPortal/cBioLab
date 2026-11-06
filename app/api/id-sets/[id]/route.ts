import { connection } from "next/server";
import { principalFor, AccessError } from "../../../../lib/auth.ts";
import { getIdSet, readIdSet, WithdrawnIdSetError } from "../../../../lib/id-set-store.ts";

// One stored id set, for anyone with its id (lib/id-set-store.ts): reading needs no sign-in, as
// opening the link that names it needs none. Withdrawing and restoring it are its owner's
// (./withdrawal); what uses it, too (./usage).

const fail = (e: unknown) => Response.json({ error: String((e as Error)?.message || e), ...(e instanceof WithdrawnIdSetError ? { withdrawal: e.withdrawal } : {}) },
  { status: e instanceof AccessError ? e.status : 400 });

/** One set's description; with `?ids=1`, its ids too, one "<study>:<id>" per line (that read is logged, and refused once it is withdrawn). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await params;
    const principal = principalFor(req);
    if (new URL(req.url).searchParams.get("ids") !== "1") return Response.json({ set: await getIdSet(principal, id) });
    const { perStudy } = await readIdSet(principal, id);
    const text = Object.entries(perStudy).flatMap(([study, ids]) => ids.map((x) => study + ":" + x)).join("\n") + "\n";
    return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
  } catch (e) { return fail(e); }
}
