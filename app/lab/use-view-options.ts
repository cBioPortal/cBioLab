"use client";
// What the analysis page offers for building views, from the study catalog and the clinical-
// attribute catalog (use-catalogs.ts) or Explore's facets when those are loaded: the genes,
// attributes, events and molecular profiles a picker lists, which view kinds can be added
// (VIEW_KINDS, each with why it cannot when it cannot, and whether that is still being
// fetched), and which kinds draw their own header. Read-only: it edits nothing.
import { KIND_UI, kindUi, type AnyKindUi } from "./kinds/index.ts";
import type { Known, MenuPage, ViewCategory } from "./kinds/kind-ui.ts";
import type { AnalysisDoc, AnalysisResult } from "../../lib/types.ts";
import { foldEventNames } from "../../lib/event-names.ts";
import { LINE_TYPE } from "../../lib/treatment-lines.ts";
import type { ExploreResult } from "../../lib/types.ts";
import type { ProfileInfo } from "../../lib/profile-catalog.ts";
import type { StudyInfo, TrackAttrs } from "./use-catalogs.ts";
import { cantDraw, cohortStudies } from "../../lib/view-coverage.ts";

/** What useViewOptions needs from the analysis page. */
export interface ViewOptionsPage {
  cat: any;
  catLoading: boolean;
  doc: AnalysisDoc;
  explore: ExploreResult | null;
  exploreBusy: boolean;
  result: AnalysisResult | null;
  trackAttrs: TrackAttrs;
  trackAttrsLoading: boolean;
  /** the deployment's study list, each with its access; empty until it arrives */
  studies: StudyInfo[];
}

/**
 * The exploration's most-altered genes, from its mutation, CNA and SV tables: each gene ranked by
 * its largest on-panel altered count in any of them — samples whose call a covering panel made, as
 * the tables' frequencies count — which never counts a sample twice for carrying two kinds of call.
 */
function mostAlteredGenes(explore: ExploreResult | null | undefined): string[] {
  const best = new Map<string, number>();
  for (const rows of [explore?.mutatedGenes, explore?.cnaGenes, explore?.svGenes])
    for (const r of rows || []) best.set(r.gene, Math.max(best.get(r.gene) ?? 0, r.alteredOnPanel ?? r.altered));
  return [...best].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g]) => g);
}

