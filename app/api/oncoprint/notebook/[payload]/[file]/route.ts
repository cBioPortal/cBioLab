// GET /api/oncoprint/notebook/<payload>/oncoprint.ipynb — the figure as a Jupyter notebook.
//
// Everything the request carries is in the PATH, and the last segment is the file name, because
// JupyterLite's open-from-URL uploads the fetched file as basename(url) — query string included.
// A file named `oncoprint.ipynb?spec=…` is not a notebook to JupyterLab: it opens in the text
// editor as a page of JSON. The payload is base64url `{spec, cut?}`.
//
// The response is self-contained (package and contract embedded, see lib/notebook.ts) and is sent
// with an open CORS header, because the point is for a notebook host on another origin —
// jupyter.org's JupyterLite, say — to fetch it in the reader's browser. Nothing here reads a
// request body, a cookie or a header: the spec is in the URL and the answer is the same for
// anyone who sends it, exactly like /api/oncoprint, which is already open to anyone who can POST.
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildContract } from "../../../../../../lib/oncoprint.ts";
import { assembleContract } from "../../../../../../lib/oncoprint-assemble.ts";
import { localInput, parseTsv } from "../../../../../../lib/oncoprint-local.ts";
import { packContract } from "../../../../../../lib/oncoprint-binary.ts";
import { decodeSpec, isLocalSpec } from "../../../../../../lib/lab-links.ts";
import { oncoprintNotebook, notebookStats } from "../../../../../../lib/notebook.ts";
import type { Contract } from "../../../../../../lib/types.ts";

export const maxDuration = 120;

// Chrome's Private Network Access blocks a public page (jupyter.org) from fetching a server on a
// private/tailnet/local address unless the preflight explicitly allows it — without this header,
// JupyterLite's fetch is silently refused ("Permission was denied for this request") and the
// reader gets JupyterLite's own default starter notebook instead of any error naming this route.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Private-Network": "true" };

let packed: string | null = null;
/** the package as committed — every .py plus the generated style.json — gzipped once per process */
function packageB64(): string {
  if (packed) return packed;
  const dir = join(process.cwd(), "python", "cohortlab");
  const files: Record<string, string> = {};
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".py") || f === "style.json") files["cohortlab/" + f] = readFileSync(join(dir, f), "utf8");
  }
  packed = gzipSync(Buffer.from(JSON.stringify(files), "utf8"), { level: 9 }).toString("base64");
  return packed;
}

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function GET(req: Request, ctx: { params: Promise<{ payload: string; file: string }> }) {
  const { payload, file } = await ctx.params;
  try {
    const url = new URL(req.url);
    const carried = decodeSpec(payload) as { spec?: Record<string, unknown>; cut?: string };
    const spec = (carried && typeof carried === "object" && carried.spec ? carried.spec : carried) as Record<string, unknown>;
    if (!spec || typeof spec !== "object") throw new Error("the path must carry a base64url {spec, cut?} object");
    const contract: Contract = isLocalSpec(spec)
      ? assembleContract(localInput({
          events: parseTsv(String(spec.events)),
          clinical: spec.clinical ? parseTsv(String(spec.clinical)) : undefined,
          coverage: spec.coverage ? parseTsv(String(spec.coverage)) : undefined,
          genes: Array.isArray(spec.genes) && spec.genes.length ? (spec.genes as string[]) : undefined,
          groupBy: spec.groupBy ? String(spec.groupBy) : undefined,
          sort: spec.sort as string[] | undefined, study: spec.study ? String(spec.study) : "pasted data",
          unit: spec.unit === "sample" ? "sample" : undefined, display: spec.display as never
        }))
      : await buildContract(spec as never);
    const bytes = packContract(contract);
    const nb = oncoprintNotebook({
      spec,
      contractB64: gzipSync(bytes, { level: 9 }).toString("base64"),
      packageB64: packageB64(),
      stats: notebookStats(contract),
      origin: process.env.APP_BASE_URL || url.origin,
      cut: carried?.cut || url.searchParams.get("cut") || undefined
    });
    const name = /\.ipynb$/.test(file) ? file : "oncoprint.ipynb";
    return new Response(JSON.stringify(nb), {
      headers: { ...CORS, "Content-Type": "application/x-ipynb+json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` }
    });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400, headers: CORS });
  }
}
