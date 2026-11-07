"use client";
// The evolution view's card: one patient's mutations across their samples (cBioPortal's Genomic
// Evolution tab) — the figure (lib/views/evolution/figure.ts, the drawing MCP sends) at the card's
// width, its display settings beside it, and the mutation table (app/_table/DataTable.tsx) whose
// query decides what the figure draws. The navigator steps through the cohort's patients
// (app/lab/patient-nav.tsx); the cohort is the header's picker, as for every view.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DataTable, specQuery } from "../_table/DataTable.tsx";
import { evolutionSvg, evolutionKey, EVOLUTION_KEY_COLUMNS } from "../../lib/views/evolution/figure.ts";
import type { TableQuery } from "../../lib/types";
import type { EvolutionMutation, EvolutionResult, EvolutionSample } from "../../lib/views/evolution/types";
import { PatientNav, PatientsDialog, patientKeys, type PatientKey } from "./patient-nav.tsx";
import { Button } from "../_ui/button";
import { Checkbox } from "../_ui/checkbox";
import { TB } from "../_ui/toolbar.ts";

type Spec = { patient?: PatientKey; chart?: "line" | "heatmap"; sequential?: boolean; logScale?: boolean; dataRange?: boolean; mutations?: Record<string, unknown> } & Record<string, unknown>;

