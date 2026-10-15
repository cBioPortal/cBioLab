// This deployment's settings the pages need, read when asked rather than at build time, so one
// image serves every deployment: where the gallery examples run (lib/site.ts).
import { connection } from "next/server";
import { examplesUrl } from "../../../lib/site.ts";

export async function GET() {
  await connection();
  try {
    return Response.json({ examplesUrl: examplesUrl() });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
