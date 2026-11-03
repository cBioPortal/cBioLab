import { revalidateTag } from "next/cache";
import { userFor } from "../../../lib/auth.ts";
import { markResultCacheCleared } from "../../../lib/settings.ts";
import { RESULT_TAG } from "../../../lib/next-cache.ts";

// The header's "clear cache" button (app/_ui/site-header.tsx), open to every visitor, signed in or not.
//   POST — clear the result cache (lib/next-cache.ts) for the whole deployment, exactly as /admin's
//          clearCache does; recorded under the signed-in user, or no one
export async function POST(req: Request) {
  try {
    // a new key for every entry, in every process; and the entries themselves expire where the
    // cache can expire them (Vercel's Runtime Cache, this process's memory)
    await markResultCacheCleared(userFor(req)?.id ?? null);
    revalidateTag(RESULT_TAG, { expire: 0 });
    return Response.json({ cleared: true });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
