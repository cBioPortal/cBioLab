import { connection } from "next/server";
import { withoutFailedQueries } from "../../../lib/ch.ts";
import { queryOptionsFor } from "../../../lib/query-options-server.ts";
import { pack, throughCache, cacheVersion, resultEntry } from "../../../lib/next-cache.ts";

/** The query page's choices for `?studies=a,b`: each study's profiles and sample lists (lib/query-options-server.ts). */
export async function GET(req: Request) {
  await connection();
  try {
    const studies = (new URL(req.url).searchParams.get("studies") || "").split(",").map((s) => s.trim()).filter(Boolean).sort();
    return Response.json(await throughCache(async () => entry(studies.join(","), await cacheVersion()), () => queryOptionsFor(studies)));
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}

async function entry(studies: string, _version: string): Promise<string> {
  "use cache: remote";
  resultEntry();
  return pack(await withoutFailedQueries(() => queryOptionsFor(studies.split(","))));
}
