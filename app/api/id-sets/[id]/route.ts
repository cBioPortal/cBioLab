import { requirePrincipal, AccessError } from "../../../../lib/auth.ts";
import { getIdSet, readIdSet, deleteIdSet } from "../../../../lib/id-set-store.ts";

const fail = (e: unknown) => Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });

/** One set's description; with `?ids=1`, its ids too, one "<study>:<id>" per line (that read is logged). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const principal = requirePrincipal(req, "use stored id sets");
    if (new URL(req.url).searchParams.get("ids") !== "1") return Response.json({ set: await getIdSet(principal, id) });
    const { perStudy } = await readIdSet(principal, id);
    const text = Object.entries(perStudy).flatMap(([study, ids]) => ids.map((x) => study + ":" + x)).join("\n") + "\n";
    return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
  } catch (e) { return fail(e); }
}

/** Delete (its owner only): documents naming it are refused from then on, saying when it went. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteIdSet(requirePrincipal(req, "use stored id sets"), id);
    return Response.json({ deleted: true });
  } catch (e) { return fail(e); }
}
