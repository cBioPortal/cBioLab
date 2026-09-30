// Site-wide password gate — see lib/site-auth.ts for the rules and env vars.
import { NextResponse, type NextRequest } from "next/server";
import { decide, SESSION_COOKIE } from "./lib/site-auth.ts";

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const d = await decide(process.env, {
    path,
    cookie: req.cookies.get(SESSION_COOKIE)?.value,
    authorization: req.headers.get("authorization")
  }, Date.now() / 1000);

  if (d.action === "allow") return NextResponse.next();
  if (d.action === "misconfigured")
    return new NextResponse("Site password is not configured (SITE_PASSWORD and AUTH_SECRET).", { status: 503 });
  if (d.action === "unauthorized")
    return NextResponse.json({ error: "authentication required" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });

  const login = new URL("/login", req.url);
  login.search = "";
  login.searchParams.set("next", path + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
