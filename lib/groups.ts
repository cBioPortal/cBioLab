// Groups of users (db/migrations/0005_sharing.sql), managed by the users themselves: anyone signed in
// creates a group and is its first admin; an admin adds people by email (whether or not they have
// signed in yet — lib/users.ts), removes them, makes them admins, renames and deletes the group; any
// member may leave. A group always keeps an admin. Only members see a group and who is in it.
// Deleting a group returns everything shared with it to private.
import { dbQuery } from "./db.ts";
import { AccessError } from "./auth.ts";
import { userForEmail } from "./users.ts";

export type Role = "admin" | "member";
export interface GroupSummary { id: string; name: string; description: string | null; role: Role; members: number; createdAt: string }
export interface Member { id: string; email: string; name: string | null; role: Role; signedIn: boolean }
export interface Group extends GroupSummary { memberList: Member[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (x: unknown) => x instanceof Date ? x.toISOString() : String(x);

function validName(name: unknown): string {
  const s = String(name ?? "").trim();
  if (!s) throw new Error("a group needs a name");
  if (s.length > 100) throw new Error("a group name is at most 100 characters");
  return s;
}
const validDescription = (d: unknown): string | null => {
  const s = typeof d === "string" ? d.trim() : "";
  if (s.length > 500) throw new Error("a description is at most 500 characters");
  return s || null;
};

interface SummaryRow { id: string; name: string; description: string | null; role: Role; members: string | number; created_at: unknown }
const summary = (r: SummaryRow): GroupSummary =>
  ({ id: r.id, name: r.name, description: r.description, role: r.role, members: Number(r.members), createdAt: iso(r.created_at) });

const SUMMARY_SQL = "select g.id, g.name, g.description, m.role, g.created_at," +
  " (select count(*) from group_member x where x.group_id = g.id) as members" +
  " from user_group g join group_member m on m.group_id = g.id and m.user_id = $1";

/** The groups the user belongs to, by name. */
export async function listGroups(principal: string): Promise<GroupSummary[]> {
  return (await dbQuery<SummaryRow>(SUMMARY_SQL + " order by lower(g.name), g.created_at", [principal])).map(summary);
}

/** A group the user belongs to, with its members; anyone else is told it does not exist. */
export async function getGroup(principal: string, id: string): Promise<Group> {
  const [r] = UUID.test(id) ? await dbQuery<SummaryRow>(SUMMARY_SQL + " where g.id = $2", [principal, id]) : [];
  if (!r) throw new AccessError("no group " + id + " that you belong to", 404);
  const members = await dbQuery<{ id: string; email: string; name: string | null; role: Role; last_login_at: unknown }>(
    "select u.id, u.email, u.name, m.role, u.last_login_at from group_member m join app_user u on u.id = m.user_id" +
    " where m.group_id = $1 order by m.role, lower(u.email)", [id]);
  return { ...summary(r), memberList: members.map((m) => ({ id: m.id, email: m.email, name: m.name, role: m.role, signedIn: !!m.last_login_at })) };
}

async function requireAdmin(principal: string, id: string): Promise<Group> {
  const g = await getGroup(principal, id);
  if (g.role !== "admin") throw new AccessError("only an admin of “" + g.name + "” can do that", 403);
  return g;
}

export async function createGroup(principal: string, name: unknown, description?: unknown): Promise<Group> {
  const [g] = await dbQuery<{ id: string }>(
    "with g as (insert into user_group (name, description, created_by) values ($1, $2, $3) returning id)" +
    " insert into group_member (group_id, user_id, role, added_by) select id, $3, 'admin', $3 from g returning group_id as id",
    [validName(name), validDescription(description), principal]);
  return getGroup(principal, g.id);
}

export async function updateGroup(principal: string, id: string, patch: { name?: unknown; description?: unknown }): Promise<Group> {
  const g = await requireAdmin(principal, id);
  await dbQuery("update user_group set name = $2, description = $3 where id = $1", [id,
    patch.name === undefined ? g.name : validName(patch.name),
    patch.description === undefined ? g.description : validDescription(patch.description)]);
  return getGroup(principal, id);
}

/** Delete a group; what was shared with it becomes private again (in the same statement). */
export async function deleteGroup(principal: string, id: string): Promise<void> {
  await requireAdmin(principal, id);
  const unshare = (t: string) =>
    "update " + t + " set visibility = case when visibility = 'group' then 'private' else visibility end," +
    " group_id = null, group_can_edit = false where group_id = $1";
  await dbQuery("with a as (" + unshare("saved_artifacts") + " returning 1), d as (" + unshare("custom_dataset") + " returning 1)," +
    " s as (" + unshare("id_set") + " returning 1) delete from user_group where id = $1", [id]);
}

/** Add someone by email (signed in yet or not); an existing member keeps their role unless one is given. */
export async function addMember(principal: string, id: string, email: unknown, role: Role = "member"): Promise<Group> {
  await requireAdmin(principal, id);
  if (role !== "admin" && role !== "member") throw new Error("role must be admin or member");
  const u = await userForEmail(email);
  await dbQuery("insert into group_member (group_id, user_id, role, added_by) values ($1, $2, $3, $4)" +
    " on conflict (group_id, user_id) do update set role = excluded.role", [id, u.id, role, principal]);
  return getGroup(principal, id);
}

const admins = async (id: string) =>
  Number((await dbQuery<{ n: string }>("select count(*) as n from group_member where group_id = $1 and role = 'admin'", [id]))[0].n);

export async function setRole(principal: string, id: string, userId: string, role: Role): Promise<Group> {
  const g = await requireAdmin(principal, id);
  if (role !== "admin" && role !== "member") throw new Error("role must be admin or member");
  const m = g.memberList.find((x) => x.id === userId);
  if (!m) throw new AccessError("that person is not in “" + g.name + "”", 404);
  if (m.role === "admin" && role === "member" && (await admins(id)) <= 1)
    throw new Error("“" + g.name + "” needs an admin: make someone else an admin first");
  await dbQuery("update group_member set role = $3 where group_id = $1 and user_id = $2", [id, userId, role]);
  return getGroup(principal, id);
}

/** Remove a member (an admin), or leave (anyone, removing themselves). */
export async function removeMember(principal: string, id: string, userId: string): Promise<void> {
  const g = userId === principal ? await getGroup(principal, id) : await requireAdmin(principal, id);
  const m = g.memberList.find((x) => x.id === userId);
  if (!m) throw new AccessError("that person is not in “" + g.name + "”", 404);
  if (m.role === "admin" && (await admins(id)) <= 1)
    throw new Error("“" + g.name + "” needs an admin: make someone else an admin first, or delete the group");
  await dbQuery("delete from group_member where group_id = $1 and user_id = $2", [id, userId]);
}
