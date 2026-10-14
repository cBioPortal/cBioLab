"use client";
// Saved cohorts and analyses (lib/artifacts.ts) as the page holds them: one query per kind and
// signed-in user, read while someone is signed in and dropped when they sign out, so a signed-out
// page never shows someone's saved work — a reply that lands after signing out is cancelled, not shown.
//
// The reader's OWN items are keyed by name: the name a person types is the identity they see
// (saving under a name that exists updates it); the server-assigned id is kept beside it. Items
// others share with them come separately (`shared*`), keyed by id, since two people may well use
// the same name. A save or a delete writes the server's answer into the same query, so nothing
// refetches.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { AnalysisDoc, CohortDef } from "../../lib/types.ts";
import type { ArtifactKind, DatasetWarning } from "../../lib/artifacts.ts";
import type { Sharing } from "../../lib/access.ts";
import { api } from "./api.ts";

export type SavedCohort = { id: string; def: CohortDef; savedAt: string; lastEval?: { count: number; text?: string } | null; sharing?: Artifact["sharing"] };
export type SavedWorkspace = { id: string; doc: AnalysisDoc; savedAt: string; sharing?: Artifact["sharing"]; version?: number };
/** Loading, failed and loaded are different states: a list that has not arrived is not empty. */
export type ListState = { pending: boolean; error: string | null; retry: () => void };

type Artifact = {
  id: string; name: string; definition: unknown; updatedAt: string; version: number;
  owner: { id: string; email: string; name: string | null };
  sharing: { visibility: "private" | "group" | "public"; groupId: string | null; groupCanEdit: boolean; groupName: string | null };
  rights: { edit: boolean; share: boolean };
};
/** An item someone else shared with the reader: what it is, whose, and what they may do with it. */
export type Shared<T> = { id: string; name: string; item: T; owner: Artifact["owner"]; sharing: Artifact["sharing"]; rights: Artifact["rights"]; version: number };
type Lists<T> = { own: Record<string, T>; shared: Shared<T>[] };

const KEY = ["artifacts"] as const;
const NONE = {};
const EMPTY: never[] = [];
const keyOf = (kind: ArtifactKind, user: string | null) => [...KEY, kind, user] as const;

/** Postgres timestamptz -> the same "YYYY-MM-DD HH:MM" the app has always shown. */
const fmtDate = (iso: string) => iso.slice(0, 16).replace("T", " ");

async function answer(res: Response) {
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || res.statusText);
  return j;
}

const asCohort = (a: Artifact, lastEval: SavedCohort["lastEval"] = null): SavedCohort =>
  ({ id: a.id, def: a.definition as CohortDef, savedAt: fmtDate(a.updatedAt), lastEval, sharing: a.sharing });
const asWorkspace = (a: Artifact): SavedWorkspace =>
  ({ id: a.id, doc: a.definition as AnalysisDoc, savedAt: fmtDate(a.updatedAt), sharing: a.sharing, version: a.version });

function listQuery<T>(kind: ArtifactKind, user: string | null, as: (a: Artifact) => T) {
  return {
    queryKey: keyOf(kind, user),
    enabled: !!user,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Lists<T>> => {
      const all = (await answer(await api.artifacts.list(kind, { signal }))).artifacts as Artifact[];
      return {
        own: Object.fromEntries(all.filter((a) => a.owner.id === user).map((a) => [a.name, as(a)])),
        shared: all.filter((a) => a.owner.id !== user).map((a) => ({
          id: a.id, name: a.name, item: as(a), owner: a.owner, sharing: a.sharing, rights: a.rights, version: a.version })),
      };
    },
  };
}

