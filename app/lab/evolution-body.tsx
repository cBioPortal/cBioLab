"use client";
// The evolution view's card: one patient's mutations across their samples (cBioPortal's Genomic
// Evolution tab) — the figure (lib/views/evolution/figure.ts, the drawing MCP sends) at the card's
// width, its display settings beside it, and the mutation table (app/_table/DataTable.tsx) whose
// query decides what the figure draws. The navigator steps through the cohort's patients
// (app/lab/patient-nav.tsx); the cohort is the header's picker, as for every view.
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { DataTable, specQuery } from "../_table/DataTable.tsx";
import { evolutionSvg } from "../../lib/views/evolution/figure.ts";
import type { TableQuery } from "../../lib/types";
import type { EvolutionResult, EvolutionSample } from "../../lib/views/evolution/types";
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
        {p && (svg ? <div dangerouslySetInnerHTML={{ __html: svg }} />
          : <p className="meta tl-empty">{e.undrawn ? "Not drawn: " + e.undrawn + "." : "No mutation the table keeps has an allele frequency to draw."}</p>)}
      </div>
      {p && <p className="note vfoot">The figure draws every mutation the table below keeps — filter or search it to follow only some. Hover a line or a cell for its reads.</p>}
      {p && e.mutations && (
        <section className="alt-table" aria-label="Mutations">
          <DataTable t={e.mutations} query={specQuery((spec.mutations || {}) as Record<string, unknown>)} updating={updating} vi={vi} docJson={docJson} table="mutations" unit="Mutations"
            onQuery={setQuery} num={(id, x) => id === "maxVaf" ? x.toFixed(2) : x.toLocaleString()}
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