export function EvolutionBody({ v, spec, vi, updating, docJson, patch, fixed }: {
  v: { evolution: EvolutionResult; caveat?: string } & Record<string, unknown>; spec: Spec; vi: number; updating: boolean; docJson?: () => string; patch: (p: Record<string, unknown>) => void;
  /** one patient only (the Patient page): no navigator through the cohort's others */
  fixed?: boolean;
}) {
  const e = v.evolution;
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [listOpen, setListOpen] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(420, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const p = e.patient;
  const svg = useMemo(() => evolutionSvg(v as never, { width, caption: false }), [v, width]);
  // the mutation under the pointer, on a line, a heatmap row or a table row: the others are dimmed
  const [hot, setHot] = useState<string | null>(null);
  // the mutations clicked (a line, a heatmap row or a table row; a second click lets go): they stay picked out
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [pickedFor, setPickedFor] = useState(p ? p.study + ":" + p.id : "");
  if ((p ? p.study + ":" + p.id : "") !== pickedFor) { setPickedFor(p ? p.study + ":" + p.id : ""); setPicked(new Set()); }
  const toggle = (key: string) => setPicked((was) => { const n = new Set(was); if (!n.delete(key)) n.add(key); return n; });
  // the point under the pointer: its mutation, its sample, and where its tooltip points (in the figure's box)
  const [tip, setTip] = useState<{ key: string; s: number; x: number; y: number; below: number | null } | null>(null);
  const fig = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = fig.current;
    if (!el) return;
    // the page draws its own tooltip for a mutation's marks; the SVG's titles are for readers without it
    el.querySelectorAll("[data-key] title").forEach((t) => t.remove());
  }, [svg]);
  useEffect(() => {
    const el = fig.current;
    if (!el) return;
    el.classList.toggle("evo-hot", hot != null || picked.size > 0);
    el.querySelectorAll("[data-key]").forEach((g) => { const k = g.getAttribute("data-key")!; g.classList.toggle("hot", k === hot || picked.has(k)); });
  }, [hot, picked, svg]);
  const keyAt = useMemo(() => {
    const cols = e.mutations?.columns || [];
    const at = EVOLUTION_KEY_COLUMNS.map((id) => cols.findIndex((c) => c.id === id));
    return (r: { values: (string | number | null)[] }) => evolutionKey(at.map((i) => i < 0 ? null : r.values[i]));
  }, [e.mutations]);
  const overFigure = (ev: React.MouseEvent) => {
    const g = (ev.target as Element).closest?.("[data-key]");
    const key = g?.getAttribute("data-key") ?? null;
    setHot(key);
    if (!g || !key || !fig.current) { setTip(null); return; }
    // the sample: the mark under the pointer, or on a line the nearest of its points
    const marks = Array.from(g.querySelectorAll("[data-s]"));
    const under = (ev.target as Element).closest("[data-s]");
    const centre = (m: Element) => { const r = m.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top, m }; };
    const pick = under ? centre(under) : marks.map(centre).sort((a, b) => Math.hypot(a.x - ev.clientX, a.y - ev.clientY) - Math.hypot(b.x - ev.clientX, b.y - ev.clientY))[0];
    if (!pick) { setTip(null); return; }
    const box = fig.current.getBoundingClientRect();
    const r = pick.m.getBoundingClientRect();
    setTip({ key, s: Number(pick.m.getAttribute("data-s")), x: pick.x - box.left, y: pick.y - box.top, below: pick.y - box.top < TIP_ROOM ? r.bottom - box.top : null });
  };
  const clickFigure = (ev: React.MouseEvent) => { const k = (ev.target as Element).closest?.("[data-key]")?.getAttribute("data-key"); if (k) toggle(k); };
  const tipped = tip ? e.drawn?.find((m) => m.key === tip.key) : undefined;
  const go = (to: PatientKey | null | undefined) => { if (to && !updating) patch({ patient: to }); };
  const isSel = (row: { study: string; patient: string }) => p != null && row.study === p.study && row.patient === p.id;
  const setQuery = (q: TableQuery) => {
    const rows = (spec.mutations as { rows?: number } | undefined)?.rows;
    const next = Object.fromEntries(Object.entries({ ...q, rows }).filter(([, x]) => x !== undefined));
    patch({ mutations: Object.keys(next).length ? next : undefined });
  };
  const chart = spec.chart || "line";
  const noDayWhy = e.noDay?.length ? "no collection day is recorded for " + e.noDay.join(", ") + ", so the samples are drawn in sequence" : null;

  return (
    // eslint-disable-next-line jsx-a11y-x/no-static-element-interactions -- arrow-key shortcuts for the patient buttons PatientNav already provides
    <div className="tl-view" tabIndex={-1} onKeyDown={patientKeys(e.position, go)}>
      {!fixed && <PatientNav shown={p ? p.id : null} position={e.position} total={e.total} updating={updating} go={go} what="draw it"
        openList={() => setListOpen(true)} first={() => patch({ patient: undefined })} />}
      {p ? (
        <div className="tl-head">
          <span className="tl-who mono">{p.id}</span>
          <span className="meta">{p.study}</span>
          {p.samples.map((m) => (
            <span key={m.id} className="tl-sample" data-tip={m.id + (m.type ? " — " + m.type : "") + (m.day != null ? ", collected day " + m.day : "") + (m.panel ? ", panel " + m.panel : ", not sequenced for mutations")}>
              <svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="7" fill={m.color} /><text x="7" y="7" dy=".33em" textAnchor="middle" fontSize="9" fill="white">{m.label}</text></svg>
              <span className="mono">{m.id}</span>
            </span>))}
          <div className="viewtb tl-settings">
            <div className="tbz">
              <Button type="button" variant={chart === "line" ? "default" : "outline"} size="sm" className={TB} aria-pressed={chart === "line"}
                data-tip="a line per mutation through its VAF in each sample" onClick={() => patch({ chart: undefined })}>Line chart</Button>
              <Button type="button" variant={chart === "heatmap" ? "default" : "outline"} size="sm" className={TB} aria-pressed={chart === "heatmap"}
                data-tip="a row per mutation, a column per sample, coloured by VAF" onClick={() => patch({ chart: "heatmap" })}>Heatmap</Button>
            </div>
            <div className="tbz">
              <label className="chk" data-tip={noDayWhy || "place the samples evenly in their order rather than by the day each was collected"}>
                <Checkbox checked={!!spec.sequential || !!e.noDay?.length} disabled={!!e.noDay?.length || chart === "heatmap"} onCheckedChange={(on) => patch({ sequential: (on === true) || undefined })} /> sequential
              </label>
              <label className="chk" data-tip={chart === "heatmap" ? "the heatmap's colours always run from 0 to 1" : "the y axis on a log scale; a VAF of 0 sits at its floor, 0.001"}>
                <Checkbox checked={!!spec.logScale} disabled={chart === "heatmap"} onCheckedChange={(on) => patch({ logScale: (on === true) || undefined })} /> log scale
              </label>
              <label className="chk" data-tip={chart === "heatmap" ? "the heatmap's colours always run from 0 to 1" : "the y axis spans the VAFs drawn rather than 0 to 1"}>
                <Checkbox checked={!!spec.dataRange} disabled={chart === "heatmap"} onCheckedChange={(on) => patch({ dataRange: (on === true) || undefined })} /> y axis to data range
              </label>
            </div>
          </div>
        </div>
      ) : <p className="meta">No patient to draw: the cohort has no patient with two or more samples and allele counts.</p>}
      <div ref={box} className={"tl-fig" + (updating ? " stale" : "")}>
        {/* eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions -- a pointer-only highlight (as the table's clickable rows are); it changes nothing the view shows or shares */}
        {p && (svg ? <div className="evo-fig-wrap"><div ref={fig} className="evo-fig" onMouseMove={overFigure} onClick={clickFigure} onMouseLeave={() => { setHot(null); setTip(null); }} dangerouslySetInnerHTML={{ __html: svg }} />
            {tip && tipped && p.samples[tip.s] && <EvolutionTip m={tipped} sample={p.samples[tip.s]} s={tip.s} x={tip.x} y={tip.below ?? tip.y} below={tip.below != null} />}</div>
          : <p className="meta tl-empty">{e.undrawn ? "Not drawn: " + e.undrawn + "." : "No mutation the table keeps has an allele frequency to draw."}</p>)}
      </div>
      {p && <p className="note vfoot">The figure draws every mutation the table below keeps — filter or search it to follow only some. Hover a line, a heatmap row or a table row to pick out that mutation in both; click to keep it picked out.
        {picked.size > 0 && <> {picked.size.toLocaleString()} picked — <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setPicked(new Set())}>clear selection</Button></>}</p>}
      {p && e.mutations && (
        <section className="alt-table" aria-label="Mutations">
          <DataTable t={e.mutations} query={specQuery((spec.mutations || {}) as Record<string, unknown>)} updating={updating} vi={vi} docJson={docJson} table="mutations" unit="Mutations"
            onQuery={setQuery} onHover={(r) => setHot(r ? keyAt(r) : null)} hot={(r) => hot != null && keyAt(r) === hot}
            onRow={(r) => toggle(keyAt(r))} selected={(r) => picked.has(keyAt(r))} num={(id, x) => id === "maxVaf" ? x.toFixed(2) : x.toLocaleString()}
            cell={(id, x) => id === "gene" ? <b>{x}</b> : id === "samples" ? <SampleMarks ids={String(x || "").split(", ").filter(Boolean)} samples={p.samples} /> : undefined} />
        </section>
      )}
      {listOpen && (
        <PatientsDialog title={"Patients of " + (e.lists[0]?.cohort ?? "the cohort") + " with two or more samples"} onClose={() => setListOpen(false)}>
          {(close) => (
            <DataTable t={e} query={specQuery(spec)} updating={updating} vi={vi} docJson={docJson} unit="patients"
              title="choose a patient" onQuery={(q) => patch({ ...q })}
              onRow={(row) => { if (!isSel(row)) patch({ patient: { study: row.study, id: row.patient } }); close(); }} selected={isSel}
              cell={(id, x) => id === "patient" ? <span className="mono">{x}</span> : undefined} />
          )}
        </PatientsDialog>
      )}
    </div>
  );
}

