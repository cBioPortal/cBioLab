"use client";
// The timeline view's card: the chosen patient's timeline (lib/timeline-svg.ts, the same drawing
// the server sends over MCP) with a tooltip per event and a toggle per nested track, and its drawing
// settings over its right corner. The navigator above it steps to the patient before or after the
// drawn one in the list's order — the order its search, filters and sort give it — and opens the
// list itself (the shared table, app/_table/DataTable.tsx) in a dialog, where a click picks a
// patient. The cohort is the header's picker, as for every view.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DataTable, specQuery } from "../_table/DataTable.tsx";
import { timelineSvg, timelineSummary } from "../../lib/timeline-svg.ts";
import { formatDays, sampleMarks, attr } from "../../lib/timeline-tracks.ts";
import type { PatientEvent, TimelineResult } from "../../lib/types";

type Spec = { patient?: { study: string; id: string }; collapsed?: string[]; expandGaps?: boolean } & Record<string, unknown>;

export function TimelineBody({ t, spec, vi, updating, docJson, patch }: {
  t: TimelineResult; spec: Spec; vi: number; updating: boolean; docJson?: () => string; patch: (p: Record<string, unknown>) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [tip, setTip] = useState<{ x: number; y: number; ev: number[] } | null>(null);
  const [listOpen, setListOpen] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(480, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const p = t.patient;
  const collapsed = useMemo(() => spec.collapsed || [], [spec.collapsed]);
  const drawn = useMemo(() => p ? timelineSvg(p, { width, collapsed, expandGaps: !!spec.expandGaps, interactive: true }) : null, [p, width, collapsed, spec.expandGaps]);
  const marks = useMemo(() => p ? sampleMarks(p.samples, p.events) : new Map(), [p]);

  const toggle = (uid: string) => {
    const next = collapsed.includes(uid) ? collapsed.filter((u) => u !== uid) : [...collapsed, uid];
    patch({ collapsed: next.length ? next : undefined });
  };
  const onClick = (e: React.MouseEvent) => {
    const h = (e.target as Element).closest?.(".tl-h") as SVGGElement | null;
    if (h?.dataset.uid) toggle(h.dataset.uid);
  };
  const onMove = (e: React.MouseEvent) => {
    const m = (e.target as Element).closest?.(".tl-m") as SVGGElement | null;
    const r = box.current?.getBoundingClientRect();
    if (!m || !r || !m.dataset.ev) { if (tip) setTip(null); return; }
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, ev: m.dataset.ev.split(",").map(Number) });
  };
  const isSel = (row: { study: string; patient: string }) => p != null && row.study === p.study && row.patient === p.patient;

  const go = (to: { study: string; id: string } | null | undefined) => { if (to && !updating) patch({ patient: to }); };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as Element).closest?.("input, select, textarea, dialog")) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); go(t.position?.prev); }
    if (e.key === "ArrowRight") { e.preventDefault(); go(t.position?.next); }
  };

  return (
    <div className="tl-view" tabIndex={-1} onKeyDown={onKey}>
      <TimelineNav t={t} updating={updating} go={go} openList={() => setListOpen(true)} first={() => patch({ patient: undefined })} />
      {p ? (
        <div className="tl-head">
          <span className="tl-who mono">{p.patient}</span>
          <span className="meta">{p.study}{p.source.remote ? " · from " + p.source.label + " over MCP" : ""}</span>
          <span className="meta">{p.events.length.toLocaleString()} events · {p.samples.length} sample{p.samples.length === 1 ? "" : "s"}</span>
          {[...marks.values()].map((m) => (
            <span key={m.id} className="tl-sample" title={m.id + (m.type ? " — " + m.type : "")}>
              <svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="7" fill={m.color} /><text x="7" y="7" dy=".33em" textAnchor="middle" fontSize="9" fill="white">{m.label}</text></svg>
              <span className="mono">{m.id}</span>
            </span>))}
          <div className="viewtb tl-settings">
            <div className="tbz">
              <label className="chk" title="draw every year, rather than cutting runs of four or more years without an event to one dashed mark">
                <input type="checkbox" checked={!!spec.expandGaps} onChange={(e) => patch({ expandGaps: e.target.checked || undefined })} /> every year
              </label>
              <button type="button" className="tbbtn" disabled={!collapsed.length} title="unfold every nested track"
                onClick={() => patch({ collapsed: undefined })}>expand all tracks</button>
            </div>
          </div>
        </div>
      ) : <p className="meta">No patient to draw: the cohort's patient list is empty.</p>}
      <div ref={box} className={"tl-fig" + (updating ? " stale" : "")} onClick={onClick} onMouseMove={onMove} onMouseLeave={() => setTip(null)}>
        {drawn && (p!.events.length
          ? <div dangerouslySetInnerHTML={{ __html: drawn.svg }} />
          : <p className="meta tl-empty">{p!.patient} has no timeline events recorded.</p>)}
        {tip && p && <EventTip x={tip.x} y={tip.y} w={width} events={tip.ev.map((i) => p.events[i]).filter(Boolean)} marks={marks} />}
      </div>
      {p && drawn && <p className="note vfoot">{timelineSummary(p, drawn.layout, !!spec.expandGaps)} Click a track with ▾ to fold its sub-tracks into one row.</p>}
      {listOpen && (
        <PatientsDialog title={"Patients of " + (t.lists[0]?.cohort ?? "the cohort")} onClose={() => setListOpen(false)}>
          {(close) => (
            <DataTable t={t} query={specQuery(spec)} updating={updating} vi={vi} docJson={docJson} unit="patients"
              title="choose a patient" onQuery={(q) => patch({ ...q })}
              onRow={(row) => { if (!isSel(row)) patch({ patient: { study: row.study, id: row.patient } }); close(); }} selected={isSel}
              cell={(id, x) => id === "patient" ? <span className="mono">{x}</span> : (id === "first" || id === "last") && typeof x === "number" ? formatDays(x) : undefined} />
          )}
        </PatientsDialog>
      )}
    </div>
  );
}

