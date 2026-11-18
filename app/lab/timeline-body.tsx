"use client";
// The timeline view's card: the chosen patient's timeline (lib/timeline-svg.ts, the same drawing
// the server sends over MCP) with a tooltip per event and a toggle per nested track, and its drawing
// settings over its right corner. The navigator above it steps to the patient before or after the
// drawn one in the list's order and opens the list in a dialog (app/lab/patient-nav.tsx). The
// cohort is the header's picker, as for every view.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DataTable, specQuery } from "../_table/DataTable.tsx";
import { timelineSvg, timelineSummary } from "../../lib/timeline-svg.ts";
import { formatDays, sampleMarks, sampleTipRows, attr, SAMPLE_TRACK } from "../../lib/timeline-tracks.ts";
import { canonicalEventName } from "../../lib/event-names.ts";
import type { PatientEvent, TimelineResult } from "../../lib/types";
import { PatientNav, PatientsDialog, patientKeys } from "./patient-nav.tsx";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "../_ui/button";
import { Checkbox } from "../_ui/checkbox";
import { TB } from "../_ui/toolbar.ts";
import { FloatingTip } from "../_ui/tooltip.tsx";
import { ImageDownload } from "./image-download.tsx";
import { saveBlob } from "../../lib/study-view-download.ts";
import { TIMELINE_ZIP, timelineDataFiles } from "../../lib/timeline-tables.ts";
import { strToU8, zipSync } from "fflate";

/** `files` saved as one ZIP archive named `name` */
function saveZip(name: string, files: { name: string; text: string }[]): void {
  saveBlob(name, new Blob([zipSync(Object.fromEntries(files.map((f) => [f.name, strToU8(f.text)]))) as BlobPart], { type: "application/zip" }));
}

type Spec = { patient?: { study: string; id: string }; collapsed?: string[]; expandGaps?: boolean } & Record<string, unknown>;

