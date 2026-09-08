import { buildContract } from "../../../lib/oncoprint";
import { packContract } from "../../../lib/oncoprint-binary";
import { gzipSync } from "node:zlib";

export const maxDuration = 120;

// POST /api/oncoprint            -> contract as JSON
// POST /api/oncoprint?format=bin -> contract as OPB1 binary (cells as typed arrays)
export async function POST(req: Request) {
  try {
    const spec = await req.json();
    const t0 = Date.now();
    const sp = new URL(req.url).searchParams;
    const log: { label: string; sql: string; ms?: number; study?: string }[] = [];
    const provenance = sp.get("provenance") === "1";
    const contract = await buildContract(spec, provenance ? { log, provenance } : {});
    const engineMs = Date.now() - t0;
    if (sp.get("format") === "bin") {
      const tp = Date.now();
      const raw = packContract(contract);
      // Half the payload is patient ids, which compress ~5x; cells compress little. Next does
      // not compress octet-stream, so do it here when the client will take it.
      const wants = /\bgzip\b/.test(req.headers.get("accept-encoding") || "");
      const body = wants && raw.byteLength > 65536 ? gzipSync(raw, { level: 5 }) : raw;
      const packMs = Date.now() - tp;
      return new Response(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, { headers: {
        "Content-Type": "application/octet-stream",
        ...(body === raw ? {} : { "Content-Encoding": "gzip" }),
        "X-Engine-Ms": String(engineMs), "X-Pack-Ms": String(packMs),
        "X-Raw-Bytes": String(raw.byteLength), "X-Columns": String(contract.columns.length)
      } });
    }
    return Response.json(contract);
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
