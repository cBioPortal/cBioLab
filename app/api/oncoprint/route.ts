import type { OncoprintSpec } from "../../../lib/types.ts";
import { parseBody, OncoprintRequest } from "../../../lib/api-schemas.ts";
import { buildContract } from "../../../lib/oncoprint";
import { cachedContract } from "../../../lib/next-cache.ts";
import { withRequestCustomData } from "../../../lib/custom-data-server.ts";
import { packContract } from "../../../lib/oncoprint-binary";
import { gzipSync } from "node:zlib";
import { contractToSvg } from "../../../lib/oncoprint-svg";
import { contractToTsv } from "../../../lib/oncoprint-tabular";

export const maxDuration = 120;

// POST /api/oncoprint            -> contract as JSON
// POST /api/oncoprint?format=bin -> contract as OPB1 binary (cells as typed arrays)
export async function POST(req: Request) {
  try {
    const { customData, customRefs, ...envelope } = parseBody(OncoprintRequest, await req.json());
    const spec = envelope as unknown as OncoprintSpec;   // its contents are the engine's to check
    const t0 = Date.now();
    const sp = new URL(req.url).searchParams;
    const log: { label: string; sql: string; ms?: number; study?: string }[] = [];
    const provenance = sp.get("provenance") === "1";
    // a provenance request wants the queries this run issues, so it is never answered from the cache
    const contract = await withRequestCustomData(customData, () =>
      provenance ? buildContract(spec, { log, provenance }) : cachedContract(spec), { refs: customRefs, req });
    const engineMs = Date.now() - t0;
    const fmt = sp.get("format");
    if (fmt === "svg" || fmt === "tsv") {
      // the page asks for these to download; the spec it sends carries its sort and display,
      // so the file is the figure on screen and not a differently-ordered one
      const widthIn = Number(sp.get("widthIn")) || undefined;
      const body = fmt === "svg" ? contractToSvg(contract, Number(sp.get("width")) || 1600, undefined, widthIn) : contractToTsv(contract);
      return new Response(body, { headers: {
        "Content-Type": fmt === "svg" ? "image/svg+xml" : "text/tab-separated-values",
        "X-Engine-Ms": String(engineMs)
      } });
    }
    if (fmt === "bin") {
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
