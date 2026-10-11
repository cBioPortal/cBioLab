"use client";
// The analysis page's view cards: one component per view kind, each drawing a view's result with
// its header and controls. The page hands every card the same ViewCtx — the document, the result
// and the edits a card can make — so a card holds no state of its own beyond what its body needs.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { HotspotsBody } from "../_lollipop/HotspotsBody.tsx";
import { KIND_CARDS, hasKindCard, kindSub, KindCardControls, KindCardBody, drawsOwnWaiting } from "./kind-cards";
import type { ColumnSelection } from "../_oncoprint/OncoprintFigure.tsx";
import { OncoprintCard, Waiting } from "../_oncoprint/OncoprintCard.tsx";
import type { UnpackedContract } from "../../lib/oncoprint-binary.ts";
import type { AnalysisDoc, AnalysisResult, OncoprintView, ExploreResult, KmCurve } from "../../lib/types.ts";
import { survivalAxis } from "../../lib/stats.ts";
import { MethodPanel } from "./method-panel.tsx";
import { AxisPicker, HighlightPicker, ViewHelpButton, SplitByNote, PickMenu, CohortPicker, DrawnCohorts, ViewHead, ViewMenu, Latency, CAT_COLORS, Participation, ServerSvg, ViewFigure } from "./view-chrome.tsx";


type ResultView = AnalysisResult["views"][number];
type ViewChoice = NonNullable<React.ComponentProps<typeof ViewHead>["cohorts"]>;
type EventOption = { canonical: string; label: string; n: number; perPatient?: number; hasDurations?: boolean };

/** What every card reads from the page and the edits it can make — the page builds one per render. */
export interface ViewCtx {
  doc: AnalysisDoc;
  result: AnalysisResult;
  /** each view's id, in the document's order: what a card is keyed by */
  viewIds: (string | number)[];
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
  assayOptions: () => string[];
  viewEvents: () => EventOption[];
  drawsOwnHead: (v: any) => boolean;
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
  cohortFromSelection: (sel: ColumnSelection, studies: string[]) => Promise<void>;
  featureFromSelection: (sel: ColumnSelection, all: string[], studies: string[]) => Promise<void>;
}
type CardProps = { ctx: ViewCtx; v: ResultView; vi: number };

/** p-values: exponent notation once fixed notation would round to zero, and an
 *  honest floor when the true value underflows double precision. Returns the
 *  whole "p=..." / "p<..." label so the relation stays attached to the number. */
const fmtP = (p: number): string =>
  p === 0 ? "p < 1e-300" : p < 1e-4 ? "p=" + p.toExponential(1) : "p=" + p.toFixed(4);

/** the same value for a table cell, where the column header already says "p" */
const pCell = (p: number): string =>
  p === 0 ? "< 1e-300" : p < 1e-4 ? p.toExponential(1) : p.toFixed(4);
/** true when two p-values land on opposite sides of the conventional threshold */
const crossesThreshold = (a: number, b: number): boolean => (a < 0.05) !== (b < 0.05);

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

export function KMChart({ curves, cutoffMonths, tickMonths, incidence }:
  { curves: KmCurve[]; cutoffMonths?: number; tickMonths?: number; incidence?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = 260;
    c.width = W * dpr; c.height = H * dpr; c.style.height = H + "px";
    const ctx = c.getContext("2d"); if (!ctx) return; ctx.scale(dpr, dpr);
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const grid = dark ? "#2a353c" : "#dde4e8", muted = dark ? "#93a3ad" : "#5b6b76";
    const L = 44, R = 10, T = 10, B = 28;
    const { tMax, step } = survivalAxis(curves, { cutoffMonths, tickMonths });
    const x = (t: number) => L + (W - L - R) * t / tMax, y = (s: number) => T + (H - T - B) * (1 - s);
    ctx.strokeStyle = grid; ctx.fillStyle = muted; ctx.font = "10px 'IBM Plex Sans',sans-serif";
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      ctx.beginPath(); ctx.moveTo(L, y(s)); ctx.lineTo(W - R, y(s)); ctx.stroke();
      ctx.fillText(Math.round(s * 100) + "%", 8, y(s) + 3);
    }
    for (let t = 0; t <= tMax; t += step) ctx.fillText(t + "mo", x(t) - 8, H - 10);
    curves.forEach((cv, i: number) => {
      ctx.strokeStyle = CAT_COLORS[i % CAT_COLORS.length]; ctx.lineWidth = 2; ctx.beginPath();
      let py = y(incidence ? 0 : 1); ctx.moveTo(x(0), py);
      for (const p of cv.points) { const nx = x(p.t), ny = y(p.s); ctx.lineTo(nx, py); ctx.lineTo(nx, ny); py = ny; }
      ctx.lineTo(x(tMax), py); ctx.stroke();
    });
  }, [curves, cutoffMonths, tickMonths, incidence]);
  return <canvas ref={ref} style={{ width: "100%", display: "block" }} />;
}

/** A card header's reorder and remove controls, and its note's when the analysis is saved. */
function placement({ result, moveView, removeView, noteEdit }: ViewCtx, vi: number, note = true) {
  return {
    onMoveUp: vi > 0 ? () => moveView(vi, -1) : undefined,
    onMoveDown: vi < result.views.length - 1 ? () => moveView(vi, 1) : undefined,
    onRemove: () => removeView(vi),
    ...(note ? { onEditNote: noteEdit(vi) } : {}),
  };
}

/** A regression view's covariates: each an axis, with the reference level its ratio is measured
 *  against once the fit has seen more than one level. */