/** `user`: the signed-in user's id, or null when nobody is signed in. */
export function useSavedArtifacts(user: string | null) {
  const qc = useQueryClient();
  const loggedIn = !!user;
  const cohortsQ = useQuery(listQuery("cohort", user, (a) => asCohort(a)));
  const workspacesQ = useQuery(listQuery("workspace", user, asWorkspace));

  useEffect(() => {
    if (loggedIn) return;
    void qc.cancelQueries({ queryKey: KEY });
    qc.removeQueries({ queryKey: KEY });
  }, [loggedIn, qc]);

  /** Put one entry (or remove it, with null). A list that has not loaded yet is read instead, so
   *  a save made before it arrives does not stand in for everything else saved. */
  function put<T>(kind: ArtifactKind, name: string, value: T | null) {
    if (qc.getQueryData(keyOf(kind, user)) === undefined) { void qc.invalidateQueries({ queryKey: keyOf(kind, user) }); return; }
    qc.setQueryData<Lists<T>>(keyOf(kind, user), (prev) => {
      const own = { ...prev!.own };
      if (value) own[name] = value; else delete own[name];
      return { ...prev!, own };
    });
  }
  const idOf = (kind: ArtifactKind, name: string) =>
    qc.getQueryData<Lists<{ id: string }>>(keyOf(kind, user))?.own[name]?.id;

  async function save(kind: ArtifactKind, name: string, definition: unknown, known?: string): Promise<Artifact> {
    const id = known || idOf(kind, name);
    const res = id ? await api.artifacts.update(id, { name, definition }) : await api.artifacts.create({ kind, name, definition });
    return (await answer(res)).artifact as Artifact;
  }
  async function remove(kind: ArtifactKind, name: string) {
    const id = idOf(kind, name);
    if (id) await answer(await api.artifacts.remove(id));
    put(kind, name, null);
  }

  const state = (q: typeof cohortsQ | typeof workspacesQ): ListState => ({
    pending: loggedIn && q.isPending,
    error: q.error ? String(q.error.message || q.error) : null,
    retry: () => { void q.refetch(); },
  });

  return {
    cohorts: ((loggedIn && cohortsQ.data?.own) || NONE) as Record<string, SavedCohort>,
    workspaces: ((loggedIn && workspacesQ.data?.own) || NONE) as Record<string, SavedWorkspace>,
    /** what others have shared with the reader, newest first */
    sharedCohorts: ((loggedIn && cohortsQ.data?.shared) || EMPTY) as Shared<SavedCohort>[],
    sharedWorkspaces: ((loggedIn && workspacesQ.data?.shared) || EMPTY) as Shared<SavedWorkspace>[],
    cohortsState: state(cohortsQ),
    workspacesState: state(workspacesQ),
    /** save a cohort under `name` — over the saved cohort `id` when given, else over the one of that name, else as a new one */
    saveCohort: async (name: string, def: CohortDef, lastEval: SavedCohort["lastEval"], id?: string): Promise<SavedCohort> => {
      const a = await save("cohort", name, def, id);
      const c = asCohort(a, lastEval);
      if (id) { const old = Object.entries(qc.getQueryData<Lists<SavedCohort>>(keyOf("cohort", user))?.own || {}).find(([, x]) => x.id === id); if (old && old[0] !== name) put<SavedCohort>("cohort", old[0], null); }
      put("cohort", name, c);
      return c;
    },
    removeCohort: (name: string) => remove("cohort", name),
    saveWorkspace: async (name: string, doc: AnalysisDoc) =>
      put("workspace", name, asWorkspace(await save("workspace", name, doc))),
    removeWorkspace: (name: string) => remove("workspace", name),
    /** who one of the reader's own items is shared with; answers the custom datasets its audience cannot read */
    share: async (kind: ArtifactKind, id: string, sharing: Sharing): Promise<DatasetWarning[]> => {
      const j = await answer(await api.artifacts.share(id, sharing));
      await qc.invalidateQueries({ queryKey: keyOf(kind, user) });
      return j.warnings as DatasetWarning[];
    },
    /** save over an item someone shared with the reader to edit, from the version they opened (a stale one is refused) */
    saveShared: async (kind: ArtifactKind, id: string, name: string, definition: unknown, version: number): Promise<Artifact> => {
      const a = (await answer(await api.artifacts.update(id, { name, definition, version }))).artifact as Artifact;
      await qc.invalidateQueries({ queryKey: keyOf(kind, user) });
      return a;
    },
    /** re-read both lists (another person may have changed what is shared) */
    refresh: () => qc.invalidateQueries({ queryKey: KEY }),
  };
}

export type SavedArtifacts = ReturnType<typeof useSavedArtifacts>;
