import { revalidateTag } from "next/cache";
import { userFor } from "../../../lib/auth.ts";
import { clearResultCache } from "../../../lib/settings.ts";
import { RESULT_TAG } from "../../../lib/next-cache.ts";

// The header's "clear cache" button (app/_ui/site-header.tsx), open to every visitor, signed in or not.
//   POST — clear the result cache (lib/next-cache.ts) for the whole deployment, exactly as /admin's
//          clearCache does; recorded under the signed-in user, or no one.
//          { cleared: true, recorded: true }: a new key for every entry, in every process, and the
//          entries themselves expired where the cache can expire them (Vercel's Runtime Cache, this
//          process's memory).
//          { cleared: true, recorded: false, reason }: this deployment's settings cannot be changed
//          (no settings database, say), so no key changed and the clear is the expiry alone.
export async function POST(req: Request) {
  try {
    const unrecorded = await clearResultCache(userFor(req)?.id ?? null, () => revalidateTag(RESULT_TAG, { expire: 0 }));
    return Response.json(unrecorded == null ? { cleared: true, recorded: true }
      : { cleared: true, recorded: false, reason: "the clear was not recorded (" + unrecorded + "), so no cached entry's key changed: entries were expired through their tag only" });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
