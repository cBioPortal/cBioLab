import { connection } from "next/server";
import { requirePrincipal, AccessError } from "../../../lib/auth.ts";
import { searchUsers } from "../../../lib/users.ts";

// People to add to a group (lib/users.ts): GET ?q= finds those who have signed in, by email prefix
// or a word of their name. Signed-in readers only.
const fail = (e: unknown) => Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });

export async function GET(req: Request) {
  // a search of who has signed in, at request time: never a build's answer
  await connection();
  try {
    requirePrincipal(req, "find people to add to a group");
    return Response.json({ users: await searchUsers(new URL(req.url).searchParams.get("q")) });
  } catch (e) { return fail(e); }
}
