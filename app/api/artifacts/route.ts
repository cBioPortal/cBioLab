import { listArtifacts, createArtifact, isArtifactKind, type ArtifactKind } from "../../../lib/artifacts.ts";

export async function GET(req: Request) {
  try {
    const raw = new URL(req.url).searchParams.get("kind");
    if (raw !== null && !isArtifactKind(raw)) return Response.json({ error: "kind must be 'cohort' or 'workspace'" }, { status: 400 });
    const kind: ArtifactKind | undefined = raw === null ? undefined : raw;
    const artifacts = await listArtifacts(kind);
    return Response.json({ artifacts });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const artifact = await createArtifact(body.kind, body.name, body.definition);
    return Response.json({ artifact }, { status: 201 });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
