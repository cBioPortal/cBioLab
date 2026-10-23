"use client";
// The analysis page's view cards: each view's card is its kind's own (app/lab/kinds/<kind>.tsx) or the
// shared one (kind-cards.tsx), inside what every card has — the waiting cover, the queries, the error.
// The page hands every card the same ViewCtx — the document, the result and the edits a card can
// make — so a card holds no state of its own beyond what its body needs.
import { useLayoutEffect, useRef, useState } from "react";
import { KindCard, drawsOwnWaiting } from "./kind-cards";
import { kindUi } from "./kinds/index.ts";
import { placement } from "./kinds/parts.tsx";
import type { ColumnSelection } from "../_oncoprint/OncoprintFigure.tsx";
import type { UnpackedContract } from "../../lib/oncoprint-binary.ts";
import { type AnalysisDoc, type AnalysisResult, type ExploreResult } from "../../lib/types.ts";
import { MethodPanel } from "./method-panel.tsx";
import { viewRequest } from "./use-analysis.ts";
import { ViewHead, Participation } from "./view-chrome.tsx";
import type { ProfileInfo } from "../../lib/profile-catalog.ts";
import { ErrorAlert } from "../_ui/error-alert.tsx";
import type { OncoprintView } from "../../lib/views/oncoprint/types.ts";

type ResultView = AnalysisResult["views"][number];
type ViewChoice = NonNullable<React.ComponentProps<typeof ViewHead>["cohorts"]>;
type EventOption = { canonical: string; label: string; n: number; perPatient?: number; hasDurations?: boolean };

/** What every card reads from the page and the edits it can make — the page builds one per render. */
export interface ViewCtx {
  doc: AnalysisDoc;
  /** the study the page falls back to when the document names none (use-analysis.ts sends it) */
  study: string;
  result: AnalysisResult;
  /** each view's id, in the document's order: what a card is keyed by */
  viewIds: (string | number)[];
  /** step the document back one change: what an errored view offers */
  docHistory: { undo: () => void; canUndo: boolean };
  /** the ids of views whose own re-run is in flight */
  pendingKeys: Set<string | number>;
  /** a full document run is in flight */
  busy: boolean;
  explore: ExploreResult | null;
  /** the study catalog: endpoints and event types (survival, course, sequence controls) */
  cat: any;
  catLoading: boolean;
  trackAttrs: { key: string; attrs: { attribute: string; kind: string; patients: number }[]; profiles: string[]; gaProfiles: string[] };
  trackAttrsLoading: boolean;
  contracts: Record<string, UnpackedContract>;
  setContracts: React.Dispatch<React.SetStateAction<Record<string, UnpackedContract>>>;
  menuOpenRef: React.MutableRefObject<Map<string, boolean>>;
  VIEW_KINDS: { kind: string; label: string; why?: () => string | null; loading?: () => boolean }[];
  catalogAttrs: () => { attribute: string; kind: string }[];
  attrsLoading: () => boolean;
  profileOptions: () => string[];
  /** the studies' profiles as they describe them, for a plot axis's Data picker */
  profileCatalog: () => ProfileInfo[];
  assayOptions: () => string[];
  viewEvents: () => EventOption[];
  drawsOwnHead: (v: any) => boolean;
  /** the most cohorts a view of this kind draws at once */
  maxCohortsOf: (kind: string) => number | undefined;
  /** the view as the document holds it (the result's copy may lag an edit) */
  docView: (vi: number) => any;
  ocView: (vi: number) => OncoprintView;
  cohortChoice: (vi: number, v: any, max?: number) => ViewChoice;
  /** edits that re-run the view */
  patchView: (vi: number, patch: Record<string, unknown>) => void;
  updateView: (vi: number, patch: (v: any) => any) => void;
  /** an edit applied in the browser alone (re-runs nothing) */
  updateViewLocal: (vi: number, patch: (v: any) => any) => void;
  setViewAttrs: (vi: number, attributes: string[]) => void;
  setViewCohorts: (vi: number, names: string[], all: string[]) => void;
  moveView: (vi: number, dir: -1 | 1) => void;
  removeView: (vi: number) => void;
  noteEdit: (vi: number) => (() => void) | undefined;
  openGenes: (vi: number) => void;
  /** open "+ Add cohort" for the view at vi */
  openCohortChooser: (vi: number) => void;
  cohortFromSelection: (sel: ColumnSelection, studies: string[]) => Promise<void>;
  featureFromSelection: (sel: ColumnSelection, all: string[], studies: string[]) => Promise<void>;
}
export type CardProps = { ctx: ViewCtx; v: ResultView; vi: number };

