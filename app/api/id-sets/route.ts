import { connection } from "next/server";
import { requirePrincipal, AccessError } from "../../../lib/auth.ts";
import { listIdSets } from "../../../lib/id-set-store.ts";
import { createIdSet } from "../../../lib/id-set-import.ts";

export const maxDuration = 60;

const fail = (e: unknown) => Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });

/** The stored id sets in this reader's saved work, without their ids; `?withdrawn=1` adds their own withdrawn ones. */
export async function GET(req: Request) {
  // rendered per request: without it the build prerenders whatever the login check answers then
  await connection();
  try {
    const withdrawn = new URL(req.url).searchParams.get("withdrawn") === "1";
    return Response.json({ sets: await listIdSets(requirePrincipal(req, "use stored id sets"), { withdrawn }) });
  }
  catch (e) { return fail(e); }
}

/**
 * Save a list of ids as a stored set: `{ name, level, studies, ids }`. The ids are matched to the
 * studies' own samples or patients first; the answer is the set and what did not match.
 */
export async function POST(req: Request) {
  try {
    const principal = requirePrincipal(req, "save stored id sets");
    return Response.json(await createIdSet(principal, await req.json()), { status: 201 });
  } catch (e) { return fail(e); }
}
