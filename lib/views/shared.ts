// Helpers several view runners share: limits, which participants can answer a view aggregate,
// refusals, and lookups more than one view makes.
import { plainResult, type ViewResult, type ViewKind } from "../types.ts";
import { hasViewAggregates, type Resolver, type ViewAggregateCapable } from "../federation.ts";
import { geneCytobandsSql } from "../federation-views.ts";
import type { ViewRun } from "./run.ts";
import type { StudyCatalog } from "../plot-profile.ts";
import { VIEW_ATTR_RE } from "../custom-data-names.ts";

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

/** a clinical attribute name as a view may name it: a built-in one, or an uploaded column (`custom:<dataset>/<COLUMN>`, lib/custom-data-names.ts) */
export const ATTR_NAME = VIEW_ATTR_RE;
/** a molecular or generic-assay profile type, as a view names it */
export const PROFILE_NAME = /^[A-Za-z0-9_.-]{1,96}$/;

/** The smallest 1, 2 or 5 × 10^k at or above x — an axis end a reader can read off. */
export function niceCeil(x: number): number {
  if (!(x > 0)) return 1;
  const k = Math.pow(10, Math.floor(Math.log10(x)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * k >= x - 1e-12) return m * k;
  return 10 * k;
}

export type ViewResolver = Resolver & ViewAggregateCapable;

/**
 * Split the view's studies into those that can answer (every local participant) and those that
 * cannot (a remote MCP peer, which does not serve these aggregates yet). The second list is
 * reported by the view, never silently dropped.
 */
export function answering(ctx: ViewRun): { ok: Record<string, ViewResolver>; excluded: { study: string; reason: string }[] } {
  const ok: Record<string, ViewResolver> = {};
  const excluded: { study: string; reason: string }[] = [];
  for (const st of ctx.vStudies) {
    const r = ctx.resolvers[st];
    if (hasViewAggregates(r)) ok[st] = r;
    else excluded.push({ study: st, reason: "a remote peer, which does not serve this view's aggregates yet" });
  }
  return { ok, excluded };
}

export const plural = (n: number, one: string, many = one + "s") => n.toLocaleString("en-US") + " " + (n === 1 ? one : many);

/** A view-level refusal: past a limit, or nothing that can answer. */
export const refuse = (kind: ViewKind, ctx: ViewRun, error: string): ViewResult => plainResult(kind, { cohorts: ctx.vNames, error });

/** Cytobands for the genes a table lists, from the first participant that can answer; a gene it
 *  does not know (or no answer at all) is left without one rather than failing the view. */
export async function cytobands(ok: Record<string, ViewResolver>, genes: string[]): Promise<Map<string, string>> {
  const first = Object.values(ok)[0];
  if (!first || !genes.length) return new Map();
  const rows = await first.viewMeta("cytobands", (s, d) => geneCytobandsSql(genes, s, d)).catch(() => []);
  return new Map(rows.map((r) => [String(r.gene), String(r.cytoband || "")]));
}

/** each study's profiles as it describes them, for resolving a profile axis (lib/plot-profile.ts) */
export async function studyCatalogs(c: ViewRun, studies: string[]): Promise<StudyCatalog[]> {
  return Promise.all(studies.map(async (st) => ({ study: st, catalog: (await c.studyProfiles(st)).catalog || [] })));
}

/**
 * Asks every (cohort, study) the view draws that `resolvers` holds, concurrently, and returns the
 * answers in the view's order (its cohorts, then each cohort's studies), never in the order they
 * finish. Combine them after this returns: combining inside `ask` as each answer lands makes the
 * result depend on which query finished first (test/support/view-snapshots.ts checks for that).
 */
export async function askEachSite<R, T>(ctx: ViewRun, resolvers: Record<string, R>,
  ask: (cohort: string, study: string, r: R) => Promise<T>): Promise<{ cohort: string; study: string; answer: T }[]> {
  const sites = ctx.vNames.flatMap((cohort) => ctx.cohorts[cohort].studies.filter((st) => resolvers[st]).map((study) => ({ cohort, study })));
  const answers = await Promise.all(sites.map((s) => ask(s.cohort, s.study, resolvers[s.study])));
  return sites.map((s, i) => ({ ...s, answer: answers[i] }));
}
