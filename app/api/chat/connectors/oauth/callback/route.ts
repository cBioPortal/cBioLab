// Step two: the server's sign-in page sends the reader back here with a code. The code becomes a
// token, which goes to the reader's browser and is forgotten (lib/chat-connector-oauth.ts).
import { connection } from "next/server";
import { clearedCookie, doneHtml, failedHtml, finish, originOf, readFlow } from "../../../../../../lib/chat-connector-oauth.ts";
import { chatGuard, registry } from "../../../../../../lib/chat-connector-tools.ts";

const html = (body: string, cookie: string) =>
  new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Set-Cookie": cookie } });

export async function GET(req: Request) {
  await connection();
  const denied = chatGuard(req);
  if (denied) return denied;
  const origin = originOf(req);
  const clear = clearedCookie(origin.startsWith("https:"));
  const q = new URL(req.url).searchParams;
  const flow = readFlow(req.headers.get("cookie"));
  if (!flow) return html(failedHtml("This sign-in could not be finished: it was not started here, or it took more than ten minutes. Try Connect again.", "/"), clear);
  if (q.get("error")) return html(failedHtml("The sign-in was not completed: " + (q.get("error_description") || q.get("error")), flow.returnTo), clear);
  if (!q.get("code") || q.get("state") !== flow.state) return html(failedHtml("This sign-in could not be finished: its answer did not match the one asked for. Try Connect again.", flow.returnTo), clear);
  try {
    const c = registry().find((x) => x.id === flow.id);
    if (!c) throw new Error("no such connector");
    const token = await finish(c, origin, flow, q.get("code")!);
    return html(doneHtml(c, token, flow.returnTo), clear);
  } catch (e) {
    return html(failedHtml("The sign-in did not give a token: " + String((e as Error)?.message || e).slice(0, 200), flow.returnTo), clear);
  }
}
