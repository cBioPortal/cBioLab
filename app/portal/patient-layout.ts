// The Patient page's document, as cBioPortal's patient view lays the page out: one cohort — the
// patient (every sample), or in sample mode one sample — and one tab per portal tab drawing it. A tab whose view does not exist yet is laid out
// with what it will show (`pending`), so the page has the portal's tabs and says which are still
// to be built. Pure: the page builds it, and so can a script that checks the views run.
import type { View } from "../../lib/types.ts";
import type { ProfileInfo } from "../../lib/profile-catalog.ts";
import { arrange, type PageLayout } from "./page-doc.ts";

/** What a Patient page shows: a patient, or one sample (the portal's sample view). */
export type PatientQuery = { study: string; patient: string; sample?: undefined } | { study: string; sample: string; patient?: undefined };

/** What the study holds, as far as the page's tabs need it. */
export interface PatientData {
  profileCatalog: ProfileInfo[];
  /** the genomic data types the study holds */
  held: ("MUTATION" | "CNA" | "SV")[];
  /** the profiles are not known yet: the Mutational Signatures tab, which they decide, follows */
  partial?: boolean;
}

export const PATIENT_COHORT = "Patient";
export const SAMPLE_COHORT = "Sample";

/** a mutational-signature generic-assay profile, which the portal's Mutational Signatures tab draws */
const signatureProfile = (catalog: ProfileInfo[]) =>
  catalog.find((p) => p.type === "GENERIC_ASSAY" && /signature/i.test((p.assayType || "") + " " + p.profile)) || null;

/** The Patient page as the portal has it, for this patient. */
export function patientLayout(q: PatientQuery, data: PatientData): PageLayout {
  const name = q.sample ? SAMPLE_COHORT : PATIENT_COHORT;
  const cohorts = [name];
  const v = (title: string, view: Record<string, unknown>) => ({ title, view: { ...view, cohorts } as unknown as View });
  const genomic = data.held.length > 0;
  const signatures = signatureProfile(data.profileCatalog);
  const left = [
    !genomic ? "Pathways (no mutation, copy-number or structural-variant data)" : null,
  ].filter(Boolean) as string[];
  return arrange({
    study: q.study,
    cohorts: { [name]: { study: q.study, all: [q.sample ? { kind: "sampleList", ids: [q.study + ":" + q.sample] } : { kind: "patientList", ids: [q.study + ":" + q.patient] }] } },
  }, [
    // Summary: the clinical timeline, then the genomic overview, then the patient's alteration tables
    { title: "Summary", views: [
      v("Clinical timeline", { kind: "timeline" }),
      ...(data.held.includes("CNA") ? [v("Genomic overview", { kind: "genome" })] : []),
      // in sample mode, the sample's alterations alone, as the portal's sample view lists them
      ...(genomic ? [v("Genomic alterations", { kind: "alterations", ...(q.sample ? { samples: "cohort" } : {}) })] : []),
    ] },
    ...(genomic ? [{ title: "Pathways", views: [v("Canonical pathways", { kind: "pathways", measure: "any" })] }] : []),
    { title: "Clinical Data", views: [
      v("Patient", { kind: "table", unit: "patient" }),
      v("Samples", { kind: "table", unit: "sample" }),
    ] },
    ...(q.sample ? [] : [{ title: "Genomic Evolution", views: [], pending: "Each alteration's allele frequency across the patient's samples, in sample order, as a line per alteration and a heatmap — the portal's Genomic Evolution tab, for a patient with more than one sample." }]),
    ...(signatures ? [{ title: "Mutational Signatures", views: [], pending: "The patient's samples' signature contributions from " + signatures.profile + ", as the portal's Mutational Signatures tab draws them: a bar per signature, and the 96-channel spectrum." }] : []),
    { title: "Files & Links", views: [], pending: "Links out for the patient and each sample: the study's resource data (pathology reports, slide images) as the portal's Files & Links tab lists them." },
    { title: "Clinical Trials", views: [], pending: "Trials the patient's OncoKB-annotated alterations and cancer type match, as the portal's Clinical Trials tab lists them." },
  ], left, { partial: data.partial });
}
