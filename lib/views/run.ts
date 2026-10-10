// What every view runner shares: the run's context, the refusal that skips timing, the limits.
import type { AnalysisDoc, ViewResult } from "../types.ts";
import type { ViewCtx } from "../views-more.ts";

/** one view of a document, as authored */
export type DocView = NonNullable<AnalysisDoc["views"]>[number];

/** What runAnalysis hands each view: its cohorts evaluated, their resolvers, and how it was asked to answer. */
export interface ViewRun extends ViewCtx {
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

/** 12 genes = 66 pairs; beyond this the multiplicity correction eats the signal */
export const COOCCUR_GENE_LIMIT = 12;
/**
 * A request past a view's limit is refused, naming the limit, rather than cut to its first N:
 * a document (or a chat/MCP client writing one) that asks for 25 genes and silently gets 20
 * reads the result as an answer about all 25.
 */
export function overLimit(what: string, max: number, given: number): string | null {
  return given > max ? what + " takes at most " + max + "; this asks for " + given + " — remove " + (given - max) +
    " rather than have the rest silently ignored" : null;
}

