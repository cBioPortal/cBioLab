// POST /api/logout — clears the session cookie and returns to /login.
import { SESSION_COOKIE } from "../../../lib/site-auth.ts";

export async function POST() {
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/login",
      "Set-Cookie": SESSION_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    }
  });
}
