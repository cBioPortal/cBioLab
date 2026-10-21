"use client";
// What a portal page needs to know about what it queries — one study, or several narrowed by
// Explore's filters — before laying out its tabs: the continuous molecular profiles, generic-assay
// profiles and clinical attributes (most covered first), the genomic data types the studies hold,
// and the selection's size.
import { useEffect, useState } from "react";
import { api } from "../lab/api.ts";
import type { Clause } from "../../lib/types";
import type { ProfileInfo } from "../../lib/profile-catalog.ts";

type ProfileType = "MUTATION" | "CNA" | "SV";

export interface StudyKnown {
  profiles: string[]; gaProfiles: string[]; clinical: string[];
  /** every profile as the studies describe them, for a plot axis's Data picker */
  profileCatalog: ProfileInfo[];
  /** the clinical attributes with their kind and coverage, for the oncoprint's Tracks menu */
  attrs: { attribute: string; kind: string; patients: number }[];
  /** a display name: the study's, or how many studies */
  name: string;
  /** each queried study's name, by id */
  names: Record<string, string>;
  /** the selection's size: the whole studies', or what the filters keep */
  patients: number; samples: number;
  /** the genomic data types every queried study holds, and those only some do */
  held: { every: ProfileType[]; some: ProfileType[] };
}

const CAPS: [ProfileType, string][] = [["MUTATION", "mut"], ["CNA", "cna"], ["SV", "sv"]];

export function useQueryKnown(studies: string[], filters: Clause[] = []): { known: StudyKnown | null; error: string | null } {
  const [known, setKnown] = useState<StudyKnown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify([studies, filters]);
  useEffect(() => {
    if (!studies.length) return;
    setKnown(null); setError(null);
    const scope = studies.length === 1 ? { study: studies[0] } : { studies };
    Promise.all([
      api.explore({ ...scope, draft: filters.length ? { ...scope, all: filters } : null }).then((r) => r.json()),
      api.studies().then((r) => r.json()).catch(() => ({ studies: [] }))
    ])
      .then(([j, st]) => {
        if (j.error) { setError(j.error); return; }
        const sorted = ((j.clinical || []) as { attribute: string; kind?: string; patients?: number }[])
          .slice().sort((a, b) => (b.patients || 0) - (a.patients || 0));
        const catalog = (st.studies || []) as { id: string; name: string; caps?: Record<string, boolean> }[];
        const rows = studies.map((id) => catalog.find((x) => x.id === id));
        const missing = studies.filter((_, i) => !rows[i]);
        if (missing.length) { setError("no study named " + missing.join(", ") + " on this deployment"); return; }
        const holding = (cap: string) => rows.filter((r) => r!.caps?.[cap]).length;
        setKnown({
          profiles: (j.profiles || []).filter((p: string) => p !== "cna"), gaProfiles: j.gaProfiles || [],
          profileCatalog: j.profileCatalog || [],
          clinical: sorted.map((c) => c.attribute),
          attrs: sorted.map((c) => ({ attribute: c.attribute, kind: c.kind || "cat", patients: c.patients || 0 })),
          name: studies.length === 1 ? rows[0]!.name : studies.length + " studies",
          names: Object.fromEntries(rows.map((r) => [r!.id, r!.name])),
          patients: j.totals?.patients || 0, samples: j.totals?.samples || 0,
          held: {
            every: CAPS.filter(([, c]) => holding(c) === studies.length).map(([t]) => t),
            some: CAPS.filter(([, c]) => holding(c) > 0 && holding(c) < studies.length).map(([t]) => t),
          },
        });
      })
      .catch((e) => setError(String(e)));
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  return { known, error };
}

/** one study's, for a page about one study */
export const useStudyKnown = (study: string) => useQueryKnown(study ? [study] : []);

/** an mRNA profile for expression, as the study describes its profiles: values before z-scores */
export function expressionProfile(catalog: ProfileInfo[]): string | null {
  const m = catalog.filter((p) => p.type === "MRNA_EXPRESSION").sort((a, b) => a.order - b.order);
  return (m.find((p) => p.datatype === "CONTINUOUS") || m.find((p) => p.datatype === "Z-SCORE") || m[0])?.profile || null;
}
/** the study's discrete copy-number profile (GISTIC, or a panel study's calls) */
export function discreteCnaProfile(catalog: ProfileInfo[]): string | null {
  return catalog.find((p) => p.type === "COPY_NUMBER_ALTERATION" && p.datatype === "DISCRETE")?.profile || null;
}
