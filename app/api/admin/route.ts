import { connection } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin, AccessError } from "../../../lib/auth.ts";
import { markResultCacheCleared, setSetting, settingsReport } from "../../../lib/settings.ts";
import { RESULT_TAG } from "../../../lib/next-cache.ts";

// The administrator's page (/admin), for the users in ADMIN_EMAILS (lib/auth.ts).
//   GET  — every federation setting: its environment value (secrets only as set or not), the
//          override in force, and the recent changes (lib/settings.ts)
//   POST { action: "set", name, value } — override a setting for the whole deployment
//   POST { action: "reset", name }       — return it to its environment variable
//   POST { action: "clearCache" }        — clear the result cache (lib/next-cache.ts)
const fail = (e: unknown) => Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });

export async function GET(req: Request) {
  await connection();
  try {
    requireAdmin(req);
    return Response.json(await settingsReport());
  } catch (e) { return fail(e); }
}

export async function POST(req: Request) {
  try {
    const u = requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    if (body.action === "clearCache") {
      // a new key for every entry, in every process; and the entries themselves expire where the
      // cache can expire them (Vercel's Runtime Cache, this process's memory)
      await markResultCacheCleared(u.id);
      revalidateTag(RESULT_TAG, { expire: 0 });
    } else if (body.action === "set" || body.action === "reset") {
      if (typeof body.name !== "string") throw new Error("name the setting");
      if (body.action === "set" && typeof body.value !== "string") throw new Error("value must be text");
      await setSetting(body.name, body.action === "set" ? body.value : null, u.id);
    } else throw new Error("action must be set, reset or clearCache");
    return Response.json(await settingsReport());
  } catch (e) { return fail(e); }
}
