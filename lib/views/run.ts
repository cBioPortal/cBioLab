// The contract between runAnalysis and the view runners: the context each view gets, and the refusal
// that skips timing.
import type { AnalysisDoc, ViewResult, ViewParticipation } from "../types.ts";
import type { Resolver } from "../federation.ts";

/** one view of a document, as authored */
export type DocView = NonNullable<AnalysisDoc["views"]>[number];

export interface EvaluatedCohort {
  studies: string[];
  perStudy: Record<string, { sql: string; count: number; mode: string }>;
  count: number;
  text: string;
}

/** What runAnalysis hands each view: its cohorts evaluated, their resolvers, and how it was asked to answer —
 *  everything a runner needs from it, and nothing it could use to bypass it. */
export interface ViewRun {
  doc: AnalysisDoc;
  cohorts: Record<string, EvaluatedCohort>;
  resolvers: Record<string, Resolver>;
  /** the cohorts this view reads, in document order */
  vNames: string[];
  /** every study those cohorts span */
  vStudies: string[];
  participationFor: (studies: string[], requiresPatientLevel: boolean) => ViewParticipation;
  pin: string | null;
  /** the molecular and generic-assay profiles a study holds (runAnalysis's cached inventory) */
  studyProfiles: (study: string) => Promise<{ profiles: string[]; gaProfiles: string[] }>;
  /** a paged view's page (the mutation and clinical tables): rows offset to offset + limit of its one global order */
  page?: { offset: number; limit: number };
  /** a table view's column whose values to return instead of rows (what its filter offers) */
  values?: string;
  /** the oncoprint's answer: a server-drawn figure, or the spec the web app draws from */
  oncoprint?: "svg" | "spec";
}

/** A view that stopped with an error before its answer: runAnalysis records it as it is, without timing or queries. */
export class Untimed {
  readonly result: ViewResult;
  constructor(result: ViewResult) { this.result = result; }
}
export const untimed = (result: ViewResult) => new Untimed(result);

export type ViewRunner = (view: DocView, c: ViewRun) => Promise<ViewResult | Untimed>;
