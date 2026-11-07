"use client";
// The signatures view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { SignaturesBody } from "../signatures-body";
import type { KindUi } from "./kind-ui.ts";

export const signaturesUi: KindUi<"signatures"> = {
  kind: "signatures",
  label: "Mutational signatures (contributions and spectrum; one patient at a time)",
  category: "patient",
  title: "Mutational signatures",
  maxCohorts: 1,
  cohortInHeader: true,
  why: (k) => k.assays.some((p) => /^mutational_signatures?_contribution_/.test(p)) ? null : "this study has no mutational-signature profile (mutational_signatures_contribution_<type>)",
  sub: (_spec, v) => {
    const cohort = Array.isArray(v.cohorts) && v.cohorts[0] ? String(v.cohorts[0]).split(" / ").join(" › ") : null;
    return <>{cohort && <><strong>{cohort}</strong> · </>}{v.signatures ? v.signatures.total.toLocaleString() + " patients with signatures · " : ""}each signature's contribution, and a sample's mutational spectrum</>;
  },
  body: (c) => c.v.signatures ? <SignaturesBody v={c.v} spec={c.spec} vi={c.vi} updating={c.updating ?? c.busy} docJson={c.docJson} patch={c.patch} fixed={c.fixedPatient} /> : null,
  drawsOwnWaiting: true,
};
