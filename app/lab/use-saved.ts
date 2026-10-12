"use client";
// Saved cohorts and analyses (lib/artifacts.ts) as the page holds them: one query per kind, read
// while the reader is logged in and dropped when they log out, so a logged-out page never shows
// someone's saved work — a reply that lands after logging out is cancelled, not shown.
//
// A save or a delete writes the server's answer into the same query, so nothing refetches. Both
// are keyed by name: the name a person types is the identity they see (saving under a name that
// exists updates it); the server-assigned id is kept beside it.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { AnalysisDoc, CohortDef } from "../../lib/types.ts";
import type { ArtifactKind } from "../../lib/artifacts.ts";
import { api } from "./api.ts";

export type SavedCohort = { id: string; def: CohortDef; savedAt: string; lastEval?: { count: number; text?: string } | null };
export type SavedWorkspace = { id: string; doc: AnalysisDoc; savedAt: string };
/** Loading, failed and loaded are different states: a list that has not arrived is not empty. */
export type ListState = { pending: boolean; error: string | null; retry: () => void };

type Artifact = { id: string; name: string; definition: unknown; updatedAt: string };

const KEY = ["artifacts"] as const;
const NONE = {};
const keyOf = (kind: ArtifactKind) => [...KEY, kind] as const;

/** Postgres timestamptz -> the same "YYYY-MM-DD HH:MM" the app has always shown. */
const fmtDate = (iso: string) => iso.slice(0, 16).replace("T", " ");

async function answer(res: Response) {
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || res.statusText);
  return j;
}

const asCohort = (a: Artifact, lastEval: SavedCohort["lastEval"] = null): SavedCohort =>
  ({ id: a.id, def: a.definition as CohortDef, savedAt: fmtDate(a.updatedAt), lastEval });
const asWorkspace = (a: Artifact): SavedWorkspace =>
  ({ id: a.id, doc: a.definition as AnalysisDoc, savedAt: fmtDate(a.updatedAt) });

function listQuery<T>(kind: ArtifactKind, enabled: boolean, as: (a: Artifact) => T) {
  return {
    queryKey: keyOf(kind),
    enabled,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const j = await answer(await api.artifacts.list(kind, { signal }));
      return Object.fromEntries((j.artifacts as Artifact[]).map((a) => [a.name, as(a)])) as Record<string, T>;
    },
  };
}

export function useSavedArtifacts(loggedIn: boolean) {
  const qc = useQueryClient();
  const cohortsQ = useQuery(listQuery("cohort", loggedIn, (a) => asCohort(a)));
  const workspacesQ = useQuery(listQuery("workspace", loggedIn, asWorkspace));

  useEffect(() => {
    if (loggedIn) return;
    qc.cancelQueries({ queryKey: KEY });
    qc.removeQueries({ queryKey: KEY });
  }, [loggedIn, qc]);

  /** Put one entry (or remove it, with null). A list that has not loaded yet is read instead, so
   *  a save made before it arrives does not stand in for everything else saved. */
  function put<T>(kind: ArtifactKind, name: string, value: T | null) {
    if (qc.getQueryData(keyOf(kind)) === undefined) { qc.invalidateQueries({ queryKey: keyOf(kind) }); return; }
    qc.setQueryData<Record<string, T>>(keyOf(kind), (prev) => {
      const next = { ...prev };
      if (value) next[name] = value; else delete next[name];
      return next;
    });
  }
  const idOf = (kind: ArtifactKind, name: string) =>
    qc.getQueryData<Record<string, { id: string }>>(keyOf(kind))?.[name]?.id;

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
    retry: () => { q.refetch(); },
  });

  return {
    cohorts: ((loggedIn && cohortsQ.data) || NONE) as Record<string, SavedCohort>,
    workspaces: ((loggedIn && workspacesQ.data) || NONE) as Record<string, SavedWorkspace>,
    cohortsState: state(cohortsQ),
    workspacesState: state(workspacesQ),
    /** save a cohort under `name` — over the saved cohort `id` when given, else over the one of that name, else as a new one */
    saveCohort: async (name: string, def: CohortDef, lastEval: SavedCohort["lastEval"], id?: string): Promise<SavedCohort> => {
      const a = await save("cohort", name, def, id);
      const c = asCohort(a, lastEval);
      if (id) { const old = Object.entries(qc.getQueryData<Record<string, SavedCohort>>(keyOf("cohort")) || {}).find(([, x]) => x.id === id); if (old && old[0] !== name) put<SavedCohort>("cohort", old[0], null); }
      put("cohort", name, c);
      return c;
    },
    removeCohort: (name: string) => remove("cohort", name),
    saveWorkspace: async (name: string, doc: AnalysisDoc) =>
      put("workspace", name, asWorkspace(await save("workspace", name, doc))),
    removeWorkspace: (name: string) => remove("workspace", name),
  };
}

export type SavedArtifacts = ReturnType<typeof useSavedArtifacts>;