function CovariateList({ covariates, ratio, observedLevels, busy, attrs, profiles, loading, onChange, onRemove, onAdd }: {
  covariates: any[]; ratio: "hazard" | "odds"; observedLevels: (ci: number) => string[]; busy: boolean;
  attrs: { attribute: string; kind: string }[]; profiles: string[]; loading: boolean;
  onChange: (ci: number, next: any) => void; onRemove: (ci: number) => void; onAdd: () => void;
}) {
  return (
    <div className="covlist">
      {covariates.map((c, ci) => {
        const levels = observedLevels(ci);
        return (
          <span key={ci} className="covrow">
            <AxisPicker side={"covariate " + (ci + 1)} axis={c} attrs={attrs}
              profiles={profiles} loading={loading} busy={busy}
              onChange={(next) => onChange(ci, next)} />
            {levels.length > 1 && <label className="tbfield" title={(ratio === "hazard" ? "the level a hazard ratio" : "the level an odds ratio") + " is measured against; unset uses this covariate's default (mutated/not always compares against 'Not mutated', other categoricals use whichever level is most frequent)"}>
              ref <select value={c.reference && levels.includes(c.reference) ? c.reference : ""} disabled={busy}
                onChange={e => onChange(ci, { ...c, reference: e.target.value || undefined })}>
                <option value="">(default)</option>
                {levels.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>}
            <button type="button" className="tbbtn" disabled={busy} title="remove this covariate"
              onClick={() => onRemove(ci)}>remove</button>
          </span>
        );
      })}
      <button type="button" className="tbbtn covadd" disabled={busy} onClick={onAdd}>+ add covariate</button>
    </div>
  );
}

/** One view of the analysis, as a card: the waiting cover, the kind's own body, its queries, its error. */
export function ViewCard({ ctx, v, vi }: CardProps) {
  const { busy, pendingKeys, viewIds } = ctx;
  return (
    <div className="card viewcard">
    {/* recomputing this view (a settings change), or the whole document */}
    {!(v as any).pending && !(drawsOwnWaiting(v.kind) && !v.error) && (busy || pendingKeys.has(viewIds[vi])) && <Updating />}
    {/* addView's placeholder for a brand-new view that has no prior
        result to keep showing while its own delta request is in
        flight (see addView) — every v.kind===… block below is
        already guarded on a kind-specific data field, so this
        placeholder object just falls through all of them silently;
        this is the only thing that needs to render for it. */}
    {(v as any).pending && <div className="skeleton skeleton-view" />}
      <KindBody ctx={ctx} v={v} vi={vi} />
      <QueriesPanel ctx={ctx} v={v} vi={vi} />
      <ErrorHead ctx={ctx} v={v} vi={vi} />
      <ErrorNote ctx={ctx} v={v} vi={vi} />
    </div>
  );
}

function KindBody(p: CardProps) {
  const k = p.v.kind;
  if (hasKindCard(k)) return <KindCard {...p} />;
  switch (k) {
    case "compare": return <CompareCard {...p} />;
    case "hotspots": return <HotspotsCard {...p} />;
    case "coexpression": return <CoexpressionCard {...p} />;
    case "clinical": return <ClinicalCard {...p} />;
    case "cooccurrence": return <CooccurrenceCard {...p} />;
    case "survival": return <SurvivalCard {...p} />;
    case "cox": return <CoxCard {...p} />;
    case "logistic": return <LogisticCard {...p} />;
    case "plot": return <PlotCard {...p} />;
    case "sequence": return <><SequenceKeyHint {...p} /><SequenceCard {...p} /></>;
    case "course": return <CourseCard {...p} />;
    case "oncoprint": return <OncoprintViewCard {...p} />;
    default: return null;
  }
}

function CompareCard({ ctx, v, vi }: CardProps) {
  const { busy, cohortChoice, docView, menuOpenRef, openGenes } = ctx;
  return <>
    {v.kind === "compare" && v.rows && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title="Compare" cohorts={cohortChoice(vi, docView(vi))} sub={<>alteration frequencies · {v.annotation}</>} {...placement(ctx, vi)}
        actions={<button className="linklike genesbtn" disabled={busy} title="choose the genes this view uses" onClick={() => openGenes(vi)}>genes</button>} />
      {v.note && <p className="note" title={(v.studies || []).join(", ") || undefined}
        style={v.studies && v.studies.length > 2 ? { cursor: "help", textDecorationLine: "underline", textDecorationStyle: "dotted" } : undefined}>{v.note}</p>}
      <div className="vscroll">
        <table className="vtable">
          <thead><tr>
            <th className="l">gene</th>
            {v.cohorts!.map((n, i: number) => <th key={n} className="r" style={{ color: CAT_COLORS[i] }}>{n}<br /><span className="thsub">driver / any</span></th>)}
            {v.rows![0] && v.rows![0].pAny != null && <th className="r">p (any)</th>}
            {v.rows![0] && v.rows![0].qAny != null && <th className="r">q (any)</th>}
          </tr></thead>
          <tbody>{v.rows.map(r => (
            <tr key={r.gene} className="ruled">
              <td className="bold">{r.gene}</td>
              {r.cells.map(c => {
                const bt = c.byType;
                const missing = bt && (["mutation", "cna", "structuralVariant"] as const)
                  .filter(t => bt[t].profiled === 0 && (bt.mutation.profiled > 0 || bt.cna.profiled > 0 || bt.structuralVariant.profiled > 0));
                const label = { mutation: "mutation", cna: "copy-number", structuralVariant: "structural-variant" };
                const title = bt ? "mutation " + bt.mutation.altered + "/" + bt.mutation.profiled +
                  " · copy-number " + bt.cna.altered + "/" + bt.cna.profiled +
                  " · structural-variant " + bt.structuralVariant.altered + "/" + bt.structuralVariant.profiled +
                  (missing && missing.length ? " — no " + missing.map(t => label[t]).join("/") + " data for this cohort's study" : "") : undefined;
                return (
                  <td key={c.cohort} className="r tnum" title={title}>
                    {c.driverPct}% / {c.anyPct}%{missing && missing.length ? <sup className="warnmark">*</sup> : null}
                  </td>
                );
              })}
              {r.pAny != null && <td className={"r tnum" + (r.pAny < 0.001 ? " bold" : "")}>{r.pAny < 1e-4 ? r.pAny.toExponential(1) : r.pAny.toFixed(3)}</td>}
              {r.qAny != null && <td className={"r tnum" + (r.qAny < 0.05 ? " bold" : "")}>{r.qAny < 1e-4 ? r.qAny.toExponential(1) : r.qAny.toFixed(3)}</td>}
            </tr>))}
          </tbody>
        </table>
      </div>
    </>}
  </>;
}

function HotspotsCard({ ctx, v, vi }: CardProps) {
  const { busy, cohortChoice, docView, menuOpenRef, openGenes, updateViewLocal } = ctx;
  return <>
    {v.kind === "hotspots" && v.hotspots && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title="Mutations" cohorts={cohortChoice(vi, docView(vi), 1)} sub="lollipop by protein position, as the portal's mutation tab draws it" {...placement(ctx, vi)}
        actions={<button className="linklike genesbtn" disabled={busy} title="choose the genes this view uses" onClick={() => openGenes(vi)}>genes</button>} />
      {/* the plot from the same renderer MCP uses (lib/view-svg.ts), with the gene summary and the
          alteration grid beside it as controls; the grid's selection re-runs nothing */}
      <HotspotsBody v={v} hide={docView(vi).hide} onHide={(h) => updateViewLocal(vi, (vv: any) => {
        const nx = { ...vv }; if (h) nx.hide = h; else delete nx.hide; return nx;
      })} />
    </>}
  </>;
}

function CoexpressionCard({ ctx, v, vi }: CardProps) {
  const { busy, cohortChoice, docView, explore, menuOpenRef, openGenes, updateView } = ctx;
  return <>
    {v.kind === "coexpression" && v.coexpression && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title="Co-expression" cohorts={cohortChoice(vi, docView(vi), 1)} sub="Pearson correlation from per-site sums" {...placement(ctx, vi)}
        actions={<>
          <label className="tbfield" title="the molecular profile the correlation is computed over">profile <select
            value={docView(vi).profileType || ""} disabled={busy}
            onChange={(e) => updateView(vi, (vv: any) => ({ ...vv, profileType: e.target.value }))}>
            {!((explore && explore.profiles) || []).includes(docView(vi).profileType || "") &&
              <option value={docView(vi).profileType || ""}>{docView(vi).profileType || "(none)"}</option>}
            {((explore && explore.profiles) || []).map((pt: string) => <option key={pt} value={pt}>{pt}</option>)}
          </select></label>
          <button className="linklike genesbtn" disabled={busy} title="choose the genes this view uses" onClick={() => openGenes(vi)}>genes</button>
        </>} />
      {v.note && <p className="note">{v.note}</p>}
      <div className="vscroll">
        <table className="vtable">
          <thead><tr>
            <th className="l">pair</th>
            <th className="r">n</th>
            <th className="barhead" style={{ width: "9rem" }} aria-label="correlation, visualised" />
            <th className="r">r</th>
            {v.coexpression.some(x => x.rMeta != null) && <th className="r">r (meta)</th>}
            <th className="r">p</th>
            <th className="r">q</th>
          </tr></thead>
          <tbody>{v.coexpression.map(r => (
            <tr key={r.a + "|" + r.b} className="ruled"
              title={(r.perStudy || []).map(s2 => s2.study + ": r=" + s2.r + " (n=" + s2.n + ")").join("\n") || undefined}>
              <td className="bold">{r.a} / {r.b}</td>
              <td className="r tnum muted">{r.n.toLocaleString()}</td>
              <td >
                {r.r != null && <span className="rbar"><i style={{
                  width: Math.abs(r.r) * 50 + "%",
                  marginLeft: r.r < 0 ? (50 - Math.abs(r.r) * 50) + "%" : "50%",
                  background: r.r < 0 ? "#D55E00" : "#0072B2" }} /></span>}
              </td>
              <td className={"r tnum" + (Math.abs(r.r ?? 0) > 0.5 ? " bold" : "")}>{r.r ?? "—"}</td>
              {v.coexpression!.some(x => x.rMeta != null) && <td className="r tnum">{r.rMeta ?? "—"}</td>}
              <td className="r tnum">{pCell(r.pMeta ?? r.p)}</td>
              <td className="r tnum muted">{pCell(r.q)}</td>
            </tr>))}
          </tbody>
        </table>
      </div>
    </>}
  </>;
}

function ClinicalCard({ ctx, v, vi }: CardProps) {
  const { attrsLoading, busy, catalogAttrs, cohortChoice, docView, menuOpenRef, setViewAttrs, viewIds } = ctx;
  return <>
    {v.kind === "clinical" && v.clinical && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title="Clinical comparison" cohorts={cohortChoice(vi, docView(vi))} sub="attribute distributions across cohorts" {...placement(ctx, vi)}
        actions={<PickMenu label="attributes" title="which clinical attributes this view compares" busy={busy}
          menuId={"attrs:" + (viewIds[vi] ?? vi)} menuStore={menuOpenRef.current} loading={attrsLoading()}
          options={catalogAttrs().map((a) => ({ value: a.attribute, label: a.attribute, hint: a.kind }))}
          chosen={(docView(vi).attributes || []).map(String)} min={1} max={20}
          onChange={(next) => setViewAttrs(vi, next)} />} />
      {v.note && <p className="note">{v.note}</p>}
      <div className="vscroll">
        <table className="vtable">
          <thead><tr>
            <th className="l">attribute</th>
            {v.cohorts!.map((n, i: number) => <th key={n} className="l" style={{ color: CAT_COLORS[i] }}>{n}</th>)}
            <th className="r">test</th>
            <th className="r">p</th>
            <th className="r">q</th>
          </tr></thead>
          <tbody>{v.clinical.map(r => (
            <tr key={r.attribute} className="ruled">
              <td className="bold nowrap">
                {r.attribute}<br /><span className="meta thlight">{r.per}-level · {r.kind === "num" ? "numeric" : (r.distinct ?? 0) + " values"}</span>
              </td>
              {r.skipped
                ? <td colSpan={v.cohorts!.length + 3} className="muted italic">not compared — {r.skipped}</td>
                : <>
                  {r.cells.map(c => (
                    <td key={c.cohort} className="top">
                      {r.kind === "num"
                        ? <span className="tnum">{c.mean} <span className="meta">± {c.sd} (n={c.n.toLocaleString()})</span>
                            {c.median != null && <><br /><span className="meta">median {c.median} ({c.q1}–{c.q3})</span></>}</span>
                        : <span className="meta">{(c.top || []).slice(0, 3).map(t2 => t2.v + " " + Math.round(1000 * t2.n / (c.n || 1)) / 10 + "%").join(" · ")}</span>}
                    </td>
                  ))}
                  <td className="r nowrap"
                    title={r.statistic != null ? r.test + " = " + r.statistic + ", df = " + r.df + (r.df2 != null ? ", " + r.df2 : "") + (r.minExpected != null ? ", smallest expected cell = " + r.minExpected : "") +
                      (r.rankP != null ? "; " + (r.test === "Welch ANOVA" ? "Kruskal-Wallis H = " : "Mann-Whitney U = ") + r.rankStatistic + ", p = " + r.rankP + " (single-study only, not part of the q-value correction)" : "") : undefined}>
                    <span className="meta">{r.test}{r.rankP != null && "*"}</span>
                  </td>
                  <td className={"r tnum" + ((r.p ?? 1) < 0.001 ? " bold" : "")}>{r.p != null ? pCell(r.p) : "—"}</td>
                  <td className="r tnum muted">{r.q != null ? pCell(r.q) : "—"}</td>
                </>}
            </tr>))}
          </tbody>
        </table>
      </div>
    </>}
  </>;
}

function CooccurrenceCard({ ctx, v, vi }: CardProps) {
  const { busy, cohortChoice, docView, menuOpenRef, openGenes } = ctx;
  return <>
    {v.kind === "cooccurrence" && v.pairs && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title="Co-occurrence" cohorts={cohortChoice(vi, docView(vi), 1)} sub="pairwise, among patients profiled for both genes" {...placement(ctx, vi)}
        actions={<button className="linklike genesbtn" disabled={busy} title="choose the genes this view uses" onClick={() => openGenes(vi)}>genes</button>} />
      {v.note && <p className="note">{v.note}</p>}
      <div className="vscroll">
        <table className="vtable">
          <thead><tr>
            <th className="l">pair</th>
            <th className="r">both</th>
            <th className="r">A only</th>
            <th className="r">B only</th>
            <th className="r">neither</th>
            <th className="r">log<sub>2</sub> OR</th>
            <th className="r">p</th>
            <th className="r">q</th>
            <th className="l">tendency</th>
          </tr></thead>
          <tbody>{v.pairs.map(r => {
            const lor = r.oddsRatioMH != null ? Math.log2(r.oddsRatioMH) : r.log2Odds;
            const pShown = r.pStratified ?? r.p;
            return (
            <tr key={r.a + "|" + r.b} className="ruled"
              title={"profiled for both: " + r.profiled.toLocaleString() +
                (r.pStratified != null ? "  ·  stratified over " + r.strata + " studies (CMH); pooled Fisher p=" + r.p.toExponential(1) : "")}>
              <td className="bold">{r.a} / {r.b}</td>
              <td className="r tnum">{r.both.toLocaleString()}</td>
              <td className="r tnum">{r.onlyA.toLocaleString()}</td>
              <td className="r tnum">{r.onlyB.toLocaleString()}</td>
              <td className="r tnum muted">{r.neither.toLocaleString()}</td>
              <td className="r tnum">{lor == null ? "—" : lor.toFixed(2)}</td>
              <td className={"r tnum" + (pShown < 0.001 ? " bold" : "")}>{pCell(pShown)}</td>
              <td className="r tnum muted">{pCell(r.q)}</td>
              <td >
                {r.tendency && <span className={r.tendency === "co-occurrence" ? "tend co" : "tend mx"}>{r.tendency}</span>}
              </td>
            </tr>); })}
          </tbody>
        </table>
      </div>
    </>}
  </>;
}

function SurvivalCard({ ctx, v, vi }: CardProps) {
  const { busy, cat, catLoading, cohortChoice, doc, docView, menuOpenRef, patchView } = ctx;
  return <>
    {v.kind === "survival" && v.curves && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title="Survival" cohorts={cohortChoice(vi, docView(vi))} {...placement(ctx, vi)}
        sub={<>Kaplan–Meier, {v.endpoint && v.endpoint !== "OS" ? v.endpoint : "overall survival"}{v.anchoredTo && <> — from {v.anchoredTo}</>}</>}
        chips={v.truncated ? <span className="trunc" title={
          "Delayed entry is applied: a patient joins the risk set when the study could first observe them, not at the anchor." +
          (v.entryMonths ? "\n\nMedian " + v.entryMonths.median + " months from anchor to entry; 90th percentile "
            + v.entryMonths.p90 + "; longest " + v.entryMonths.max + "." : "")}>left-truncated</span> : null} />
      {(() => {
        // The basis of a survival analysis — which endpoint, and what
        // the clock starts from — is the thing people most want to
        // change, so it is a control rather than a JSON edit.
        const sv: any = (doc.views || [])[vi] || {};
        const a = sv.anchor || null;
        const eps: string[] = (cat && cat.survivalEndpoints) || [];
        const types: string[] = ((cat && cat.types) || []).map((t: any) => t.t);
        const keys: string[] = (cat && a && cat.keys && cat.keys[a.eventType]) || [];
        const vals: string[] = (cat && a && a.key && cat.values && cat.values[a.eventType]
          && cat.values[a.eventType][a.key]) || [];
        return (
          <div className="basis">
            <span className="meta">endpoint</span>
            <select value={sv.endpoint || "OS"} disabled={busy}
              onChange={e => patchView(vi, { endpoint: e.target.value })}>
              {(eps.length ? eps : [sv.endpoint || "OS"]).map(x => <option key={x} value={x}>{x}</option>)}
            {!cat && <option disabled>loading…</option>}
            </select>
            {catLoading && !cat && <Waiting what="endpoints" />}
            <span className="meta">measured from</span>
            <select value={a ? a.eventType : ""} disabled={busy}
              onChange={e => patchView(vi, { anchor: e.target.value
                ? { eventType: e.target.value, occurrence: "FIRST" } : null })}>
              <option value="">study baseline (day 0)</option>
              {!cat && <option disabled>loading this study's events…</option>}
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {a && <>
              <select value={a.occurrence || "FIRST"} disabled={busy}
                onChange={e => patchView(vi, { anchor: { ...a, occurrence: e.target.value } })}>
                <option value="FIRST">first</option><option value="LAST">last</option>
              </select>
              <span className="meta">where</span>
              <select value={a.key || ""} disabled={busy}
                onChange={e => patchView(vi, { anchor: e.target.value
                  ? { ...a, key: e.target.value, value: (cat.values[a.eventType] || {})[e.target.value]?.[0] ?? "" }
                  : { eventType: a.eventType, occurrence: a.occurrence || "FIRST" } })}>
                <option value="">(any)</option>
                {keys.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
              {a.key && (
                <select value={a.value ?? ""} disabled={busy}
                  onChange={e => patchView(vi, { anchor: { ...a, value: e.target.value } })}>
                  {vals.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              )}
            </>}
            <span className="meta">display</span>
            <select value={sv.display === "incidence" ? "incidence" : "survival"} disabled={busy}
              onChange={e => patchView(vi, { display: e.target.value === "incidence" ? "incidence" : undefined })}>
              <option value="survival">survival</option>
              <option value="incidence">cumulative incidence</option>
            </select>
            <span className="meta">ticks</span>
            <select value={sv.tickMonths || ""} disabled={busy}
              onChange={e => patchView(vi, { tickMonths: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">auto</option>
              {[6, 12, 24, 60].map(m => <option key={m} value={m}>{m}mo</option>)}
            </select>
            <span className="meta">cutoff</span>
            <input type="number" min={1} placeholder="none" disabled={busy}
              value={sv.cutoffMonths ?? ""} style={{ width: "5rem" }}
              onChange={e => patchView(vi, { cutoffMonths: e.target.value ? Number(e.target.value) : undefined })} />
            <span className="meta">mo</span>
          </div>
        );
      })()}
      <KMChart curves={v.curves!} cutoffMonths={v.cutoffMonths} tickMonths={v.tickMonths} incidence={v.display === "incidence"} />
      <div className="kmlegend">
        {v.curves!.map((c, i: number) => <span key={c.cohort}><span style={{ display: "inline-block", width: 10, height: 10, background: CAT_COLORS[i], borderRadius: 2, marginRight: 5 }} />{c.cohort}: {v.display === "incidence" ? "50% incidence by " : "median "}{c.median ? c.median.toFixed(1) + "mo" : "not reached"} (n={c.n}, {c.events} events)</span>)}
      </div>
      {v.logrank && (
        <div className="logrank" title={"observed " + v.logrank.observed.join(" / ") + " events vs expected " + v.logrank.expected.join(" / ") + " under the null"}>
          <strong>log-rank</strong> χ²={v.logrank.chi2.toFixed(2)} ({v.logrank.df} df) · <strong>{fmtP(v.logrank.p)}</strong>
          {v.logrank.strata > 1 && <span className="meta"> · stratified by study, {v.logrank.strata} strata</span>}
          {v.logrankPooled && (
            <span className="meta" title="the unstratified test, which pools risk sets across studies and assumes a common baseline hazard">
              {"  ·  pooled " + fmtP(v.logrankPooled.p)}
              {crossesThreshold(v.logrank.p, v.logrankPooled.p) && <strong className="warnmark"> — the two disagree at p=0.05</strong>}
            </span>
          )}
        </div>
      )}
      {v.logrankK && (
        <div className="logrank" title={"observed " + v.logrankK.observed.join(" / ") + " events vs expected " + v.logrankK.expected.join(" / ") + " under the null, across " + v.logrankK.groups + " groups"}>
          <strong>{v.logrankK.groups}-group log-rank</strong> χ²={v.logrankK.chi2.toFixed(2)} ({v.logrankK.df} df) · <strong>{fmtP(v.logrankK.p)}</strong>
          <span className="meta"> — tests whether the groups differ at all, not which pair does</span>
          {v.logrankK.strata > 1 && <span className="meta"> · stratified by study, {v.logrankK.strata} strata</span>}
          {v.logrankKPooled && (
            <span className="meta" title="the unstratified test, which pools risk sets across studies and assumes a common baseline hazard">
              {"  ·  pooled " + fmtP(v.logrankKPooled.p)}
              {crossesThreshold(v.logrankK.p, v.logrankKPooled.p) && <strong className="warnmark"> — the two disagree at p=0.05</strong>}
            </span>
          )}
        </div>
      )}
      <p className="note">{v.caveat}</p>
    </>}
  </>;
}

function CoxCard({ ctx, v, vi }: CardProps) {
  const { attrsLoading, busy, cat, catLoading, catalogAttrs, cohortChoice, doc, docView, menuOpenRef, patchView, profileOptions, result, trackAttrs } = ctx;
  return <>
    {v.kind === "cox" && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title="Cox regression" cohorts={cohortChoice(vi, docView(vi))} {...placement(ctx, vi)}
        sub={<>Multivariate Cox, {v.endpoint && v.endpoint !== "OS" ? v.endpoint : "overall survival"}</>} />
      {(() => {
        const sv: any = (doc.views || [])[vi] || {};
        const covariates: any[] = Array.isArray(sv.covariates) ? sv.covariates : [];
        const eps: string[] = (cat && cat.survivalEndpoints) || [];
        const setCovariate = (ci: number, next: any) => {
          const nc = covariates.map((c, j) => j === ci ? next : c);
          patchView(vi, { covariates: nc });
        };
        const removeCovariate = (ci: number) => patchView(vi, { covariates: covariates.filter((_, j) => j !== ci) });
        const addCovariate = () => patchView(vi, { covariates: [...covariates, { source: "clinical", attribute: (trackAttrs.attrs[0] || {}).attribute || "" }] });
        // The reference level for a categorical covariate is picked from the levels
        // this run actually observed (v.cox.coefficients), not re-derived client-side —
        // a covariate the fit dropped (only one level, or no result yet) simply gets no
        // picker rather than a guess at what the data might contain.
        const observedLevels = (ci: number): string[] => {
          // when stratified by cohort there's no single pooled coefficients array —
          // union the levels each cohort's own fit happened to observe instead
          const coefs = (v.cox && v.cox.coefficients.length) ? v.cox.coefficients
            : (v.cox?.byCohort || []).flatMap((c: any) => c.coefficients);
          const mine = coefs.filter((c: any) => c.axisIndex === ci);
          if (!mine.length) return [];
          const levels = new Set<string>();
          for (const c of mine) { if (c.reference) levels.add(c.reference); if (c.level) levels.add(c.level); }
          return [...levels];
        };
        return (
          <div className="basis wraps">
            <span className="meta">endpoint</span>
            <select value={sv.endpoint || "OS"} disabled={busy}
              onChange={e => patchView(vi, { endpoint: e.target.value })}>
              {(eps.length ? eps : [sv.endpoint || "OS"]).map(x => <option key={x} value={x}>{x}</option>)}
              {!cat && <option disabled>loading…</option>}
            </select>
            {catLoading && !cat && <Waiting what="endpoints" />}
            <span className="meta">cutoff</span>
            <input type="number" min={1} placeholder="none" disabled={busy}
              value={sv.cutoffMonths ?? ""} style={{ width: "5rem" }}
              onChange={e => patchView(vi, { cutoffMonths: e.target.value ? Number(e.target.value) : undefined })} />
            <span className="meta">mo</span>
            <label className="chk" title="fit a separate baseline hazard per study instead of pooling them">
              <input type="checkbox" checked={!!sv.stratifyByStudy} disabled={busy}
                onChange={e => patchView(vi, { stratifyByStudy: e.target.checked || undefined })} />
              stratify by study
            </label>
            <label className="chk" title="fit each cohort as its own separate model — own coefficients, own reference levels — instead of pooling them into one fit; a no-op with only one cohort">
              <input type="checkbox" checked={!!sv.stratifyByCohort} disabled={busy}
                onChange={e => patchView(vi, { stratifyByCohort: e.target.checked || undefined })} />
              stratify by cohort
            </label>
            <CovariateList covariates={covariates} ratio="hazard" observedLevels={observedLevels} busy={busy}
              attrs={catalogAttrs()} profiles={profileOptions()} loading={attrsLoading()}
              onChange={setCovariate} onRemove={removeCovariate} onAdd={addCovariate} />
          </div>
        );
      })()}
      <ViewFigure svg={v.svg} error={v.error} />
    </>}
  </>;
}

function KindCard({ ctx, v, vi }: CardProps) {
  const { assayOptions, busy, catalogAttrs, cohortChoice, doc, docView, menuOpenRef, openGenes, patchView, pendingKeys, profileOptions, viewEvents, viewIds } = ctx;
  return <>
    {hasKindCard(v.kind) && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title={KIND_CARDS[v.kind].title}
        sub={kindSub(v.kind, docView(vi), v)}
        cohorts={cohortChoice(vi, docView(vi), KIND_CARDS[v.kind].maxCohorts)} cohortInSub={KIND_CARDS[v.kind].cohortInHeader}
        {...placement(ctx, vi)}
        actions={KIND_CARDS[v.kind].genes
          ? <button className="linklike genesbtn" disabled={busy} title="choose the genes this view uses" onClick={() => openGenes(vi)}>genes</button>
          : undefined} />
      {(() => {
        const mc = { vi, spec: docView(vi), v, busy, updating: busy || pendingKeys.has(viewIds[vi]), patch: (p: Record<string, unknown>) => patchView(vi, p),
          attrs: catalogAttrs(), profiles: profileOptions(), assays: assayOptions(), events: viewEvents(), docJson: () => JSON.stringify(doc) };
        const body = KindCardBody({ c: mc });
        return <>
          <KindCardControls c={mc} />
          {v.note && <p className="note">{v.note}</p>}
          {body || <ViewFigure svg={v.svg} error={v.error} />}
          {body && v.caveat && <p className="note vfoot">{v.caveat}</p>}
        </>;
      })()}
    </>}
  </>;
}

function LogisticCard({ ctx, v, vi }: CardProps) {
  const { attrsLoading, busy, catalogAttrs, cohortChoice, doc, docView, menuOpenRef, patchView, profileOptions, trackAttrs } = ctx;
  return <>
    {v.kind === "logistic" && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title="Logistic regression" cohorts={cohortChoice(vi, docView(vi))} {...placement(ctx, vi)}
        sub={<>Multivariate logistic, odds ratios</>} />
      {(() => {
        const sv: any = (doc.views || [])[vi] || {};
        const covariates: any[] = Array.isArray(sv.covariates) ? sv.covariates : [];
        const setCovariate = (ci: number, next: any) => {
          const nc = covariates.map((c, j) => j === ci ? next : c);
          patchView(vi, { covariates: nc });
        };
        const removeCovariate = (ci: number) => patchView(vi, { covariates: covariates.filter((_, j) => j !== ci) });
        const addCovariate = () => patchView(vi, { covariates: [...covariates, { source: "clinical", attribute: (trackAttrs.attrs[0] || {}).attribute || "" }] });
        // Same idea as the Cox picker's observedLevels, but there's only ever one
        // pooled fit here (logistic has no stratifyByCohort yet).
        const observedLevels = (ci: number): string[] => {
          const coefs = (v.logistic && v.logistic.coefficients) || [];
          const mine = coefs.filter((c: any) => c.axisIndex === ci);
          if (!mine.length) return [];
          const levels = new Set<string>();
          for (const c of mine) { if (c.reference) levels.add(c.reference); if (c.level) levels.add(c.level); }
          return [...levels];
        };
        // The outcome's own observed levels, for the outcomeEvent picker: the
        // currently-chosen event (if the fit succeeded) plus whatever got collapsed
        // into "not event" (outcomeOther) — together, everything this run has seen.
        const outcomeLevels = [...new Set([
          ...(sv.outcomeEvent ? [String(sv.outcomeEvent)] : []),
          ...((v.logistic && v.logistic.outcomeOther) || [])
        ])];
        const outcomeIsAlteration = sv.outcome?.source === "alteration";
        return (
          <div className="basis wraps">
            <span className="meta">outcome</span>
            <AxisPicker side="outcome" axis={sv.outcome || { source: "clinical", attribute: "" }} attrs={catalogAttrs()}
              profiles={profileOptions()} loading={attrsLoading()} busy={busy}
              onChange={(next) => patchView(vi, { outcome: next })} />
            {!outcomeIsAlteration && <label className="tbfield" title="which observed value of the outcome counts as the event (1); every other observed value is treated as 'not event' and disclosed in the caveat. Required for a categorical outcome; not used for a numeric one, which must already be coded 0/1">
              event <input type="text" list={"outcome-levels-" + vi} disabled={busy} style={{ width: "9rem" }}
                placeholder="e.g. Responder" value={sv.outcomeEvent || ""}
                onChange={e => patchView(vi, { outcomeEvent: e.target.value || undefined })} />
              <datalist id={"outcome-levels-" + vi}>
                {outcomeLevels.map(l => <option key={l} value={l} />)}
              </datalist>
            </label>}
            <CovariateList covariates={covariates} ratio="odds" observedLevels={observedLevels} busy={busy}
              attrs={catalogAttrs()} profiles={profileOptions()} loading={attrsLoading()}
              onChange={setCovariate} onRemove={removeCovariate} onAdd={addCovariate} />
          </div>
        );
      })()}
      <ViewFigure svg={v.svg} error={v.error} />
    </>}
  </>;
}

function SequenceKeyHint({ ctx, v, vi }: CardProps) {
  const { busy, patchView } = ctx;
  return <>
    {v.kind === "sequence" && !v.svg && v.error && v.sequence && v.sequence.keyOptions && v.sequence.keyOptions.length > 0 && (
      <div className="basis">
        <span className="meta">label lines by</span>
        <select value={v.sequence.labelKey} disabled={busy}
          onChange={e => patchView(vi, { labelKey: e.target.value })}>
          {v.sequence.keyOptions.map(k => (
            <option key={k.key} value={k.label}>{k.label} — {k.values} value{k.values === 1 ? "" : "s"}</option>
          ))}
        </select>
      </div>
    )}
  </>;
}

function PlotCard({ ctx, v, vi }: CardProps) {
  const { attrsLoading, busy, catalogAttrs, cohortChoice, docView, menuOpenRef, profileOptions, updateView } = ctx;
  return <>
    {v.kind === "plot" && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title="Plot" cohorts={cohortChoice(vi, docView(vi), 1)} {...placement(ctx, vi)}
        sub={v.plot ? <>{v.plot.shape === "scatter" ? "density" : v.plot.shape === "box" ? "box" : "contingency"} · {v.plot.n.toLocaleString()} {(docView(vi).unit || "patient")}s</> : "two axes over the same cases"} />
      {/* Every control here changes what is DRAWN and costs a query, so there is one
          zone and it says so — the same toolbar the oncoprint uses. */}
      <div className="viewtb">
        <div className="tbz">
          <span className="tbl" title="these change what is drawn, and re-run the query">data</span>
          <AxisPicker side="x" axis={docView(vi).x} attrs={catalogAttrs()} profiles={profileOptions()} loading={attrsLoading()} busy={busy}
            onChange={(a) => updateView(vi, (vv: any) => ({ ...vv, x: a }))} />
        </div>
        <div className="tbz">
          <AxisPicker side="y" axis={docView(vi).y} attrs={catalogAttrs()} profiles={profileOptions()} loading={attrsLoading()} busy={busy}
            onChange={(a) => updateView(vi, (vv: any) => ({ ...vv, y: a }))} />
        </div>
        {/* colour/ring only affect a box plot's violin — a scatter's density and a
            contingency table have no per-case colour to split, so the controls would
            sit there doing nothing until a box shape is actually on screen */}
        {v.plot?.shape === "box" && <div className="tbz">
          <span className="tbl" title="colours each group's violin by a category">colour</span>
          <AxisPicker side="fill" axis={docView(vi).colorBy} allowNone categorical
            attrs={catalogAttrs()} profiles={profileOptions()} loading={attrsLoading()} busy={busy}
            onChange={(a) => updateView(vi, (vv: any) => { const n = { ...vv }; if (a) n.colorBy = a; else delete n.colorBy; return n; })} />
          <AxisPicker side="ring" axis={docView(vi).ringBy} allowNone categorical
            attrs={catalogAttrs()} profiles={profileOptions()} loading={attrsLoading()} busy={busy}
            onChange={(a) => updateView(vi, (vv: any) => { const n = { ...vv }; if (a) n.ringBy = a; else delete n.ringBy; return n; })} />
        </div>}
        {v.plot?.shape !== "table" && (() => {
          // every cohort the document evaluates, but the plotted one and a split (which stands for
          // several groups, not one set of cases)
          const ch = cohortChoice(vi, docView(vi), 1);
          const plotted = ch.drawn[0];
          const options = ch.nodes.filter((nd) => nd.kind !== "split" && nd.name !== plotted)
            .map((nd) => ({ name: nd.name, label: nd.label, depth: nd.depth }));
          const chosen: string[] = Array.isArray(docView(vi).highlight) ? docView(vi).highlight : [];
          if (!options.length && !chosen.length) return null;
          return <div className="tbz">
            <HighlightPicker chosen={chosen} options={options} busy={busy}
              onChange={(next) => updateView(vi, (vv: any) => { const n = { ...vv }; if (next.length) n.highlight = next; else delete n.highlight; return n; })} />
          </div>;
        })()}
        <div className="tbz">
          <label className="tbfield" title="what a point is; patient mode averages a patient's samples">unit <select
            value={docView(vi).unit || "patient"} disabled={busy}
            onChange={(e) => updateView(vi, (vv: any) => ({ ...vv, unit: e.target.value }))}>
            <option value="patient">patients</option><option value="sample">samples</option>
          </select></label>
          {/* a box plot is always drawn categories-on-x, values-on-y regardless of
              which axis is which in the document (lib/federation.ts's box branch
              routes by kind, not by x/y) — swapping which is "x" changes nothing a
              reader can see, so the button is disabled rather than pretending to act */}
          <button className="tbbtn" disabled={busy || v.plot?.shape === "box"}
            title={v.plot?.shape === "box" ? "a box plot is always drawn by category, whichever axis holds it — nothing to swap"
              : "put the x axis on y and the y axis on x"}
            onClick={() => updateView(vi, (vv: any) => ({ ...vv, x: vv.y, y: vv.x }))}>swap</button>
        </div>
      </div>
      <ViewFigure svg={v.svg} empty={v.plot?.note || "nothing to draw"} />
    </>}
  </>;
}

function SequenceCard({ ctx, v, vi }: CardProps) {
  const { busy, cohortChoice, docView, menuOpenRef, patchView, setViewCohorts, viewIds } = ctx;
  return <>
    {v.kind === "sequence" && v.svg && <>
      <div className="vhead">
        <h2 className="vtitle">Treatment sequence <span className="plain">
          — lines of therapy by {v.sequence ? v.sequence.labelKey : ""}
          {v.sequence ? " · " + v.sequence.lineGap + "-day line gap" : ""}</span></h2>
        <div className="vmeta">
          <ViewHelpButton kind="sequence" menuId={"help:" + (viewIds[vi] ?? vi)} menuStore={menuOpenRef.current} />
          <CohortPicker nodes={cohortChoice(vi, docView(vi)).nodes} chosen={cohortChoice(vi, docView(vi)).chosen} max={1} busy={busy}
            menuId={"pick:" + (viewIds[vi] ?? vi)} menuStore={menuOpenRef.current}
            onChange={(next) => setViewCohorts(vi, next, cohortChoice(vi, docView(vi)).all)} />
        {v.sequence && v.sequence.keyOptions && v.sequence.keyOptions.length > 0 && (
          <details className="gearmenu inline">
            <summary title="treatment sequence options">settings</summary>
            {/* Label granularity is the choice that most changes this chart, and
                the keys are not interchangeable: in MSK-CHORD SUBTYPE has 10
                values, AGENT hundreds, TREATMENT_TYPE exactly one. So each option
                carries its value count rather than leaving the reader to discover
                a useless key by picking it. */}
            <div className="gearmenu-items wide">
              <div className="setrow">
                <span className="meta">label lines by</span>
                <select value={v.sequence.labelKey} disabled={busy}
                  onChange={e => patchView(vi, { labelKey: e.target.value })}>
                  {v.sequence.keyOptions.map(k => (
                    <option key={k.key} value={k.label}>
                      {k.label} — {k.values} value{k.values === 1 ? "" : "s"}
                      {k.values === 1 ? " (unusable)" : k.values > 60 ? " (very granular)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="setrow">
                <span className="meta">new line after</span>
                <select value={String(v.sequence.lineGap)} disabled={busy}
                  onChange={e => patchView(vi, { lineGap: Number(e.target.value) })}>
                  {[30, 60, 90, 120, 180].map(g => <option key={g} value={g}>{g} days</option>)}
                </select>
              </div>
              <div className="setrow">
                <span className="meta">lines shown</span>
                <select value={String(v.sequence.steps)} disabled={busy}
                  onChange={e => patchView(vi, { maxSteps: Number(e.target.value) })}>
                  {[2, 3, 4, 5].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
          </details>
        )}
        <Latency v={v} /><Participation p={v.participation} />
        <ViewMenu menuId={"reorder:" + (viewIds[vi] ?? vi)} menuStore={menuOpenRef.current} {...placement(ctx, vi)} hasNote={!!v.annotationNote} />
        </div>
      </div>
      <DrawnCohorts drawn={cohortChoice(vi, docView(vi), 1).drawn} nodes={cohortChoice(vi, docView(vi), 1).nodes} />
      {v.annotationNote && <p className="viewnote">{v.annotationNote}</p>}
      <SplitByNote v={v} />
      <ServerSvg className="vscroll" html={v.svg} />
    </>}
  </>;
}

function CourseCard({ ctx, v, vi }: CardProps) {
  const { busy, cohortChoice, doc, docView, menuOpenRef, patchView, setViewCohorts, viewIds } = ctx;
  return <>
    {v.kind === "course" && v.svg && <>
      <div className="vhead">
        <h2 className="vtitle">Clinical course <span className="plain">
          — {[...new Set((v.course || []).map(c => c.eventType))].join(", ")}
          {v.anchoredTo ? "" : ""} · {v.courseAxis ? v.courseAxis.binMonths + "-month bins" : ""}</span></h2>
        <div className="vmeta">
          <ViewHelpButton kind="course" menuId={"help:" + (viewIds[vi] ?? vi)} menuStore={menuOpenRef.current} />
          <CohortPicker nodes={cohortChoice(vi, docView(vi)).nodes} chosen={cohortChoice(vi, docView(vi)).chosen} busy={busy}
            menuId={"pick:" + (viewIds[vi] ?? vi)} menuStore={menuOpenRef.current}
            onChange={(next) => setViewCohorts(vi, next, cohortChoice(vi, docView(vi)).all)} />
        <details className="gearmenu inline">
          <summary title="clinical course options">settings</summary>
          {/* Every parameter of this chart is a choice, and the defaults are only a
            guess at a good one — so all of them are settable. They live behind
            the gear rather than above the figure because they are read when
            setting a chart up and rarely after. Each event type shows the two
            structural facts that decide whether it is worth plotting: how often
            it recurs, and whether it carries a duration. */}
      {v.eventOptions && v.eventOptions.length > 0 && (() => {
        const cv: any = (doc.views || [])[vi] || {};
        const chosen: string[] = (cv.eventTypes || []).map((x: string) => String(x).trim().toLowerCase());
        const anchor = cv.anchor || null;
        const toggle = (canon: string) => {
          const next = chosen.includes(canon) ? chosen.filter(x => x !== canon) : [...chosen, canon];
          if (next.length && next.length <= 6) patchView(vi, { eventTypes: next });
        };
        return (
          <div className="gearmenu-items wide">
            <div className="setcol"><span className="meta">measuring</span><div className="pillwrap">
            {v.eventOptions.map(e => (
              <button key={e.canonical} type="button" disabled={busy || (!chosen.includes(e.canonical) && chosen.length >= 6)}
                className={"pill" + (chosen.includes(e.canonical) ? " on" : "")}
                onClick={() => toggle(e.canonical)}
                title={(!chosen.includes(e.canonical) && chosen.length >= 6 ? "a course view measures at most 6 event types — drop one first. " : "") +
                  e.patients.toLocaleString() + " patients · " + e.perPatient + " events each · " +
                  (e.hasDurations ? "carries durations, so it is drawn as a state patients are IN"
                    : e.perPatient < 1.5 ? "about one per patient and no duration — likely a filing record rather than a clinical course"
                    : "no durations, so it is drawn as an event that HAPPENED")}>
                {e.label}{e.hasDurations ? " ⏱" : ""}
              </button>
            ))}
            </div></div>
            <hr />
            <div className="setrow"><span className="meta">aligned on</span>
            <select value={anchor ? String(anchor.eventType).trim().toLowerCase() : ""} disabled={busy}
              onChange={e => patchView(vi, { anchor: e.target.value
                ? { eventType: e.target.value, occurrence: anchor ? anchor.occurrence || "FIRST" : "FIRST" } : null })}>
              <option value="">study day 0 (single study only)</option>
              {v.eventOptions.map(e => <option key={e.canonical} value={e.canonical}>{e.label}</option>)}
            </select>
            {anchor && (
              <select style={{ flex: "none" }} value={anchor.occurrence || "FIRST"} disabled={busy}
                onChange={e => patchView(vi, { anchor: { ...anchor, occurrence: e.target.value } })}>
                <option value="FIRST">first</option>
                <option value="LAST">last</option>
              </select>
            )}
            </div>
            <div className="setrow"><span className="meta">bins</span>
            <select value={String(v.courseAxis ? v.courseAxis.binMonths : 3)} disabled={busy}
              onChange={e => patchView(vi, { binMonths: Number(e.target.value) })}>
              {[1, 3, 6, 12].map(b => <option key={b} value={b}>{b} month{b === 1 ? "" : "s"}</option>)}
            </select>
            </div>
            <div className="setrow"><span className="meta">window</span>
            <select value={String(v.courseAxis ? v.courseAxis.from : -12)} disabled={busy}
              onChange={e => patchView(vi, { fromMonths: Number(e.target.value) })}>
              {[0, -6, -12, -24, -60].map(f => <option key={f} value={f}>{f === 0 ? "the anchor" : f + "mo"}</option>)}
            </select>
            <span className="meta" style={{ minWidth: 0 }}>to</span>
            <select value={String(v.courseAxis ? v.courseAxis.to : 60)} disabled={busy}
              onChange={e => patchView(vi, { toMonths: Number(e.target.value) })}>
              {[12, 24, 60, 120, 240].map(t => <option key={t} value={t}>+{t}mo</option>)}
            </select>
            </div>
          </div>
        );
      })()}
        </details>
        <Latency v={v} /><Participation p={v.participation} />
        <ViewMenu menuId={"reorder:" + (viewIds[vi] ?? vi)} menuStore={menuOpenRef.current} {...placement(ctx, vi)} hasNote={!!v.annotationNote} />
        </div>
        </div>
      <DrawnCohorts drawn={cohortChoice(vi, docView(vi)).drawn} nodes={cohortChoice(vi, docView(vi)).nodes} />
      {v.annotationNote && <p className="viewnote">{v.annotationNote}</p>}
      <SplitByNote v={v} />
      {/* The same SVG MCP clients receive \u2014 one renderer,
          so the figure cannot differ between surfaces. */}
      <ServerSvg className="vscroll" html={v.svg} />
    </>}
  </>;
}

function OncoprintViewCard({ ctx, v, vi }: CardProps) {
  const { busy, cohortChoice, cohortFromSelection, contracts, doc, docView, featureFromSelection, menuOpenRef, ocView, openGenes, result, setContracts, trackAttrs, trackAttrsLoading, updateView, updateViewLocal } = ctx;
  return <>
    {v.kind === "oncoprint" && v.spec && (() => {
      const c = contracts[JSON.stringify(v.spec)];
      const vNames = v.cohorts || ocView(vi).cohorts || Object.keys(result.cohorts);
      const vStudies = [...new Set(vNames.flatMap(n => (result.cohorts[n] && result.cohorts[n].studies) || []))];
      return <>
        <ViewHead menuStore={menuOpenRef.current} v={{ ...v, ms: c ? c.stats.ms : v.ms }} title="Oncoprint" {...placement(ctx, vi)}
          cohorts={cohortChoice(vi, docView(vi), 4)}
          sub={c ? <>{c.stats.nColumns.toLocaleString()} {c.unit}s · {c.conventions.annotation}</> : "loading…"} />
        <OncoprintCard
          view={ocView(vi) as any}
          spec={v.spec}
          uploads={doc.uploads}
          onSaveFeature={(sel, all) => featureFromSelection(sel, all, (c ? c.studies : vStudies) || vStudies)}
          busy={busy}
          cohortNames={Object.keys(result.cohorts)}
          catalog={{ attrs: trackAttrs.attrs, profiles: trackAttrs.profiles, loading: trackAttrsLoading }}
          onView={(next, rerun) => rerun ? updateView(vi, () => next) : updateViewLocal(vi, () => next)}
          onGenes={() => openGenes(vi)}
          onCreateCohort={(sel) => cohortFromSelection(sel, (c ? c.studies : vStudies) || vStudies)}
          onContract={(ct) => { const k = JSON.stringify(v.spec); setContracts((m) => m[k] === ct ? m : { ...m, [k]: ct }); }}
          contract={c || null}
          note={v.note} studies={v.studies}
        />
      </>;
    })()}
  </>;
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
        {v.method && <MethodPanel method={v.method} source={{ doc: ctx.doc, index: vi, kind: v.kind }} />}
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

function ErrorNote({ ctx, v, vi }: CardProps) {
  return <>
    {v.error && <div className="error">{v.kind}: {v.error}{v.participation ? <> <>{v.ms != null && (
          <span className="lat" title={
            "Server-side wall-clock for this view. Its queries run concurrently, so this is not their sum, and it excludes rendering in your browser." +
            (v.renderMs != null ? "\n\n" + (v.ms - v.renderMs).toLocaleString() + "ms querying · " + v.renderMs.toLocaleString() + "ms drawing the SVG on the server." : "")}>
            {v.ms.toLocaleString()}ms
            {v.renderMs != null && <span className="latsplit"> ({(v.ms - v.renderMs).toLocaleString()} + {v.renderMs.toLocaleString()} draw)</span>}
          </span>
        )}<Participation p={v.participation} /></></> : null}</div>}
  </>;
}
