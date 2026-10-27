import { connection } from "next/server";
import { isAdmin, loginEnabled, loginOptions, userFor } from "../../../lib/auth.ts";

// Whether this deployment signs people in, how, who this browser is signed in as and whether they
// administer it (lib/auth.ts).
export async function GET(req: Request) {
  await connection();
  const user = userFor(req);
  return Response.json({ enabled: loginEnabled(), options: loginOptions(), user: user && { ...user, admin: isAdmin(user) } });
}