export function useViewOptions(page: ViewOptionsPage) {
  const { cat, catLoading, doc, explore, exploreBusy, result, trackAttrs, trackAttrsLoading, studies } = page;

  // ---- what federation lets a view draw (lib/view-coverage.ts) --------------
  const accessById = new Map(studies.map((s) => [s.id, s.access]));
  /** the studies a cohort spans: the last result's, else its definition's */
  const studiesOf = (name: string): string[] =>
    result?.cohorts[name]?.studies ?? cohortStudies(doc.cohorts?.[name] as any, doc.study || "");
  /** why a view of `kind` cannot draw cohort `name` whole, or null */
  const cantDrawCohort = (kind: string, name: string): string | null => cantDraw(kind, studiesOf(name), (s) => accessById.get(s));
  /** a kind none of the document's cohorts can be drawn by is not offered; one some can is */
  const federationWhy = (kind: string): string | null => {
    const names = Object.keys(doc.cohorts || {});
    const reasons = names.map((n) => cantDrawCohort(kind, n));
    if (!names.length || reasons.some((r) => r == null)) return null;
    return names.length === 1 ? reasons[0] : "no cohort in this analysis can be drawn by it — " + names[0] + ": " + reasons[0];
  };

  // ---- composing views without editing JSON --------------------------------
  /** Genes to prefill a new view with: whatever the document already studies,
   *  else the most-altered genes from the current exploration. */
  const viewGenes = (): string[] => {
    const inDoc = (doc.views || []).flatMap((v: any) => v.genes || []).map(String);
    if (inDoc.length) return [...new Set(inDoc)].slice(0, 6);
    const top = mostAlteredGenes(explore);
    if (top.length) return top.slice(0, 6);
    return ["TP53", "KRAS", "EGFR", "PIK3CA"];
  };
  const viewAttrs = (): string[] => {
    const inDoc = (doc.views || []).flatMap((v: any) => v.attributes || []).map(String);
    if (inDoc.length) return [...new Set(inDoc)].slice(0, 5);
    return catalogAttrs().slice(0, 4).map((c) => c.attribute);
  };
  /**
   * Timeline event types this study actually has, most common first, folded by
   * case so `Treatment` and `TREATMENT` offer one choice — the same fold the
   * engine applies (lib/event-names.ts).
   */
  const viewEvents = (): { canonical: string; label: string; n: number; perPatient?: number; hasDurations?: boolean }[] => {
    // A course result knows this cohort's OWN timeline, including which types
    // carry durations; Explore only knows the study's. Prefer the former.
    const fromResult = (result && result.views || []).find((v: any) => v.eventOptions && v.eventOptions.length);
    if (fromResult) return (fromResult as any).eventOptions.map((e: any) =>
      ({ canonical: e.canonical, label: e.label, n: e.patients, perPatient: e.perPatient, hasDurations: e.hasDurations }));
    // Explore's events if it has been opened, else the study catalog's — a shared ?doc= link lands
    // on Analysis without ever fetching Explore, and the course/sequence buttons would otherwise
    // report "no timeline events" for a study that has plenty. The derived treatment-line type is
    // the catalog's own synthesis, not a recorded event type, so it isn't offered here.
    const raw: { type: string; n: number }[] = (explore && explore.events && explore.events.length) ? explore.events
      : ((cat && cat.types) || []).filter((t: any) => t.t !== LINE_TYPE).map((t: any) => ({ type: String(t.t), n: Number(t.n_pat) || 0 }));
    return foldEventNames(raw.map((e) => ({ name: String(e.type), n: e.n })))
      .map((f) => ({ canonical: f.canonical, label: f.label, n: f.n }));
  };
  /** a continuous profile for co-expression / heatmaps, if this study has one */
  /**
   * The clinical attribute catalog, for a plot's default axes. `trackAttrs` is the richer,
   * multi-study union (populated once a plot/clinical/cox/oncoprint view exists in the result),
   * but the very FIRST plot added to an empty document runs before any result exists to trigger
   * that fetch — so it falls back to Explore's own per-study facets, already in hand by the time
   * a reader has gotten as far as adding a view.
   */
  const catalogAttrs = (): { attribute: string; kind: string }[] =>
    trackAttrs.attrs.length ? trackAttrs.attrs : ((explore && explore.clinical) || []);
  /** the numeric clinical attributes this study declares, for a plot's default axes */
  const numericAttrs = (): string[] => catalogAttrs().filter((a) => a.kind === "num").map((a) => a.attribute);
  /** still waiting on an attribute catalog, and nothing to offer yet — show a loader, not "none" */
  const attrsLoading = (): boolean => !catalogAttrs().length && (trackAttrsLoading || exploreBusy);
  /** continuous molecular profiles for an axis picker: Explore's if loaded, else the shared catalog's */
  const profileOptions = (): string[] => (explore && explore.profiles && explore.profiles.length ? explore.profiles : trackAttrs.profiles);
  /** every profile as the studies describe them, for a plot axis's Data picker: Explore's if loaded, else the shared catalog's */
  const profileCatalog = (): ProfileInfo[] => (explore && explore.profileCatalog && explore.profileCatalog.length ? explore.profileCatalog : trackAttrs.profileCatalog);
  const assayOptions = (): string[] => (explore && explore.gaProfiles && explore.gaProfiles.length ? explore.gaProfiles : trackAttrs.gaProfiles);

  const contProfile = (): string | null => {
    const ps = profileOptions();
    return ps.find((p: string) => /zscore/i.test(p)) || ps.find((p: string) => /mrna|rna_seq/i.test(p)) || null;
  };

  /**
   * Survival and Cox both fit a <X>_MONTHS/<X>_STATUS endpoint. When every cohort lives in one
   * study and that study's catalog says it declares none (AACR GENIE's public release, say),
   * adding either view can only produce an error card, so the button says why instead. Unknown
   * (catalog not loaded, lookup failed, cohorts spanning several studies) leaves them enabled.
   */
  const noSurvivalWhy = (): string | null => {
    const studies = new Set(Object.values(doc.cohorts || {}).flatMap((c: any) =>
      Array.isArray(c?.studies) && c.studies.length ? c.studies : [c?.study || doc.study]));
    if (studies.size !== 1 || !cat || cat.study !== [...studies][0]) return null;
    if (!Array.isArray(cat.survivalEndpoints) || cat.survivalEndpoints.length) return null;
    return cat.study + " has no survival data (no <X>_MONTHS/<X>_STATUS pair), so there is no endpoint to fit";
  };
  /** what the page knows about the study, for an add button's `why` */
  const known = (): Known => ({ genes: [], attrs: catalogAttrs(), profiles: profileOptions(), assays: assayOptions(), events: viewEvents(), cohorts: Object.keys(doc.cohorts || {}) });
  const menuPage: MenuPage = { catLoading, exploreBusy, trackAttrsLoading, noSurvivalWhy, viewAttrs, contProfile, attrsLoading };
  /**
   * `loading`: the data this button's `why` decides on is still being fetched. The button waits
   * with a spinner rather than guessing — enabling it could add a view that can only error, and
   * `why` alone would call a study empty when its catalog simply hasn't arrived.
   */
  const VIEW_KINDS: { kind: string; label: string; category: ViewCategory; why?: () => string | null; loading?: () => boolean }[] = (Object.values(KIND_UI) as AnyKindUi[]).map((k) => ({ kind: k.kind, label: k.label, category: k.category,
    ...(k.why ? { why: () => k.why!(known(), menuPage),
                  loading: () => k.loading ? k.loading(known(), menuPage) : !profileOptions().length && (trackAttrsLoading || exploreBusy) } : {}) }))
  .map((k) => ({ ...k,
    // federation first: it decides whether the view can be drawn at all, the data whether it has anything to draw
    why: () => federationWhy(k.kind) ?? (k.why ? k.why() : null),
    loading: () => (!studies.length && Object.keys(doc.cohorts || {}).length > 0) || (k.loading ? k.loading() : false) }));

  /**
   * Whether this view's own block renders its header (and with it the remove/move controls).
   * Most kinds only draw theirs once they have data, so a view that came back with only an error
   * would otherwise be a bare red box the reader can't remove without editing the JSON.
   */
  const drawsOwnHead = (v: any): boolean => {
    const ui = kindUi(v.kind);
    return !!ui && (!ui.Card || !!ui.drawsOwnHead?.(v));
  };

  /** the most-altered genes this exploration found, for the suggestion list */
  const geneChoices = (): string[] => {
    return mostAlteredGenes(explore).slice(0, 60);
  };

  return { viewGenes, viewAttrs, viewEvents, catalogAttrs, numericAttrs, attrsLoading, profileOptions, profileCatalog, assayOptions, contProfile, noSurvivalWhy, VIEW_KINDS, drawsOwnHead, geneChoices, cantDrawCohort };
}
