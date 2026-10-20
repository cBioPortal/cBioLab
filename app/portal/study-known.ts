"use client";
// What a portal page needs to know about a study before laying out its tabs: its continuous
// molecular profiles, generic-assay profiles and clinical attributes (most covered first).
import { useEffect, useState } from "react";
import { api } from "../lab/api.ts";
import type { ProfileInfo } from "../../lib/profile-catalog.ts";

export interface StudyKnown {
  profiles: string[]; gaProfiles: string[]; clinical: string[];
  /** every profile as the study describes it, for a plot axis's Data picker */
  profileCatalog: ProfileInfo[];
  /** the clinical attributes with their kind and coverage, for the oncoprint's Tracks menu */
  attrs: { attribute: string; kind: string; patients: number }[];
  /** the study's display name and size, for the page header */
  name: string; patients: number; samples: number;
}

export function useStudyKnown(study: string): { known: StudyKnown | null; error: string | null } {
  const [known, setKnown] = useState<StudyKnown | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!study) return;
    setKnown(null); setError(null);
    Promise.all([
      api.explore({ study }).then((r) => r.json()),
      fetch("/api/studies").then((r) => r.json()).catch(() => ({ studies: [] }))
    ])
      .then(([j, st]) => {
        if (j.error) { setError(j.error); return; }
        const sorted = ((j.clinical || []) as { attribute: string; kind?: string; patients?: number }[])
          .slice().sort((a, b) => (b.patients || 0) - (a.patients || 0));
        const clinical = sorted.map((c) => c.attribute);
        const attrs = sorted.map((c) => ({ attribute: c.attribute, kind: c.kind || "cat", patients: c.patients || 0 }));
        const meta = ((st.studies || []) as { id: string; name: string }[]).find((x) => x.id === study);
        setKnown({ profiles: (j.profiles || []).filter((p: string) => p !== "cna"), gaProfiles: j.gaProfiles || [], clinical, attrs,
          profileCatalog: j.profileCatalog || [],
          name: meta?.name || study, patients: j.totals?.patients || 0, samples: j.totals?.samples || 0 });
      })
      .catch((e) => setError(String(e)));
  }, [study]);
  return { known, error };
}

/** an mRNA profile for expression, as the study describes its profiles: values before z-scores */
export function expressionProfile(catalog: ProfileInfo[]): string | null {
  const m = catalog.filter((p) => p.type === "MRNA_EXPRESSION").sort((a, b) => a.order - b.order);
  return (m.find((p) => p.datatype === "CONTINUOUS") || m.find((p) => p.datatype === "Z-SCORE") || m[0])?.profile || null;
}
/** the study's discrete copy-number profile (GISTIC, or a panel study's calls) */
export function discreteCnaProfile(catalog: ProfileInfo[]): string | null {
  return catalog.find((p) => p.type === "COPY_NUMBER_ALTERATION" && p.datatype === "DISCRETE")?.profile || null;
}
