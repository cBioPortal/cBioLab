// POST /api/login — form post from /login. Sets the session cookie on a correct
// password; either way answers with a 303 so the browser lands on a GET.
// Locations are relative: behind a proxy req.url's host is the internal one.
import { checkPassword, safeNext, signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "../../../lib/site-auth.ts";

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const next = safeNext(form?.get("next"));

  if (!(await checkPassword(process.env, form?.get("password")))) {
    // A fixed delay per failed attempt slows online guessing.
    await new Promise((r) => setTimeout(r, 750));
    const q = new URLSearchParams({ error: "1", next });
    return new Response(null, { status: 303, headers: { Location: "/login?" + q } });
  }

  const token = await signSession(process.env, Date.now() / 1000);
  const proto = req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "");
  const secure = proto === "https" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      Location: next,
      "Set-Cookie": SESSION_COOKIE + "=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + SESSION_TTL_SECONDS + secure
    }
  });
}
