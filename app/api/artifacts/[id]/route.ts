import { getArtifact, updateArtifact, deleteArtifact } from "../../../../lib/artifacts.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badId() { return Response.json({ error: "not a valid artifact id" }, { status: 400 }); }

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return badId();
  try {
    const artifact = await getArtifact(id);
    if (!artifact) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ artifact });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return badId();
  try {
    const body = await req.json();
    const artifact = await updateArtifact(id, { name: body.name, definition: body.definition });
    if (!artifact) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ artifact });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return badId();
  try {
    const ok = await deleteArtifact(id);
    if (!ok) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
