"use client";
// What a portal page needs to know about a study before laying out its tabs: its continuous
// molecular profiles, generic-assay profiles and clinical attributes (most covered first).
import { useEffect, useState } from "react";

export interface StudyKnown {
  profiles: string[]; gaProfiles: string[]; clinical: string[];
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
      fetch("/api/explore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ study }) }).then((r) => r.json()),
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
          name: meta?.name || study, patients: j.totals?.patients || 0, samples: j.totals?.samples || 0 });
      })
      .catch((e) => setError(String(e)));
  }, [study]);
  return { known, error };
}

/** an mRNA profile for expression, preferring values over z-scores */
export function expressionProfile(profiles: string[]): string | null {
  const m = profiles.filter((p) => /mrna|rna_seq/i.test(p));
  return m.find((p) => !/zscore/i.test(p)) || m[0] || null;
}
