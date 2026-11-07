"use client";
// The evolution view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { EvolutionBody } from "../evolution-body";
import type { KindUi } from "./kind-ui.ts";

export const evolutionUi: KindUi<"evolution"> = {
  kind: "evolution",
  label: "Genomic evolution (mutation VAFs across a patient's samples; one patient at a time)",
  category: "patient",
  title: "Genomic evolution",
  maxCohorts: 1,
  cohortInHeader: true,
  sub: (_spec, v) => {
    const cohort = Array.isArray(v.cohorts) && v.cohorts[0] ? String(v.cohorts[0]).split(" / ").join(" › ") : null;
    return <>{cohort && <><strong>{cohort}</strong> · </>}{v.evolution ? v.evolution.total.toLocaleString() + " patients with two or more samples · " : ""}each mutation's allele frequency across the patient's samples</>;
  },
  body: (c) => c.v.evolution ? <EvolutionBody v={c.v} spec={c.spec} vi={c.vi} updating={c.updating ?? c.busy} docJson={c.docJson} patch={c.patch} fixed={c.fixedPatient} /> : null,
  drawsOwnWaiting: true,
};
