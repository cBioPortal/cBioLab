"use client";
// What the analysis page's pickers offer, each a query keyed by what decides it: the studies this
// deployment reaches, one study's timeline and survival endpoints, and the clinical attributes and
// molecular profiles across a result's studies. While a key changes the previous answer stays
// on screen, with the query's fetching state saying it is being replaced.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { AnalysisResult } from "../../lib/types.ts";
import type { StudyAccess } from "../../lib/view-coverage.ts";
import { api } from "./api.ts";
import { customDataKey } from "./custom-data-client.ts";
import { isCustomAttr } from "../../lib/custom-data-names.ts";
import type { ProfileInfo } from "../../lib/profile-catalog.ts";

export type StudyInfo = {
  id: string; name: string; cancerType?: string; patients: number; samples: number; timelinePatients: number;
  caps?: Record<string, boolean>; oncokb?: boolean; instance?: string; instanceLabel?: string;
  /** how this deployment reaches it, for which views can be drawn (lib/view-coverage.ts) */
  access?: StudyAccess;
};
export type TrackAttrs = {
  key: string;
  attrs: { attribute: string; kind: string; patients: number }[];
  /** continuous molecular profiles (heatmap tracks, plot axes) */
  profiles: string[];
  /** generic-assay profiles (the assays view) */
  gaProfiles: string[];
  /** every profile as the studies describe them, once per profile id (a plot axis's Data picker) */
  profileCatalog: ProfileInfo[];
};

const NO_STUDIES: StudyInfo[] = [];
const NO_TRACKS: TrackAttrs = { key: "", attrs: [], profiles: [], gaProfiles: [], profileCatalog: [] };

async function answer(res: Response) {
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j;
}

/** The study list, and whether it is still loading or failed (with a retry) — three states, so a page never reads "0 studies" while waiting. */
export function useStudyList(): { studies: StudyInfo[]; loading: boolean; error: string | null; retry: () => void } {
  const q = useQuery({
    queryKey: ["studies"],
    queryFn: async ({ signal }) => ((await answer(await api.studies({ signal }))).studies || []) as StudyInfo[],
  });
  return { studies: q.data ?? NO_STUDIES, loading: q.isPending, error: q.error ? String(q.error.message || q.error) : null, retry: () => { void q.refetch(); } };
}

export function useStudies(): StudyInfo[] {
  return useStudyList().studies;
}

/** The study catalog the survival, course and sequence controls read. A templated document holds
 *  "$study" until its parameter is resolved; asking for a study by that name has no answer, so it
 *  is not asked. `enabled` holds it back until a page that shows those controls is open. */
export function useStudyCatalog(study: string, enabled = true): { cat: any; catLoading: boolean } {
  const q = useQuery({
    queryKey: ["catalog", study],
    enabled: enabled && !!study && !study.startsWith("$"),
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => answer(await api.catalog(study, { signal })),
  });
  return { cat: q.data ?? null, catLoading: q.isFetching };
}

/**
 * The clinical-attribute catalog: the union of attribute names across the result's involved
 * studies (an attribute absent in one study just renders gaps there). Every kind that offers a
 * clinical-attribute picker shares this one fetch — the oncoprint's track menu, a plot's axis
 * pickers, the clinical view's attribute menu, Cox's covariate picker — and so do the add-view
 * buttons, which is why it runs for any result rather than waiting for one of those views to
 * exist. An upload adds attributes to the same studies, so the datasets are part of the key.
 */
export function useTrackAttrs(result: AnalysisResult | null): { trackAttrs: TrackAttrs; trackAttrsLoading: boolean } {
  return useStudyAttrs(result ? (result.involvedStudies && result.involvedStudies.length ? result.involvedStudies : [result.study]) : []);
}

/** The same catalog for any studies — a saved cohort's, say, with no analysis run. */
export function useStudyAttrs(studies: string[]): { trackAttrs: TrackAttrs; trackAttrsLoading: boolean } {
  const key = studies.join(",") + "|" + customDataKey();
  const q = useQuery({
    queryKey: ["trackAttrs", key],
    enabled: studies.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const js = await Promise.all(studies.map((s) => api.explore({ study: s }).then((r) => r.json()).catch(() => null)));
      const seen = new Map<string, { kind: string; patients: number }>(); // attribute -> kind + how many carry it
      const profs = new Set<string>();
      const gas = new Set<string>();
      const described = new Map<string, ProfileInfo>();
      for (const j of js) if (j) {
        if (j.clinical) for (const a of j.clinical) {
          const prev = seen.get(a.attribute);
          seen.set(a.attribute, { kind: prev?.kind || a.kind, patients: (prev?.patients || 0) + (a.patients || 0) });
        }
        for (const p of j.profiles || []) if (p !== "cna") profs.add(p); // discrete cna isn't a heatmap
        for (const p of j.gaProfiles || []) gas.add(p);
        for (const p of (j.profileCatalog || []) as ProfileInfo[]) if (!described.has(p.profile)) described.set(p.profile, p);
      }
      // the reader's own uploads first, then most-covered first, the way the portal orders its picker
      return {
        key,
        attrs: [...seen.entries()].map(([attribute, v]) => ({ attribute, ...v }))
          .sort((x, y) => Number(isCustomAttr(y.attribute)) - Number(isCustomAttr(x.attribute)) ||
            y.patients - x.patients || (x.attribute < y.attribute ? -1 : 1)),
        profiles: [...profs].sort(), gaProfiles: [...gas].sort(), profileCatalog: [...described.values()],
      } as TrackAttrs;
    },
  });
  return { trackAttrs: q.data ?? NO_TRACKS, trackAttrsLoading: q.isFetching };
}
