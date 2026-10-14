import { connection } from "next/server";
import { exampleCaseIds } from "../../../../lib/custom-data-server.ts";
import { AccessError, requirePrincipal } from "../../../../lib/auth.ts";

export const maxDuration = 30;

/** A few of a study's patient ids, for the upload panel's example data. Behind the login, like uploading itself. */
export async function GET(req: Request) {
  // rendered per request: without it the build prerenders whatever the login check answers then
  await connection();
  try {
    requirePrincipal(req, "load example custom data");
    const study = new URL(req.url).searchParams.get("study");
    if (!study) throw new Error("name a study");
    return Response.json({ study, patients: await exampleCaseIds(study) });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });
  }
}
