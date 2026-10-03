import { requirePrincipal, AccessError } from "../../../../../lib/auth.ts";
import { readVersion, deleteDataset } from "../../../../../lib/custom-store.ts";

export const maxDuration = 60;

const fail = (e: unknown) => Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });

/**
 * One version's rows, as stored: gzipped JSON, which the browser unpacks. Its metadata rides in
 * the X-Custom-Dataset header. `?version=n` pins a version; without it, the latest.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const v = new URL(req.url).searchParams.get("version");
    const version = v == null ? undefined : Number(v);
    if (version !== undefined && !(Number.isInteger(version) && version > 0)) throw new Error("version must be a positive whole number");
    const r = await readVersion(requirePrincipal(req), id, version);
    return new Response(new Uint8Array(r.rowsGz), { headers: {
      "Content-Type": "application/gzip",
      "Cache-Control": "private, no-store",
      "X-Custom-Dataset": encodeURIComponent(JSON.stringify({ ...r.meta, version: r.version }))
    } });
  } catch (e) { return fail(e); }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteDataset(requirePrincipal(req), id);
    return Response.json({ deleted: true });
  } catch (e) { return fail(e); }
}
