"use client";
// What the analysis page offers for building views, from the study catalog and the clinical-
// attribute catalog (use-catalogs.ts) or Explore's facets when those are loaded: the genes,
// attributes, events and molecular profiles a picker lists, which view kinds can be added
// (VIEW_KINDS, each with why it cannot when it cannot, and whether that is still being
// fetched), and which kinds draw their own header. Read-only: it edits nothing.
import { MORE_KINDS, isMoreKind } from "./more-views";
import type { AnalysisDoc, AnalysisResult } from "../../lib/types.ts";
import { foldEventNames } from "../../lib/event-names.ts";
import { LINE_TYPE } from "../../lib/treatment-lines.ts";
import type { ExploreResult } from "../../lib/types.ts";
import type { TrackAttrs } from "./use-catalogs.ts";

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
}

export function useViewOptions(page: ViewOptionsPage) {
  const { cat, catLoading, doc, explore, exploreBusy, result, trackAttrs, trackAttrsLoading } = page;

  // ---- composing views without editing JSON --------------------------------
  /** Genes to prefill a new view with: whatever the document already studies,
   *  else the most-altered genes from the current exploration. */
  const viewGenes = (): string[] => {
    const inDoc = (doc.views || []).flatMap((v: any) => v.genes || []).map(String);
    if (inDoc.length) return [...new Set(inDoc)].slice(0, 6);
    if (explore && explore.genes && explore.genes.length) return explore.genes.slice(0, 6).map((g: any) => g.gene);
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
  /**
   * `loading`: the data this button's `why` decides on is still being fetched. The button waits
   * with a spinner rather than guessing — enabling it could add a view that can only error, and
   * `why` alone would call a study empty when its catalog simply hasn't arrived.
   */
  const VIEW_KINDS: { kind: string; label: string; why?: () => string | null; loading?: () => boolean }[] = [
    { kind: "compare", label: "Compare genes" },
    { kind: "survival", label: "Survival", why: noSurvivalWhy, loading: () => catLoading },
    { kind: "cox", label: "Cox regression (forest plot)", why: noSurvivalWhy, loading: () => catLoading },
    { kind: "logistic", label: "Logistic regression (odds ratios)" },
    { kind: "oncoprint", label: "Oncoprint" },
    { kind: "hotspots", label: "Lollipop (hotspots)" },
    { kind: "plot", label: "Plot", loading: attrsLoading,
      why: () => viewAttrs().length ? null : "this study declares no clinical attributes to plot" },
    { kind: "cooccurrence", label: "Co-occurrence" },
    { kind: "clinical", label: "Clinical comparison", loading: attrsLoading,
      why: () => viewAttrs().length ? null : "this study declares no clinical attributes to compare" },
    { kind: "coexpression", label: "Co-expression", loading: () => !contProfile() && (trackAttrsLoading || exploreBusy),
      why: () => contProfile() ? null : "this study has no continuous molecular profile (mRNA z-scores) to correlate" },
    { kind: "course", label: "Clinical course", loading: () => !viewEvents().length && (catLoading || exploreBusy),
      why: () => viewEvents().length ? null
        : "this study records no timeline events (only 131 of 545 studies have any)" },
    { kind: "sequence", label: "Treatment sequence", loading: () => !viewEvents().length && (catLoading || exploreBusy),
      why: () => viewEvents().some(e => /treat|therap|regimen|drug|medicat/.test(e.canonical)) ? null
        : "this study records no treatment events, so there are no lines of therapy to sequence" },
    ...Object.entries(MORE_KINDS).map(([kind, k]) => ({ kind, label: k.label,
      ...(k.why ? { why: () => k.why!({ genes: [], attrs: catalogAttrs(), profiles: profileOptions(), assays: assayOptions(), events: viewEvents(), cohorts: Object.keys(doc.cohorts || {}) }),
                    loading: () => !profileOptions().length && (trackAttrsLoading || exploreBusy) } : {}) }))
  ];

  /**
   * Whether this view's own block renders its header (and with it the remove/move controls).
   * Most kinds only draw theirs once they have data, so a view that came back with only an error
   * would otherwise be a bare red box the reader can't remove without editing the JSON.
   */
  const drawsOwnHead = (v: any): boolean =>
    isMoreKind(v.kind) || v.kind === "cox" || v.kind === "logistic" || v.kind === "plot" ||
    (v.kind === "compare" && !!v.rows) || (v.kind === "hotspots" && !!v.hotspots) ||
    (v.kind === "coexpression" && !!v.coexpression) || (v.kind === "clinical" && !!v.clinical) ||
    (v.kind === "cooccurrence" && !!v.pairs) || (v.kind === "survival" && !!v.curves) ||
    ((v.kind === "sequence" || v.kind === "course") && !!v.svg) || (v.kind === "oncoprint" && !!v.spec);

  /**
   * The gene list of a view, editable in place.
   *
   * Genes used to be settable only by hand-editing the document JSON: addView
   * seeded them from the most-altered genes in Explore (or a hardcoded fallback)
   * and nothing could change them afterwards. Five view kinds take genes, so
   * this is one control rendered in each one's settings panel rather than five
   * near-identical ones.
   */
  const GENE_VIEWS = ["compare", "oncoprint", "cooccurrence", "coexpression", "hotspots"];
  /** the most-altered genes this exploration found, for the suggestion list */
  const geneChoices = (): string[] => {
    const fromExplore = (explore?.mutatedGenes || []).map((g: any) => String(g.gene));
    const legacy = (explore?.genes || []).map((g: any) => String(g.gene));
    return [...new Set([...fromExplore, ...legacy])].slice(0, 60);
  };

  return { viewGenes, viewAttrs, viewEvents, catalogAttrs, numericAttrs, attrsLoading, profileOptions, assayOptions, contProfile, noSurvivalWhy, VIEW_KINDS, drawsOwnHead, GENE_VIEWS, geneChoices };
}
