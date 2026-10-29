"use client";
// What a portal page needs to know about what it queries — one study, or several narrowed by
// Explore's filters — to lay out its tabs: the continuous molecular profiles, generic-assay
// profiles and clinical attributes (most covered first), the genomic data types the studies hold,
// and the selection's size.
import { useEffect, useState } from "react";
import { api } from "../lab/api.ts";
import type { Clause } from "../../lib/types";
import { profileGroup, type ProfileInfo } from "../../lib/profile-catalog.ts";

type ProfileType = "MUTATION" | "CNA" | "SV";

/** What the study list says of the queried studies: enough to lay out the tabs that need no more. */
export interface StudyBasics {
  /** a display name: the study's, or how many studies */
  name: string;
  /** each queried study's name, by id */
  names: Record<string, string>;
  /** the genomic data types every queried study holds, and those only some do */
  held: { every: ProfileType[]; some: ProfileType[] };
}

export interface StudyKnown extends StudyBasics {
  profiles: string[]; gaProfiles: string[]; clinical: string[];
  /** every profile as the studies describe them, for a plot axis's Data picker */
  profileCatalog: ProfileInfo[];
  /** the clinical attributes with their kind and coverage, for the oncoprint's Tracks menu */
  attrs: { attribute: string; kind: string; patients: number }[];
  /** the selection's size: the whole studies', or what the filters keep */
  patients: number; samples: number;
}

const CAPS: [ProfileType, string][] = [["MUTATION", "mut"], ["CNA", "cna"], ["SV", "sv"]];

/**
 * What the page queries, in two steps: `basics` from the study list, which is quick, then `known`
 * from Explore's facets of the selection, which can take seconds — so a page can lay out what
 * needs only the basics before the rest arrives.
 */
export function useQueryKnown(studies: string[], filters: Clause[] = []): { basics: StudyBasics | null; known: StudyKnown | null; error: string | null } {
  const [basics, setBasics] = useState<StudyBasics | null>(null);
  const [known, setKnown] = useState<StudyKnown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify([studies, filters]);
  useEffect(() => {
    if (!studies.length) return;
    setBasics(null); setKnown(null); setError(null);
    let live = true;
    const scope = studies.length === 1 ? { study: studies[0] } : { studies };
    const fail = (e: string) => { if (live) setError(e); };
    const listed = api.studies().then((r) => r.json()).catch(() => ({ studies: [] })).then((st): StudyBasics | null => {
      const catalog = (st.studies || []) as { id: string; name: string; caps?: Record<string, boolean> }[];
      const rows = studies.map((id) => catalog.find((x) => x.id === id));
      const missing = studies.filter((_, i) => !rows[i]);
      if (missing.length) { fail("no study named " + missing.join(", ") + " on this deployment"); return null; }
      const holding = (cap: string) => rows.filter((r) => r!.caps?.[cap]).length;
      const b = {
        name: studies.length === 1 ? rows[0]!.name : studies.length + " studies",
        names: Object.fromEntries(rows.map((r) => [r!.id, r!.name])),
        held: {
          every: CAPS.filter(([, c]) => holding(c) === studies.length).map(([t]) => t),
          some: CAPS.filter(([, c]) => holding(c) > 0 && holding(c) < studies.length).map(([t]) => t),
        },
      };
      if (live) setBasics(b);
      return b;
    });
    Promise.all([api.explore({ ...scope, draft: filters.length ? { ...scope, all: filters } : null }).then((r) => r.json()), listed])
      .then(([j, b]) => {
        if (j.error) { fail(j.error); return; }
        if (!b || !live) return;
        const sorted = ((j.clinical || []) as { attribute: string; kind?: string; patients?: number }[])
          .slice().sort((a, b) => (b.patients || 0) - (a.patients || 0));
        setKnown({
          ...b,
          profiles: (j.profiles || []).filter((p: string) => p !== "cna"), gaProfiles: j.gaProfiles || [],
          profileCatalog: j.profileCatalog || [],
          clinical: sorted.map((c) => c.attribute),
          attrs: sorted.map((c) => ({ attribute: c.attribute, kind: c.kind || "cat", patients: c.patients || 0 })),
          patients: j.totals?.patients || 0, samples: j.totals?.samples || 0,
        });
      })
      .catch((e) => fail(String(e)));
    return () => { live = false; };
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  return { basics, known, error };
}

/** one study's, for a page about one study */
export const useStudyKnown = (study: string) => useQueryKnown(study ? [study] : []);

/** an mRNA profile for expression, as the study describes its profiles: values before z-scores */
export function expressionProfile(catalog: ProfileInfo[]): string | null {
  const m = catalog.filter((p) => p.type === "MRNA_EXPRESSION").sort((a, b) => a.order - b.order);
  return (m.find((p) => p.datatype === "CONTINUOUS") || m.find((p) => p.datatype === "Z-SCORE") || m[0])?.profile || null;
}
/**
 * One generic-assay profile per kind (signatures, arm-level copy number, ancestry, …), for a
 * comparison's Generic Assay tabs, as the portal gives each kind its own: a signature's
 * contributions before its counts and single-base (SBS) signatures before doublet and indel ones,
 * the study's own order otherwise. Methylation is left out — per
 * probe, it is more entities than the assays view compares.
 */
export function assayComparisonProfiles(catalog: ProfileInfo[], max = 4): { label: string; profile: string }[] {
  const out = new Map<string, string>();
  const ga = catalog.filter((p) => p.type === "GENERIC_ASSAY" && !/METHYLATION/i.test(p.assayType || "") && !/methylation/i.test(p.profile))
    .sort((a, b) => Number(/contribution/i.test(b.profile)) - Number(/contribution/i.test(a.profile)) ||
      Number(/_SBS$/i.test(b.profile)) - Number(/_SBS$/i.test(a.profile)) || a.order - b.order || a.profile.localeCompare(b.profile));
  for (const p of ga) { const g = profileGroup(p); if (!out.has(g)) out.set(g, p.profile); }
  return [...out].slice(0, max).map(([label, profile]) => ({ label, profile }));
}
/** the study's discrete copy-number profile (GISTIC, or a panel study's calls) */
export function discreteCnaProfile(catalog: ProfileInfo[]): string | null {
  return catalog.find((p) => p.type === "COPY_NUMBER_ALTERATION" && p.datatype === "DISCRETE")?.profile || null;
}
