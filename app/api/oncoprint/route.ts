import { buildContract } from "../../../lib/oncoprint";
import { packContract } from "../../../lib/oncoprint-binary";

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
      const body = packContract(contract);
      return new Response(body.buffer as ArrayBuffer, { headers: {
        "Content-Type": "application/octet-stream",
        "X-Engine-Ms": String(engineMs), "X-Pack-Ms": String(Date.now() - tp), "X-Columns": String(contract.columns.length)
      } });
    }
    return Response.json(contract);
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
