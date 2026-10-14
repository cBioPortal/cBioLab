// GET /provenance/figure?spec=<base64url OncoprintSpec> — the provenance page's oncoprint as an
// image of its own, so the page carries it once (an <img>) rather than as markup in both its HTML
// and its server-component payload. Built through the contract cache.
import { cachedContract } from "../../../lib/next-cache.ts";
import { contractToSvg } from "../../../lib/oncoprint-svg.ts";

export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const raw = new URL(req.url).searchParams.get("spec");
    if (!raw) throw new Error("missing ?spec= parameter (base64url-encoded OncoprintSpec)");
    const spec = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const svg = contractToSvg(await cachedContract(spec), 1200);
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8" } });
  } catch (e) {
    return new Response(String((e as Error)?.message || e), { status: 400 });
  }
}
