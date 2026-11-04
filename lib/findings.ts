// A view's findings: its headline numbers as named, typed values a program can read without parsing
// the results text or the figure. A kind states its own in its descriptor (`findings` in
// lib/views/<kind>/kind.ts); a kind that does not falls back to the numbers its method record's
// script independently recomputes (`method.check`, lib/method.ts), under the script's own names.
// Every finding that the script recomputes names the check that does, so a reader can tell a
// verified number from a reported one. Browser-safe.
import type { ViewResult } from "./types.ts";

/** Bumped when a kind renames, removes or changes the meaning of a finding; adding one is not a change. */
export const FINDINGS_VERSION = 1;

export type FindingUnit = "patients" | "samples" | "events" | "months" | "percent" | "p" | "q" | "chi2" | "df";

export interface Finding {
  /** stable within its kind and FINDINGS_VERSION, e.g. "median_months", "logrank_p" */
  name: string;
  /** null when the number is undefined for this data (a median never reached, a test with no events) */
  value: number | null;
  /** what the number is about: the cohort, the gene, or both; absent for a view-wide number */
  cohort?: string;
  gene?: string;
  unit?: FindingUnit;
  /** for a p, q or statistic: the test it comes from */
  test?: string;
  /** the method record's check that recomputes this number from the queries' rows, when one does */
  checked?: string;
}

export interface ViewFindings {
  version: typeof FINDINGS_VERSION;
  kind: string;
  /** "kind": named by the kind; "method-check": the script's own names, a prototype's fallback */
  source: "kind" | "method-check";
  findings: Finding[];
  /** the view's caveat, which travels with its numbers so they are not read without it */
  caveat?: string;
}

/** The fallback: every number the method record's script recomputes, under its own name. */
export function checkFindings(v: ViewResult): Finding[] {
  return Object.entries(v.method?.check || {}).map(([name, c]) => ({ name, value: c.v, checked: name }));
}

/** `checked` set only when the method record really has that check: never claim a verification that is not there. */
export function verifiedBy(v: ViewResult, key: string): { checked?: string } {
  return v.method?.check && Object.hasOwn(v.method.check, key) ? { checked: key } : {};
}
