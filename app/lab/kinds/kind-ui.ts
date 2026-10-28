// What the analysis page knows about one view kind (app/lab/kinds/<kind>.tsx, listed in
// app/lab/kinds/index.ts): its add-menu entry, the view a new one starts from, how many cohorts it
// draws, and its card — either the shared card (app/lab/kind-cards.tsx) with this kind's subtitle,
// controls and body, or a card of its own.
import type { ReactNode } from "react";
import type { ViewKind } from "../../../lib/types.ts";
import type { CardProps } from "../view-cards.tsx";
import type { ProfileInfo } from "../../../lib/profile-catalog.ts";

/** What the page knows about the study before a view is added. */
export interface Known {
  genes: string[]; attrs: { attribute: string; kind: string }[]; profiles: string[];
  /** generic-assay profiles (mutational signatures, arm-level CNA, …) */
  assays: string[];
  events: { canonical: string; label: string; n: number; perPatient?: number; hasDurations?: boolean }[]; cohorts: string[];
}

/** What a kind's add button may also ask of the page: its catalogs' state and what they offer. */
export interface MenuPage {
  catLoading: boolean;
  exploreBusy: boolean;
  trackAttrsLoading: boolean;
  /** why survival and Cox have no endpoint to fit in this study, or null (use-view-options.ts) */
  noSurvivalWhy: () => string | null;
  viewAttrs: () => string[];
  contProfile: () => string | null;
  attrsLoading: () => boolean;
}

/** What a new view's defaults may also ask of the page. */
export interface AddPage {
  viewAttrs: () => string[];
  contProfile: () => string | null;
  numericAttrs: () => string[];
}

/** What the shared card hands a kind's controls and body: the view as written, its result, and a way to edit it. */
export interface KindCardCtx {
  vi: number;
  /** the view as the DOCUMENT holds it (never the result, which has different fields) */
  spec: any;
  /** the view's result */
  v: any;
  busy: boolean;
  /** a request for this view is running (its own re-run, or the whole document's) — a view that draws its own
   *  waiting state (drawsOwnWaiting) shows it; for the rest the page covers the card */
  updating?: boolean;
  patch: (p: Record<string, unknown>) => void;
  attrs: { attribute: string; kind: string }[];
  profiles: string[];
  assays: string[];
  /** every profile as the studies describe them, for a field that searches a generic assay's entities */
  catalog?: ProfileInfo[];
  events: { canonical: string; label: string; n: number }[];
  /** the document as it stands, for a table's download */
  docJson?: () => string;
  /** settings the surrounding page controls for every view at once (a portal tab's gene chips), so not offered here */
  locked?: string[];
  /** the page shows one patient (the Patient page): a patient view draws them without the navigator through the cohort's others */
  fixedPatient?: boolean;
}

/** The add-view dialog's categories, in its sidebar's order. */
export const VIEW_CATEGORIES = [
  { id: "overview", label: "Cohort overview" },
  { id: "alterations", label: "Mutations & alterations" },
  { id: "copynumber", label: "Copy number & genome" },
  { id: "expression", label: "Expression & assays" },
  { id: "outcomes", label: "Survival & outcome models" },
  { id: "treatment", label: "Treatment & clinical course" },
  { id: "evolution", label: "Tumor evolution & metastasis" },
  { id: "clinical", label: "Clinical genomics" },
  { id: "patient", label: "Single patient" },
] as const;
export type ViewCategory = (typeof VIEW_CATEGORIES)[number]["id"];

export interface KindUi<K extends ViewKind = ViewKind> {
  kind: K;
  /** its entry in the add-view menu */
  label: string;
  /** where the add-view dialog lists it */
  category: ViewCategory;
  /** its card's title */
  title: string;
  /** a gene list edited through the page's shared gene dialog */
  genes?: boolean;
  /** the most cohorts this view can draw at once */
  maxCohorts?: number;
  /** the fewest it compares; an empty view says so beside its "+ Add cohort" */
  minCohorts?: number;
  /** the header's subtitle names the one cohort drawn, so the header leaves out its "Showing" line */
  cohortInHeader?: boolean;
  /** why the add button is disabled for this study, or null when it can be added */
  why?: (known: Known, page: MenuPage) => string | null;
  /** the data `why` decides on is still being fetched, so the button waits with a spinner rather than
   *  guessing (without one: no molecular profiles yet while a catalog loads) */
  loading?: (known: Known, page: MenuPage) => boolean;
  /** the view a fresh "add view" click starts from, built from what the study is known to have ({ kind } without one) */
  defaults?: (known: Known, page: AddPage) => Record<string, unknown>;

  /** a card of its own, in place of the shared one */
  Card?: (p: CardProps) => ReactNode;
  /** whether its own Card draws the header (and with it the remove/move controls) for this result; the shared card always does */
  drawsOwnHead?: (v: any) => boolean;

  /** the shared card's one-line subtitle */
  sub?: (spec: any, v: any) => ReactNode;
  /** the shared card's settings row */
  Controls?: (p: { c: KindCardCtx }) => ReactNode;
  /** a body of the kind's own in place of the figure, or null to draw the figure */
  body?: (c: KindCardCtx) => ReactNode;
  /** the result as the figure draws it: settings applied in the browser (dataPart) read from the document, not the last run */
  figureView?: (spec: any, v: any) => any;
  /** it shows its own waiting state (the table views: their search, filters and headers stay usable while the rows are
   *  covered), so the page must not cover the card with its own */
  drawsOwnWaiting?: boolean;
}