export function TimelineBody({ t, spec, vi, updating, docJson, patch, fixed }: {
  t: TimelineResult; spec: Spec; vi: number; updating: boolean; docJson?: () => string; patch: (p: Record<string, unknown>) => void;
  /** one patient only (the Patient page): no navigator through the cohort's others */
  fixed?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  // the portal's event tooltip (TimelineTrack, TimelineStore): shown on hover, gone 100 ms after the pointer
  // leaves unless pinned by a click; one event at a time when several share the mark, paged
  const [tip, setTip] = useState<{ x: number; y: number; ev: number[]; pinned: boolean; page: number } | null>(null);
  const linger = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTip = () => { if (linger.current) { clearTimeout(linger.current); linger.current = null; } };
  const dropTip = () => { holdTip(); linger.current = setTimeout(() => setTip((t) => t && !t.pinned ? null : t), 100); };
  useEffect(() => () => holdTip(), []);
  // Esc closes it; ←/↓ and →/↑/space page through a mark's events, wrapping (TimelineStore's key handling)
  useEffect(() => {
    if (!tip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setTip(null); return; }
      const n = tip.ev.length;
      if (n < 2) return;
      const step = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === " " ? 1 : 0;
      if (!step) return;
      e.preventDefault();
      setTip((t) => t && { ...t, page: (t.page + step + n) % n });
    };
    const onLeave = () => setTip(null);
    window.addEventListener("keydown", onKey);
    document.body.addEventListener("mouseleave", onLeave);
    return () => { window.removeEventListener("keydown", onKey); document.body.removeEventListener("mouseleave", onLeave); };
  }, [tip]);
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
  const marked = (e: React.MouseEvent) => {
    const m = (e.target as Element).closest?.(".tl-m") as SVGGElement | null;
    return m?.dataset.ev ? m.dataset.ev : null;
  };
  const onClick = (e: React.MouseEvent) => {
    const h = (e.target as Element).closest?.(".tl-h") as SVGGElement | null;
    if (h?.dataset.uid) { toggle(h.dataset.uid); return; }
    // a click on a mark pins its tooltip, or lets a pinned one go
    const ev = marked(e);
    if (!ev) return;
    holdTip();
    setTip((t) => t && t.pinned && t.ev.join(",") === ev ? { ...t, pinned: false } : { x: e.clientX, y: e.clientY, ev: ev.split(",").map(Number), pinned: true, page: t && t.ev.join(",") === ev ? t.page : 0 });
  };
  const onMove = (e: React.MouseEvent) => {
    if (tip?.pinned) return;
    const ev = marked(e);
    if (!ev) { if (tip) dropTip(); return; }
    holdTip();
    setTip((t) => ({ x: e.clientX, y: e.clientY, ev: ev.split(",").map(Number), pinned: false, page: t && t.ev.join(",") === ev ? t.page : 0 }));
  };
  const isSel = (row: { study: string; patient: string }) => p != null && row.study === p.study && row.patient === p.patient;

  const go = (to: { study: string; id: string } | null | undefined) => { if (to && !updating) patch({ patient: to }); };
  const onKey = patientKeys(t.position, go);

  return (
    // eslint-disable-next-line jsx-a11y-x/no-static-element-interactions -- arrow-key shortcuts for the patient buttons PatientNav already provides
    <div className="tl-view" tabIndex={-1} onKeyDown={onKey}>
      {!fixed && <PatientNav shown={p ? p.patient : null} position={t.position} total={t.total} updating={updating} go={go} what="draw it"
        openList={() => setListOpen(true)} first={() => patch({ patient: undefined })} />}
      {p ? (
        <div className="tl-head">
          <span className="tl-who mono">{p.patient}</span>
          <span className="meta">{p.study}{p.source.remote ? " · from " + p.source.label + " via federation" : ""}</span>
          <span className="meta">{p.events.length.toLocaleString()} events · {p.samples.length} sample{p.samples.length === 1 ? "" : "s"}</span>
          {[...marks.values()].map((m) => (
            <span key={m.id} className="tl-sample" data-tip={m.id + (m.type ? " — " + m.type : "")}>
              <svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="7" fill={m.color} /><text x="7" y="7" dy=".33em" textAnchor="middle" fontSize="9" fill="white">{m.label}</text></svg>
              <span className="mono">{m.id}</span>
            </span>))}
          <div className="viewtb tl-settings">
            <div className="tbz">
              <label className="chk" data-tip="draw every year, rather than cutting runs of four or more years without an event to one dashed mark">
                <Checkbox checked={!!spec.expandGaps} onCheckedChange={(on) => patch({ expandGaps: (on === true) || undefined })} /> every year
              </label>
              <Button type="button" variant="outline" size="sm" className={TB} disabled={!collapsed.length} data-tip="unfold every nested track"
                onClick={() => patch({ collapsed: undefined })}><ChevronsUpDown />expand all tracks</Button>
              <ImageDownload name="timeline" formats={["pdf", "png", "svg"]} label="download the timeline" tip="download the timeline as drawn (its folded tracks, every year or not)"
                svg={() => p ? timelineSvg(p, { width, collapsed, expandGaps: !!spec.expandGaps, theme: "light" }).svg : null}
                extra={p && p.events.length ? [{ label: "Data (ZIP)", save: () => saveZip(TIMELINE_ZIP, timelineDataFiles(p.patient, p.events)) }] : undefined} />
            </div>
          </div>
        </div>
      ) : <p className="meta">No patient to draw: the cohort's patient list is empty.</p>}
      {/* eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions -- track groups in the drawn SVG expand on click only; there is no keyboard equivalent yet */}
      <div ref={box} className={"tl-fig" + (updating ? " stale" : "")} onClick={onClick} onMouseMove={onMove} onMouseLeave={() => { if (!tip?.pinned) dropTip(); }}>
        {drawn && (p!.events.length
          ? <div dangerouslySetInnerHTML={{ __html: drawn.svg }} />
          : <p className="meta tl-empty">{p!.patient} has no timeline events recorded.</p>)}
        {tip && p && <EventTip x={tip.x} y={tip.y} events={tip.ev.map((i) => p.events[i]).filter(Boolean)} marks={marks} sampleAttrs={p.sampleAttrs} page={tip.page} pinned={tip.pinned}
          onPage={(n) => setTip((t) => t && { ...t, page: n })} onClose={() => setTip(null)} onHold={holdTip} onLeave={() => { if (!tip.pinned) dropTip(); }} />}
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
 * One event of a mark, as the portal's tooltip shows it: its attributes, then its date or start and end;
 * with several events on the mark, "‹ i of n events ›" pages through them (the keys do too). Pinned, it
 * stays until clicked again, Esc, or a close; hovered, the pointer may move onto it.
 */
function EventTip({ x, y, events, marks, sampleAttrs, page, pinned, onPage, onClose, onHold, onLeave }: {
  x: number; y: number; events: PatientEvent[]; marks: Map<string, { label: string; color: string }>; page: number; pinned: boolean;
  /** each sample's own clinical attributes, which a sample row's tooltip lists */
  sampleAttrs?: Record<string, [string, string][]>;
  onPage: (n: number) => void; onClose: () => void; onHold: () => void; onLeave: () => void;
}) {
  const n = events.length, i = Math.min(page, n - 1), e = events[i];
  if (!e) return null;
  const sid = attr(e, "SAMPLE_ID");
  const m = sid ? marks.get(sid) : undefined;
  return (
    <FloatingTip x={x} y={y} className="tl-tip">
      <div onMouseEnter={onHold} onMouseLeave={onLeave}>
        <div className="lead flex items-center gap-1.5">
          <span>{e.type}{m ? <> · sample {m.label}</> : null}</span>
          {n > 1 && <span className="ml-auto flex items-center gap-1">
            <button type="button" className="px-1" aria-label="previous event" onClick={() => onPage((i - 1 + n) % n)}>‹</button>
            <span className="dim">{i + 1} of {n} events</span>
            <button type="button" className="px-1" aria-label="next event" onClick={() => onPage((i + 1) % n)}>›</button>
          </span>}
          {pinned && <button type="button" className="px-1" aria-label="close the tooltip" onClick={onClose}>×</button>}
        </div>
        {sid && SAMPLE_TRACK.test(canonicalEventName(e.type)) ? <SampleRows e={e} sid={sid} own={sampleAttrs?.[sid] || []} /> : <table><tbody>
          {e.attrs.filter(([a]) => !/^STYLE_/i.test(a)).map(([a, v], j) => <tr key={j}><th>{a.replace(/_/g, " ")}</th><td>{v}</td></tr>)}
          <tr><th>{e.end != null && e.end > e.start ? "START" : "DATE"}</th><td>{formatDays(e.start)} <span className="dim">(day {e.start})</span></td></tr>
          {e.end != null && e.end > e.start && <tr><th>END</th><td>{formatDays(e.end)} <span className="dim">(day {e.end})</span></td></tr>}
        </tbody></table>}
      </div>
    </FloatingTip>
  );
}

/**
 * A sample row's tooltip as the portal's (PAT-TL-TT-3): SAMPLE ID, then the event's attributes merged
 * with the sample's own clinical attributes, keys upper-cased with spaces for "_", sorted by key, then
 * START DATE. (The portal repeats SAMPLE ID among the attributes; listed once here.)
 */
function SampleRows({ e, sid, own }: { e: PatientEvent; sid: string; own: [string, string][] }) {
  const rows = sampleTipRows(e, own);
  return (
    <table><tbody>
      <tr><th>SAMPLE ID</th><td className="mono">{sid}</td></tr>
      {rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}
      <tr><th>START DATE</th><td>{formatDays(e.start)} <span className="dim">(day {e.start})</span></td></tr>
    </tbody></table>
  );
}
