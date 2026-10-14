// People (db/migrations/0004_users.sql): finding or creating the user behind a sign-in. The only
// module that writes app_user and user_identity.
//
// A sign-in names a provider and that provider's subject. In order:
//   1. an identity already linked to that subject → its user;
//   2. else, when the provider has verified the email, the user with that email (created when
//      someone added them to a group, or by scripts/claim-legacy.ts) → link the identity to it;
//   3. else a new user.
// An unverified email never links to an existing user: anyone can claim an address they do not
// control at some providers, and linking on it would hand them that person's saved work.
import { dbQuery } from "./db.ts";
import { AccessError } from "./auth.ts";

export interface User { id: string; email: string; name: string | null }

interface UserRow { id: string; email: string; name: string | null; disabled_at: string | null }

export interface SignIn { provider: string; subject: string; email?: string | null; emailVerified?: boolean; name?: string | null }

export const normalEmail = (e: unknown): string | null => {
  const s = typeof e === "string" ? e.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+$/.test(s) ? s : null;
};

const asUser = (r: UserRow): User => ({ id: r.id, email: r.email, name: r.name });

export async function signIn(s: SignIn): Promise<User> {
  if (!s.provider || !s.subject) throw new Error("a sign-in needs a provider and a subject");
  const email = normalEmail(s.email);
  const name = s.name?.trim() || null;

  let [u] = await dbQuery<UserRow>(
    "select u.* from user_identity i join app_user u on u.id = i.user_id where i.provider = $1 and i.subject = $2", [s.provider, s.subject]);
  if (!u) {
    if (!email) throw new AccessError("the sign-in did not include an email address, which this app needs to identify you", 403);
    const [existing] = await dbQuery<UserRow>("select * from app_user where email = $1", [email]);
    if (existing && !s.emailVerified)
      throw new AccessError("an account for " + email + " exists, but your provider has not verified that address, so it cannot be linked", 403);
    u = existing ?? (await dbQuery<UserRow>(
      "insert into app_user (email, name) values ($1, $2) on conflict (email) do update set email = excluded.email returning *", [email, name]))[0];
    await dbQuery("insert into user_identity (provider, subject, user_id) values ($1, $2, $3) on conflict do nothing", [s.provider, s.subject, u.id]);
  }
  if (u.disabled_at) throw new AccessError("this account (" + u.email + ") has been disabled", 403);
  // the provider is the authority on the name and, once verified, the address
  const [now] = await dbQuery<UserRow>(
    "update app_user set last_login_at = now(), name = coalesce($2, name)," +
    " email = case when $3::text is not null and not exists (select 1 from app_user o where o.email = $3::text and o.id <> $1) then $3::text else email end" +
    " where id = $1 returning *", [u.id, name, s.emailVerified ? email : null]);
  return asUser(now);
}

/** The user with this email, created (never signed in) if there is none. */
export async function userForEmail(email: unknown): Promise<User> {
  const e = normalEmail(email);
  if (!e) throw new Error("not an email address: " + String(email));
  const [u] = await dbQuery<UserRow>(
    "insert into app_user (email) values ($1) on conflict (email) do update set email = excluded.email returning *", [e]);
  return asUser(u);
}

export async function getUser(id: string): Promise<(User & { disabled: boolean }) | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [u] = await dbQuery<UserRow>("select * from app_user where id = $1", [id]);
  return u ? { ...asUser(u), disabled: !!u.disabled_at } : null;
}

/**
 * Give every row saved before there were accounts (no owner) to the user with this email, created
 * if need be: saved cohorts and analyses, and custom datasets. Refused, changing nothing, if that
 * user already owns a dataset under a claimed one's name. `dryRun` only counts.
 */
export async function claimLegacy(email: unknown, dryRun = false): Promise<{ user: User | null; artifacts: number; datasets: number }> {
  if (!normalEmail(email)) throw new Error("not an email address: " + String(email));
  if (dryRun) {
    const n = async (t: string) => Number((await dbQuery<{ n: string }>("select count(*) as n from " + t + " where owner_id is null"))[0].n);
    return { user: null, artifacts: await n("saved_artifacts"), datasets: await n("custom_dataset") };
  }
  const u = await userForEmail(email);
  const clash = await dbQuery<{ slug: string }>(
    "select slug from custom_dataset l where owner_id is null and exists (select 1 from custom_dataset o where o.owner_id = $1 and o.slug = l.slug)", [u.id]);
  if (clash.length) throw new Error(u.email + " already has datasets named " + clash.map((c) => c.slug).join(", ") + "; rename those first");
  const a = await dbQuery("update saved_artifacts set owner_id = $1 where owner_id is null returning id", [u.id]);
  const d = await dbQuery("update custom_dataset set owner_id = $1 where owner_id is null returning id", [u.id]);
  return { user: u, artifacts: a.length, datasets: d.length };
}
