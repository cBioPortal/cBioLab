import { serverDataEnabled, principalFor, unlockCookie, lockCookie } from "../../../../lib/custom-access.ts";

// Server-stored custom data on this deployment: whether it exists, and unlocking it with the
// deployment's shared password (lib/custom-access.ts): POST logs in, DELETE logs out.

export async function GET(req: Request) {
  return Response.json({ enabled: serverDataEnabled(), unlocked: !!principalFor(req) });
}

export async function POST(req: Request) {
  if (!serverDataEnabled()) return Response.json({ error: "server-stored custom data is not enabled on this deployment" }, { status: 404 });
  const { code } = await req.json().catch(() => ({}));
  const cookie = unlockCookie(code, new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https");
  if (!cookie) return Response.json({ error: "wrong password" }, { status: 403 });
  return Response.json({ enabled: true, unlocked: true }, { headers: { "Set-Cookie": cookie } });
}

export async function DELETE() {
  return Response.json({ enabled: serverDataEnabled(), unlocked: false }, { headers: { "Set-Cookie": lockCookie() } });
}