/**
 * The patient list as a native modal (Esc, focus trapping and the backdrop are the platform's),
 * mounted while open. Esc inside one of the table's own popovers closes that popover, not the list.
 */
function PatientsDialog({ title, onClose, children }: { title: string; onClose: () => void; children: (close: () => void) => React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const popEsc = useRef(false);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  const close = () => ref.current?.close();
  return (
    <dialog ref={ref} className="tl-patients" aria-label={title} onClose={onClose}
      onKeyDownCapture={(e) => { popEsc.current = e.key === "Escape" && !!ref.current?.querySelector(".dt-pop"); }}
      onCancel={(e) => { if (popEsc.current) e.preventDefault(); popEsc.current = false; }}
      onClick={(e) => { if (e.target === ref.current) close(); }}>
      <div className="tl-patients-head">
        <h3 className="flush">{title}</h3>
        <button type="button" className="tbbtn" onClick={close} aria-label="close the patient list">close</button>
      </div>
      {children(close)}
    </dialog>
  );
}

/** Prev / next through the cohort's patients in the list's order, and the list itself. */
function TimelineNav({ t, updating, go, first, openList }: {
  t: TimelineResult; updating: boolean;
  go: (to: { study: string; id: string } | null | undefined) => void; first: () => void; openList: () => void;
}) {
  const pos = t.position, p = t.patient;
  const who = (x: { id: string } | null | undefined) => x ? " (" + x.id + ")" : "";
  return (
    <div className="viewtb tl-nav">
      <div className="tbz">
        <button type="button" className="tbbtn" disabled={updating || !pos?.prev} title={"the patient before this one in the list" + who(pos?.prev) + " — or press ←"}
          onClick={() => go(pos?.prev)}>‹ prev</button>
        <span className="tl-pos">
          {p && pos ? <>patient <b>{(pos.index + 1).toLocaleString()}</b> of {t.total.toLocaleString()}</>
            : p ? <>{p.patient} is not in the list as filtered</>
            : <>no patients</>}
        </span>
        <button type="button" className="tbbtn" disabled={updating || !pos?.next} title={"the patient after this one in the list" + who(pos?.next) + " — or press →"}
          onClick={() => go(pos?.next)}>next ›</button>
        {p && !pos && <button type="button" className="tbbtn" disabled={updating || !t.total} onClick={first} title="draw the list's first patient">go to the first patient</button>}
        <button type="button" className="tbbtn" onClick={openList} title="the cohort's patients: search, filter, sort, download, and click one to draw it">List/Search</button>
      </div>
    </div>
  );
}

function EventTip({ x, y, w, events, marks }: { x: number; y: number; w: number; events: PatientEvent[]; marks: Map<string, { label: string; color: string }> }) {
  const shown = events.slice(0, 4);
  return (
    <div className="onco-tip tl-tip" style={{ left: Math.min(x + 14, w - 340), top: y + 14 }}>
      {shown.map((e, k) => {
        const sid = attr(e, "SAMPLE_ID");
        const m = sid ? marks.get(sid) : undefined;
        return (
          <div key={k} className={k ? "tl-tip-more" : undefined}>
            <div className="lead">{e.type}{m ? <> · sample {m.label}</> : null}</div>
            <table><tbody>
              {e.attrs.filter(([a]) => !/^STYLE_/i.test(a)).map(([a, v], j) => <tr key={j}><th>{a.replace(/_/g, " ")}</th><td>{v}</td></tr>)}
              <tr><th>{e.end != null && e.end > e.start ? "START" : "DATE"}</th><td>{formatDays(e.start)} <span className="dim">(day {e.start})</span></td></tr>
              {e.end != null && e.end > e.start && <tr><th>END</th><td>{formatDays(e.end)} <span className="dim">(day {e.end})</span></td></tr>}
            </tbody></table>
          </div>);
      })}
      {events.length > shown.length && <div className="dim">and {events.length - shown.length} more on this day</div>}
    </div>
  );
}
