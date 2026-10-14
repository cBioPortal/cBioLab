import { connection } from "next/server";
import { finish } from "../../../../lib/oidc.ts";

// Where the provider sends the browser back (lib/oidc.ts). A failure goes back to the app with
// the reason, which the sign-in button shows, rather than to a bare error page.
export async function GET(req: Request) {
  await connection();
  try { return await finish(req); }
  catch (e) {
    const why = String((e as Error)?.message || e).slice(0, 300);
    console.warn("[auth] sign-in failed:", why);
    return new Response(null, { status: 302, headers: { Location: "/lab?signin_error=" + encodeURIComponent(why) } });
  }
}
