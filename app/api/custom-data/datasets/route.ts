import { gunzipSync } from "node:zlib";
import { requirePrincipal, AccessError } from "../../../../lib/custom-access.ts";
import { listDatasets, saveDataset } from "../../../../lib/custom-store.ts";

export const maxDuration = 60;

const fail = (e: unknown) => Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });

/** The server datasets this browser may read, without their rows. */
export async function GET(req: Request) {
  try { return Response.json({ datasets: await listDatasets(requirePrincipal(req)) }); }
  catch (e) { return fail(e); }
}

/**
 * Save an upload: `{ dataset, source, versionOf? }`. The browser gzips the body (a function's
 * request is capped at 4.5 MB on Vercel, and a 10k x 50 upload is ~20 MB as JSON).
 */
export async function POST(req: Request) {
  try {
    const principal = requirePrincipal(req);
    const raw = Buffer.from(await req.arrayBuffer());
    const text = (req.headers.get("content-type") || "").includes("gzip") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
    const { dataset, source, versionOf } = JSON.parse(text);
    return Response.json({ dataset: await saveDataset(principal, dataset, source, versionOf ? String(versionOf) : undefined) }, { status: 201 });
  } catch (e) { return fail(e); }
}
