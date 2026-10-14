import { connection } from "next/server";
import { loginEnabled, loginOptions, userFor } from "../../../lib/auth.ts";

// Whether this deployment signs people in, how, and who this browser is signed in as (lib/auth.ts).
export async function GET(req: Request) {
  await connection();
  return Response.json({ enabled: loginEnabled(), options: loginOptions(), user: userFor(req) });
}