/** room a tooltip needs above its point; nearer the figure's top it opens below (the figure scrolls sideways, so it clips) */
const TIP_ROOM = 125;

/** A mark's tooltip, as the portal's: the mutation, the sample, and its VAF with the reads behind it. */
function EvolutionTip({ m, sample, s, x, y, below }: { m: EvolutionMutation; sample: EvolutionSample; s: number; x: number; y: number; below: boolean }) {
  const c = m.cells[s];
  const reads = c.alt != null && c.ref != null ? " (" + c.alt.toLocaleString() + " reads of " + (c.alt + c.ref).toLocaleString() + " total)" : "";
  const state = c.status === "called" ? "VAF: " + c.vaf!.toFixed(2) + reads
    : c.status === "uncalled" ? "VAF: " + c.vaf!.toFixed(2) + reads + ", uncalled"
    : c.status === "absent" ? "Not found (VAF 0)" + (c.alt != null && c.ref != null ? " in " + (c.alt + c.ref).toLocaleString() + " reads" : "")
    : c.status === "noVaf" ? "Called, no allele counts" : "Not profiled for " + m.gene;
  // kept inside the figure: shifted sideways near its edges, the arrow still on the point
  const el = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const t = el.current, box = t?.parentElement;
    if (!t || !box) return;
    const half = t.offsetWidth / 2, room = box.clientWidth;
    setShift(x - half < 4 ? 4 - (x - half) : x + half > room - 4 ? room - 4 - (x + half) : 0);
  }, [x, m, s]);
  return (
    <div ref={el} className={"evo-tip" + (below ? " below" : "")} role="tooltip" style={{ left: x + shift, top: y, ["--arrow" as string]: "calc(50% - " + shift + "px)" }}>
      <div>Gene: {m.gene}</div>
      <div>Protein Change: {m.proteinChange}</div>
      <div>Sample ID: {sample.id}</div>
      <div>{state}</div>
    </div>
  );
}

/** The samples a mutation was called in, as their numbered markers. */
function SampleMarks({ ids, samples }: { ids: string[]; samples: EvolutionSample[] }) {
  return (
    <span className="alt-samples" aria-label={"called in " + ids.join(", ")}>
      {ids.map((id) => {
        const m = samples.find((s) => s.id === id);
        return (
          <svg key={id} width="14" height="14" aria-hidden="true" data-tip={id + (m?.type ? " — " + m.type : "")}>
            <circle cx="7" cy="7" r="7" fill={m?.color || "var(--muted)"} />
            <text x="7" y="7" dy=".33em" textAnchor="middle" fontSize="9" fill="white">{m?.label || "?"}</text>
          </svg>);
      })}
    </span>
  );
}
