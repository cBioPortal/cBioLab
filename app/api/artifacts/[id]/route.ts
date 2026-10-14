import { getArtifact, updateArtifact, deleteArtifact } from "../../../../lib/artifacts.ts";
import { requirePrincipal, AccessError } from "../../../../lib/auth.ts";

const fail = (e: unknown, status: number) =>
  Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : status });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badId() { return Response.json({ error: "not a valid artifact id" }, { status: 400 }); }

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return badId();
  try {
    const artifact = await getArtifact(requirePrincipal(req), id);
    if (!artifact) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ artifact });
  } catch (e) {
    return fail(e, 500);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return badId();
  try {
    const body = await req.json();
    // `version`: the one this change was made from; a stale one is refused (409), not merged
    const artifact = await updateArtifact(requirePrincipal(req), id, { name: body.name, definition: body.definition, version: body.version });
    if (!artifact) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ artifact });
  } catch (e) {
    return fail(e, 400);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return badId();
  try {
    const ok = await deleteArtifact(requirePrincipal(req), id);
    if (!ok) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e, 500);
  }
}
