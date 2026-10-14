import { signOutCookie } from "../../../../lib/auth.ts";

// Sign this browser out (the session is the cookie alone, lib/auth.ts).
export async function POST() {
  return Response.json({ user: null }, { headers: { "Set-Cookie": signOutCookie() } });
}
