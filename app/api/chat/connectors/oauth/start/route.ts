// Step one of signing a reader in to a connector (lib/chat-connector-oauth.ts): find the server's
// sign-in page and send the reader there. GET /api/chat/connectors/oauth/start?id=<connector>&returnTo=<path>
import { connection } from "next/server";
import { begin, clearedCookie, flowCookie, originOf } from "../../../../../../lib/chat-connector-oauth.ts";
import { chatGuard, registry } from "../../../../../../lib/chat-connector-tools.ts";

export async function GET(req: Request) {
  await connection();
  const denied = chatGuard(req);
  if (denied) return denied;
  const q = new URL(req.url).searchParams;
  try {
    const c = registry().find((x) => x.id === q.get("id"));
    if (!c || c.auth !== "oauth") return Response.json({ error: "no connector here that needs a sign-in has that id" }, { status: 404 });
    const origin = originOf(req);
    const { authUrl, flow } = await begin(c, origin, q.get("returnTo") || "/");
    const secure = origin.startsWith("https:");
    return new Response(null, { status: 302, headers: { Location: authUrl, "Set-Cookie": flowCookie(flow, secure), "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: "could not start the sign-in: " + String((e as Error)?.message || e) }, { status: 502, headers: { "Set-Cookie": clearedCookie(originOf(req).startsWith("https:")) } });
  }
}