export function Updating() {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const card = ref.current?.parentElement;
    if (!card) return;
    const measure = () => {
      const at = card.getBoundingClientRect().top;
      let bottom = 0;
      card.querySelectorAll(":scope > .vhead, :scope > .viewtb, :scope > .viewtb-more, :scope > .basis")
        .forEach((n) => { bottom = Math.max(bottom, n.getBoundingClientRect().bottom - at); });
      setTop(bottom ? bottom + 6 : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(card);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="view-updating" style={{ top }} role="status" aria-live="polite">
      <div className="loading-block"><span className="spinner" /> updating…</div>
      <div className="skeleton" />
    </div>
  );
}

/** One view of the analysis, as a card: the waiting cover, the kind's own body, its queries, its error. */
export function ViewCard({ ctx, v, vi }: CardProps) {
  const { busy, pendingKeys, viewIds } = ctx;
  // a view with no result yet to keep showing draws its header and a skeleton, whatever its kind
  if ((v as any).pending) return <LoadingViewCard ctx={ctx} vi={vi} />;
  return (
    <div className="card viewcard">
    {/* recomputing this view (a settings change), or the whole document */}
    {!(drawsOwnWaiting(v.kind) && !v.error) && (busy || pendingKeys.has(viewIds[vi])) && <Updating />}
      <KindBody ctx={ctx} v={v} vi={vi} />
      <QueriesPanel ctx={ctx} v={v} vi={vi} />
      <ErrorHead ctx={ctx} v={v} vi={vi} />
      <ErrorNote ctx={ctx} v={v} vi={vi} />
    </div>
  );
}

/** the title a view's header carries once drawn, so its loading card reads the same */
export const viewHeadTitle = (kind: string): string => kindUi(kind)?.title ?? kind;

/** A view still waiting for its first result: its header, then a skeleton where the figure will be. */
export function LoadingViewCard({ ctx, vi }: { ctx: Omit<ViewCtx, "result">; vi: number }) {
  const { cohortChoice, doc, docView, maxCohortsOf, menuOpenRef, moveView, removeView, noteEdit } = ctx;
  const spec = docView(vi);
  const n = (doc.views || []).length;
  const max = maxCohortsOf(spec.kind);
  return (
    <div className="card viewcard viewloading" aria-busy="true">
      <ViewHead menuStore={menuOpenRef.current} v={{ kind: spec.kind, annotationNote: typeof spec.note === "string" ? spec.note.trim() || undefined : undefined }}
        title={viewHeadTitle(spec.kind)} cohorts={{ ...cohortChoice(vi, spec, max), busy: true }}
        onMoveUp={vi > 0 ? () => moveView(vi, -1) : undefined} onMoveDown={vi < n - 1 ? () => moveView(vi, 1) : undefined}
        onRemove={() => removeView(vi)} onEditNote={noteEdit(vi)} />
      <div className="skeleton skeleton-view" />
    </div>
  );
}

function KindBody(p: CardProps) {
  const ui = kindUi(p.v.kind);
  if (!ui) return null;
  return ui.Card ? <ui.Card {...p} /> : <KindCard {...p} />;
}

function QueriesPanel({ ctx, v, vi }: CardProps) {
  return <>
    {v.queries && v.queries.length > 0 && (
      <details className="provsql">
        <summary className="meta">
          how these numbers were computed — {v.queries.length} {v.queries.length === 1 ? "query" : "queries"}
          {v.ms != null && <> in {v.ms.toLocaleString()}ms</>}
          {v.method && <> · {v.method.steps.length} computation steps</>}
          {v.queries.some(q => q.remote) && <> · <span className="prem">{v.queries.filter(q => q.remote).length} ran on a peer</span></>}
        </summary>
        {v.queries.map((q, qi) => (
          <div className="provq" key={qi}>
            <div className="provhead">
              <code>{q.label}</code>
              <span className="meta">{q.study}</span>
              {q.ms != null && <span className="meta">{q.ms.toLocaleString()}ms</span>}
              {q.remote && <span className="prem" title="compiled and executed by the peer against its own schema; only aggregates came back">ran on peer</span>}
            </div>
            <pre>{q.sql}</pre>
          </div>
        ))}
        {v.method && <MethodPanel method={v.method} source={{ doc: ctx.doc, index: vi, kind: v.kind, request: viewRequest(ctx.doc, vi, ctx.study) }} />}
      </details>
    )}
  </>;
}

function ErrorHead({ ctx, v, vi }: CardProps) {
  const { VIEW_KINDS, cohortChoice, docView, drawsOwnHead, menuOpenRef } = ctx;
  return <>
    {v.error && !drawsOwnHead(v) && <ViewHead menuStore={menuOpenRef.current} v={v}
      title={(VIEW_KINDS.find((k) => k.kind === v.kind) || { label: v.kind }).label}
      cohorts={cohortChoice(vi, docView(vi))}
      {...placement(ctx, vi, false)} />}
  </>;
}

function ErrorNote({ ctx, v }: CardProps) {
  const { docHistory } = ctx;
  return <>
    {v.error && <ErrorAlert onUndo={docHistory.canUndo ? docHistory.undo : undefined}>{v.kind}: {v.error}{v.participation ? <> <>{v.ms != null && (
          <span className="lat" title={
            "Server-side wall-clock for this view. Its queries run concurrently, so this is not their sum, and it excludes rendering in your browser." +
            (v.renderMs != null ? "\n\n" + (v.ms - v.renderMs).toLocaleString() + "ms querying · " + v.renderMs.toLocaleString() + "ms drawing the SVG on the server." : "")}>
            {v.ms.toLocaleString()}ms
            {v.renderMs != null && <span className="latsplit"> ({(v.ms - v.renderMs).toLocaleString()} + {v.renderMs.toLocaleString()} draw)</span>}
          </span>
        )}<Participation p={v.participation} /></></> : null}</ErrorAlert>}
  </>;
}
