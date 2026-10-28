// Helpers several view runners share: limits, which participants can answer a view aggregate,
// refusals, and lookups more than one view makes.
import { plainResult, type ViewResult, type ViewKind } from "../types.ts";
import { survivalLeftOutSql } from "../survival-queries.ts";
import { hasViewAggregates, type Resolver, type ViewAggregateCapable } from "../federation.ts";
import { geneCytobandsSql } from "../federation-views.ts";
import type { ViewRun } from "./run.ts";
import type { StudyCatalog } from "../plot-profile.ts";
import { VIEW_ATTR_RE } from "../custom-data-names.ts";
import type { PlotAxis } from "../plot.ts";
import { assayEntitySearchSql } from "../generic-assay.ts";

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
 * cannot (a remote federation peer, which does not serve these aggregates yet). The second list is
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
 * Each assay axis checked against the studies it is drawn over and labelled with its entity's
 * display name where the study gives one ("SBS4 (Smoking)" rather than its stable id). An entity
 * its profile lacks in any study is refused, offering the entities whose names come closest,
 * rather than drawn as a plot with no values. A study whose participant cannot answer metadata is
 * left to the view's own coverage note. Every other axis is returned as it was.
 */
export async function assayEntitiesKnown<T extends PlotAxis | undefined>(c: ViewRun, axes: Record<string, T>, studies: string[]): Promise<Record<string, T>> {
  const out: Record<string, T> = { ...axes };
  for (const [which, a] of Object.entries(axes)) {
    if (!a || a.source !== "assay") continue;
    let name = "";
    for (const st of studies) {
      const r = c.resolvers[st];
      if (!r || !hasViewAggregates(r)) continue;
      const hits = await r.viewMeta("assay:entity", (s, d) => assayEntitySearchSql(s, d, a.profileType, a.entity, 6));
      const hit = hits.find((h) => String(h.entity) === a.entity);
      if (hit) { name ||= String(hit.name || ""); continue; }
      const near = hits.length ? hits : await r.viewMeta("assay:entities", (s, d) => assayEntitySearchSql(s, d, a.profileType, "", 6));
      throw new Error(which + " axis: " + st + "'s " + a.profileType + " has no entity '" + a.entity + "'" +
        (near.length ? "; " + (hits.length ? "closest" : "it has") + " " + near.map((h) => String(h.entity)).join(", ") + (Number(near[0].total) > near.length ? ", …" : "") : ""));
    }
    if (name && name !== a.entity && a.label && a.label.startsWith(a.entity + ": "))
      out[which] = { ...a, label: name + a.label.slice(a.entity.length) } as T;
  }
  return out;
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

/** a cohort whose left-out patients reach this share of it is drawn from incomplete follow-up, and the caveat says so */
export const LEFT_OUT_WARN_SHARE = 0.1;

/** the endpoint columns a view names: monthsAttribute/statusAttribute, else <endpoint>_MONTHS/_STATUS (default OS); null when malformed, which the runner refuses */
export function endpointColumnsOf(view: { endpoint?: unknown; monthsAttribute?: unknown; statusAttribute?: unknown }): { months: string; status: string } | null {
  if (view.monthsAttribute != null || view.statusAttribute != null) {
    const months = String(view.monthsAttribute || "").trim(), status = String(view.statusAttribute || "").trim();
    return ATTR_NAME.test(months) && ATTR_NAME.test(status) ? { months, status } : null;
  }
  const endpoint = String(view.endpoint || "OS").toUpperCase().trim();
  return /^[A-Z][A-Z0-9_]{0,39}$/.test(endpoint) ? { months: endpoint + "_MONTHS", status: endpoint + "_STATUS" } : null;
}

/**
 * The opening of a survival view's caveat: per cohort, the patients a survival analysis leaves out
 * for want of half an endpoint (lib/survival-sql.ts) — a usable time but no status, a status but no
 * usable time — with a warning when they reach LEFT_OUT_WARN_SHARE of the cohort. cBioPortal leaves
 * them out silently. A participant without view aggregates (a remote peer) is named as unknown.
 * Empty when there are none.
 */
export async function survivalLeftOutCaveat(ctx: ViewRun, months: string, status: string): Promise<string> {
  const totals = new Map(ctx.vNames.map((n) => [n, { noStatus: 0, noTime: 0 }]));
  const unknown = new Set<string>();
  for (const { cohort: n, study: st, answer } of await askEachSite(ctx, ctx.resolvers, (n, _st, r) => hasViewAggregates(r)
    ? r.viewAggregate("survivalLeftOut:" + months, ctx.doc.cohorts[n], (cs, s, d) => survivalLeftOutSql(cs, s, d, months, status))
    : Promise.resolve(null))) {
    if (!answer) { unknown.add(st); continue; }
    const t = totals.get(n)!;
    t.noStatus += Number(answer[0]?.no_status || 0); t.noTime += Number(answer[0]?.no_time || 0);
  }
  const pl = (k: number) => k.toLocaleString("en-US") + " patient" + (k === 1 ? "" : "s");
  const per = ctx.vNames.filter((n) => totals.get(n)!.noStatus || totals.get(n)!.noTime).map((n) => {
    const { noStatus, noTime } = totals.get(n)!;
    const share = (noStatus + noTime) / Math.max(1, ctx.cohorts[n].count);
    return "“" + n + "”: " + [...(noStatus ? [pl(noStatus) + " with a time but no status"] : []), ...(noTime ? [pl(noTime) + " with a status but no usable time"] : [])].join(" and ") +
      (share >= LEFT_OUT_WARN_SHARE ? " (" + Math.round(100 * share) + "% of the cohort: the survival analysis is drawn from incomplete follow-up, and is biased if the missing are sicker or healthier than the rest)" : "");
  });
  return (per.length
    ? "Left out of the survival analysis (" + months + " / " + status + "), as on cBioPortal — a patient enters only with both a status and a time of at least 0, so a missing status is never read as censored: " + per.join("; ") + ". "
    : "") +
    (unknown.size ? "Not known for " + [...unknown].join(", ") + ", which send only their counts: how many of their patients lack a status or a time. " : "");
}
