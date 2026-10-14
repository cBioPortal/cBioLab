"use client";
// The signed-in reader's groups (lib/groups.ts), for the share dialog's picker and the Groups page.
// One query per user, dropped when nobody is signed in; a change re-reads it.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";
import type { GroupSummary, Group } from "../../lib/groups.ts";

export type { GroupSummary, Group };

export async function answer<T = Record<string, unknown>>(res: Response): Promise<T> {
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || res.statusText);
  return j as T;
}

export function useGroups(user: string | null) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["groups", user],
    enabled: !!user,
    queryFn: async ({ signal }) => (await answer<{ groups: GroupSummary[] }>(await api.groups.list({ signal }))).groups,
  });
  return {
    groups: q.data,
    pending: !!user && q.isPending,
    error: q.error ? String(q.error.message || q.error) : null,
    retry: () => { void q.refetch(); },
    /** re-read the list and any open group after a change */
    changed: () => qc.invalidateQueries({ queryKey: ["groups"] }),
  };
}

export function useGroup(user: string | null, id: string | null) {
  const q = useQuery({
    queryKey: ["groups", user, id],
    enabled: !!user && !!id,
    queryFn: async ({ signal }) => (await answer<{ group: Group }>(await api.groups.get(id!, { signal }))).group,
  });
  return { group: q.data, pending: !!user && !!id && q.isPending, error: q.error ? String(q.error.message || q.error) : null };
}
