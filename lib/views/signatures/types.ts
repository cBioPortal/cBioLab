// The signatures view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { TableRows, TimelineResult } from "../../types.ts";
import type { TableQuery } from "../../table-query.ts";

/**
 * One patient's mutational signatures — cBioPortal's patient-view Mutational Signatures tab: for one
 * signature type (the study's `mutational_signatures_contribution_<type>` generic-assay profile —
 * SBS, DBS, ID, v2, v3), each signature's contribution in each of the patient's samples, marked
 * significant where the study's matching p-value profile puts it under 0.05; and, where the study
 * has the matching counts profile, one sample's mutational spectrum (its mutations by channel, the
 * 96 trinucleotide substitutions for SBS). The cohort's patients with signature values are listed to
 * choose from. Everything names a patient, so only a patient-level participant contributes.
 */
export interface SignaturesView extends TableQuery {
  note?: string;
  kind: "signatures"; cohorts?: string[];
  /** the patient drawn; with none, the list's first row */
  patient?: { study: string; id: string };
  /** patients per page of the list (default 25, at most 1000) */
  rows?: number;
  /** the signature type: what follows mutational_signatures_contribution_ in the profile (SBS, DBS, ID, v2, v3); default as the portal picks */
  version?: string;
  /** the sample whose spectrum is drawn; default the patient's first sample (in sample order) with counts */
  sample?: string;
  /** the spectrum's bars: "percent" of the sample's mutations of this type (the default, as the portal) or "count" */
  scale?: "percent" | "count";
  /**
   * which of the patient's samples are read: every one ("patient", the default — the portal's patient
   * view) or only the cohort's ("cohort" — its sample view, for a cohort of one sample)
   */
  samples?: "patient" | "cohort";
}

/** One signature's value in one sample: its contribution (a fraction of the sample's mutations) and, where the study records one, its p-value. */
export interface SignatureValue {
  /** null: the sample has no number for it (NA, or no row) */
  value: number | null;
  p: number | null;
}
/** One signature of the profile, with its value in each profiled sample (aligned with `profiled`). */
export interface SignatureRow {
  entity: string; name: string; description: string; url: string;
  values: SignatureValue[];
}
/** One channel of a sample's mutational spectrum: its label (the profile's NAME, e.g. A[C>A]A), its class and the mutations counted. */
export interface SpectrumChannel {
  entity: string; label: string;
  /** the class it is coloured and grouped by: the substitution (C>A), the dinucleotide (CC>NN), the indel kind (1bp deletion) */
  group: string;
  count: number;
}
export interface SignaturesResult extends TableRows<string | number | null> {
  /** the patient drawn, with every sample they have (in sample order), or null when the list is empty */
  patient: { study: string; id: string; samples: { id: string; type: string; label: string }[] } | null;
  /** where that patient falls in the list's order, and the patients either side (as the timeline's) */
  position?: TimelineResult["position"];
  /** the signature types the patient has values for, in the selector's order */
  versions: string[];
  /** the type drawn, and its profiles in the study */
  version: string | null;
  profiles: { contribution: string; pvalue: string | null; counts: string | null } | null;
  /** the samples with a value in the contribution profile, in sample order — the table's columns */
  profiled: string[];
  /** the patient's samples (as the view reads them) with none: the portal's "not profiled for mutational signatures" */
  notProfiled: string[];
  /** every signature of the profile with a value in some profiled sample; first profiled sample's contribution, highest first */
  signatures: SignatureRow[];
  /** one sample's spectrum, when the study has the counts profile and the sample has counts */
  spectrum: { sample: string; total: number; channels: SpectrumChannel[] } | null;
  /** why there is no spectrum, when there is none */
  noSpectrum?: string;
  /** the samples with counts, any of which `sample` may name */
  counted: string[];
  scale: "percent" | "count";
}

declare module "../../types.ts" {
  interface ViewSpecs { signatures: SignaturesView }
  interface ViewResultFields {
    signatures: {
      signatures?: SignaturesResult;
    };
  }
  interface ViewResultMain { signatures: "signatures" }
}
