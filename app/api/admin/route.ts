import { connection } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin, AccessError } from "../../../lib/auth.ts";
import { RESULT_TAG } from "../../../lib/next-cache.ts";

// The administrator's page (/admin), for the users in ADMIN_EMAILS (lib/auth.ts).
//   GET  — whether this reader is an administrator (refused otherwise)
//   POST { action: "clearCache" } — expire every cached result (RESULT_TAG, lib/next-cache.ts):
//          on Vercel the Runtime Cache shared by every function instance, elsewhere the memory
//          of the server process that answers
const fail = (e: unknown) => Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });

export async function GET(req: Request) {
  await connection();
  try { return Response.json({ admin: requireAdmin(req).email }); }
  catch (e) { return fail(e); }
}

export async function POST(req: Request) {
  try {
    requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    if (body.action !== "clearCache") throw new Error("action must be clearCache");
    revalidateTag(RESULT_TAG, { expire: 0 });
    return Response.json({ cleared: new Date().toISOString() });
  } catch (e) { return fail(e); }
}
