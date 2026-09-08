import { assembleContract } from "../../../../lib/oncoprint-assemble";
import { localInput, parseTsv } from "../../../../lib/oncoprint-local";
import { packContract } from "../../../../lib/oncoprint-binary";
import { contractToSvg } from "../../../../lib/oncoprint-svg";
import { contractToTsv } from "../../../../lib/oncoprint-tabular";

export const maxDuration = 30;

/**
 * The Oncoprinter path: tables in, contract out, no database touched. Same body as the CLI's
 * local mode — events/clinical/coverage as tab-separated text — and the same output formats as
 * /api/oncoprint, so the interactive figure can draw pasted data exactly as it draws a cohort.
 */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    if (typeof b?.events !== "string" || !b.events.trim()) throw new Error("events is required: a tab-separated table with patient, gene and type columns");
    const contract = assembleContract(localInput({
      events: parseTsv(b.events),
      clinical: b.clinical ? parseTsv(String(b.clinical)) : undefined,
      coverage: b.coverage ? parseTsv(String(b.coverage)) : undefined,
      genes: Array.isArray(b.genes) && b.genes.length ? b.genes.map(String) : undefined,
      groupBy: b.groupBy ? String(b.groupBy) : undefined,
      sort: b.sort, study: b.study ? String(b.study) : "pasted data",
      unit: b.unit === "sample" ? "sample" : undefined,
      display: b.display
    }));
    const sp = new URL(req.url).searchParams;
    const fmt = sp.get("format");
    if (fmt === "svg") return new Response(contractToSvg(contract, Number(sp.get("width")) || 1600), { headers: { "Content-Type": "image/svg+xml" } });
    if (fmt === "tsv") return new Response(contractToTsv(contract), { headers: { "Content-Type": "text/tab-separated-values" } });
    if (fmt === "bin") {
      const raw = packContract(contract);
      return new Response(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
        { headers: { "Content-Type": "application/octet-stream", "X-Columns": String(contract.columns.length) } });
    }
    return Response.json(contract);
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
