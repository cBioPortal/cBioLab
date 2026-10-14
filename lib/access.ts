// Who may see, change and share a saved item — a cohort, an analysis (lib/artifacts.ts) or a custom
// dataset (lib/custom-store.ts). THE one place these rules live; both stores call it, in SQL for
// lists (readableWhere) and in code for single items (canRead / canWrite / canShare).
//
// An item has an owner and a sharing (db/migrations/0005_sharing.sql):
//   visibility      private: its owner · group: its group's members · public: everyone signed in
//   group_can_edit  its group's members may change it too (requires it to be visible to them)
// Its owner alone deletes it or changes its sharing, and may share only with a group they belong to.
import { dbQuery } from "./db.ts";
import { AccessError } from "./auth.ts";

export type Visibility = "private" | "group" | "public";
export const VISIBILITIES: Visibility[] = ["private", "group", "public"];

/** How an item is shared, as the API speaks it. */
export interface Sharing { visibility: Visibility; groupId: string | null; groupCanEdit: boolean }

/** The columns every shareable table has. */
export interface Shareable { owner_id: string | null; visibility: Visibility; group_id: string | null; group_can_edit: boolean }

/** What the asking user may do with an item. */
export interface Rights { edit: boolean; share: boolean }

/** The groups a user belongs to. */
export async function groupsOf(principal: string): Promise<Set<string>> {
  const rows = await dbQuery<{ group_id: string }>("select group_id from group_member where user_id = $1", [principal]);
  return new Set(rows.map((r) => r.group_id));
}

/**
 * SQL that holds for the rows the user (the uuid parameter `$n`) may read, for a table aliased `t`.
 * An item's group is set only when the group may read it, so membership of it is enough.
 */
export function readableWhere(t: string, n: number): string {
  return "(" + t + ".owner_id = $" + n + "::uuid or " + t + ".visibility = 'public' or " +
    t + ".group_id in (select group_id from group_member where user_id = $" + n + "::uuid))";
}

export function canRead(principal: string, r: Shareable, groups: Set<string>): boolean {
  return r.owner_id === principal || r.visibility === "public" || (!!r.group_id && groups.has(r.group_id));
}
export function canWrite(principal: string, r: Shareable, groups: Set<string>): boolean {
  return r.owner_id === principal || (r.group_can_edit && !!r.group_id && groups.has(r.group_id));
}
export function canShare(principal: string, r: Shareable): boolean {
  return !!r.owner_id && r.owner_id === principal;
}
export function rightsOf(principal: string, r: Shareable, groups: Set<string>): Rights {
  return { edit: canWrite(principal, r, groups), share: canShare(principal, r) };
}

export const sharingOf = (r: Shareable): Sharing =>
  ({ visibility: r.visibility, groupId: r.group_id, groupCanEdit: r.group_can_edit });

/**
 * A requested sharing, checked and normalised: a group is named exactly when the group matters,
 * editing by the group implies seeing, and the owner must belong to the group they share with.
 */
export function validateSharing(input: unknown, groups: Set<string>): Sharing {
  const s = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const visibility = s.visibility as Visibility;
  if (!VISIBILITIES.includes(visibility)) throw new Error("visibility must be one of " + VISIBILITIES.join(", "));
  const groupCanEdit = s.groupCanEdit === true;
  if (groupCanEdit && visibility === "private") throw new Error("a group can edit only what it can see: share with the group, or with everyone");
  const needsGroup = visibility === "group" || groupCanEdit;
  const groupId = needsGroup ? (typeof s.groupId === "string" ? s.groupId : "") : null;
  if (needsGroup && !groupId) throw new Error("name the group to share with");
  if (groupId && !groups.has(groupId)) throw new AccessError("you can share only with a group you belong to", 403);
  return { visibility, groupId, groupCanEdit };
}

/** Whether everyone who can see an item shared `item`-wise can also read a dataset shared `ds`-wise. */
export function covers(ds: Sharing, item: Sharing): boolean {
  if (item.visibility === "private") return true;
  if (ds.visibility === "public") return true;
  if (item.visibility === "public") return false;
  return ds.groupId === item.groupId;
}
