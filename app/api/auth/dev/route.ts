import { devLoginAllowed, sessionCookie, AccessError } from "../../../../lib/auth.ts";
import { signIn, normalEmail } from "../../../../lib/users.ts";

// The development sign-in (lib/auth.ts): any email, no password. Only where AUTH_DEV_LOGIN=1, and
// never on Vercel production.
export async function POST(req: Request) {
  if (!devLoginAllowed()) return Response.json({ error: "the development sign-in is not enabled on this deployment" }, { status: 404 });
  try {
    const { email, name } = await req.json().catch(() => ({}));
    const e = normalEmail(email);
    if (!e) return Response.json({ error: "enter an email address" }, { status: 400 });
    const user = await signIn({ provider: "dev", subject: e, email: e, emailVerified: true, name: typeof name === "string" ? name : null });
    return Response.json({ user }, { headers: { "Set-Cookie": sessionCookie(req, user) } });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 500 });
  }
}
