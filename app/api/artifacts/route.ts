import { listArtifacts, createArtifact, isArtifactKind, type ArtifactKind } from "../../../lib/artifacts.ts";
import { requirePrincipal, AccessError } from "../../../lib/auth.ts";

// Saved cohorts and analyses: only for a logged-in reader (lib/auth.ts), who sees their own.

const fail = (e: unknown, status: number) =>
  Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : status });

export async function GET(req: Request) {
  try {
    const principal = requirePrincipal(req);
    const raw = new URL(req.url).searchParams.get("kind");
    if (raw !== null && !isArtifactKind(raw)) return Response.json({ error: "kind must be 'cohort' or 'workspace'" }, { status: 400 });
    const kind: ArtifactKind | undefined = raw === null ? undefined : raw;
    const artifacts = await listArtifacts(principal, kind);
    return Response.json({ artifacts });
  } catch (e) { return fail(e, 500); }
}

export async function POST(req: Request) {
  try {
    const principal = requirePrincipal(req);
    const body = await req.json();
    const artifact = await createArtifact(principal, body.kind, body.name, body.definition);
    return Response.json({ artifact }, { status: 201 });
  } catch (e) { return fail(e, 400); }
}
