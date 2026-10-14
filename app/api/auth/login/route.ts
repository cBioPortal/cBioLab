import { connection } from "next/server";
import { oidcConfigured } from "../../../../lib/auth.ts";
import { start } from "../../../../lib/oidc.ts";

// Start signing in with the deployment's provider: redirects there (lib/oidc.ts).
export async function GET(req: Request) {
  await connection();
  if (!oidcConfigured()) return Response.json({ error: "this deployment has no sign-in provider" }, { status: 404 });
  try { return await start(req); }
  catch (e) { return Response.json({ error: "could not reach the sign-in provider: " + String((e as Error)?.message || e) }, { status: 502 }); }
}
