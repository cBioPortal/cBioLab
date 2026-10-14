"use client";
// The alterations view's card: one patient's Mutations, Copy Number Alterations and Structural
// Variants tables (cBioPortal's patient view), one under the other, each the shared table
// (app/_table/DataTable.tsx) with its own query in the spec. The navigator above them steps through
// the cohort's patients and opens their list (app/lab/patient-nav.tsx); the cohort is the header's
// picker, as for every view.
import React, { useMemo, useState } from "react";
import { DataTable, specQuery } from "../_table/DataTable.tsx";
import { sampleMarks } from "../../lib/timeline-tracks.ts";
import type { AlterationsResult, TableQuery } from "../../lib/types";
import { AnnotationBadge } from "./portal-bodies";
import { PatientNav, PatientsDialog, patientKeys, type PatientKey } from "./patient-nav.tsx";

type Spec = { patient?: PatientKey } & Record<string, unknown>;

/** The three tables, in the portal's order: the spec's key, and its name — its count line reads "7 Mutations", as the portal's does. */
const TABLES = [
  { key: "mutations", name: "Mutations" },
  { key: "cna", name: "Copy Number Alterations" },
  { key: "sv", name: "Structural Variants" },
] as const;

export function AlterationsBody({ a, spec, vi, updating, docJson, patch }: {
  a: AlterationsResult; spec: Spec; vi: number; updating: boolean; docJson?: () => string; patch: (p: Record<string, unknown>) => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const p = a.patient;
  const marks = useMemo(() => sampleMarks(p?.samples || [], []), [p]);
  const go = (to: PatientKey | null | undefined) => { if (to && !updating) patch({ patient: to }); };
  const isSel = (row: { study: string; patient: string }) => p != null && row.study === p.study && row.patient === p.id;
  // a table's query goes to its own key, keeping its page size; an empty one leaves the key out
  const setQuery = (key: string, q: TableQuery) => {
    const rows = (spec[key] as { rows?: number } | undefined)?.rows;
    const next = Object.fromEntries(Object.entries({ ...q, rows }).filter(([, x]) => x !== undefined));
    patch({ [key]: Object.keys(next).length ? next : undefined });
  };
  // one slot per sample of the patient, in sample order: the sample's marker where it carries the row's alteration,
  // "--" in a slot of the same width where it does not — so a row reads as one alteration across the patient's samples
  const sampleCell = (x: unknown) => {
    const has = new Set(String(x || "").split(", ").filter(Boolean));
    const slots = [...marks.values()].map((m) => ({ id: m.id, label: m.label, color: m.color, type: m.type }));
    for (const id of has) if (!marks.has(id)) slots.push({ id, label: "?", color: "var(--muted)", type: "" });
    return (
      <span className="alt-samples" aria-label={"in " + [...has].join(", ")}>
        {slots.map((m) => {
          const on = has.has(m.id);
          return (
            <svg key={m.id} width="14" height="14" aria-hidden="true">
              <title>{m.id + (m.type ? " — " + m.type : "") + (on ? "" : ": not found in this sample")}</title>
              {on ? <>
                <circle cx="7" cy="7" r="7" fill={m.color} />
                <text x="7" y="7" dy=".33em" textAnchor="middle" fontSize="9" fill="white">{m.label}</text>
              </> : <text x="7" y="7" dy=".33em" textAnchor="middle" fontSize="9" fill="var(--muted)">--</text>}
            </svg>);
        })}
      </span>
    );
  };

  return (
    // eslint-disable-next-line jsx-a11y-x/no-static-element-interactions -- arrow-key shortcuts for the patient buttons PatientNav already provides
    <div className="tl-view" tabIndex={-1} onKeyDown={patientKeys(a.position, go)}>
      <PatientNav shown={p ? p.id : null} position={a.position} total={a.total} updating={updating} go={go} what="list its alterations"
        openList={() => setListOpen(true)} first={() => patch({ patient: undefined })} />
      {p ? (
        <div className="tl-head">
          <span className="tl-who mono">{p.id}</span>
          <span className="meta">{p.study}{p.source?.remote ? " · from " + p.source.label + " over MCP" : ""}</span>
          {[...marks.values()].map((m) => (
            <span key={m.id} className="tl-sample" title={m.id + (m.type ? " — " + m.type : "")}>
              <svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="7" fill={m.color} /><text x="7" y="7" dy=".33em" textAnchor="middle" fontSize="9" fill="white">{m.label}</text></svg>
              <span className="mono">{m.id}</span>
            </span>))}
          <span className="note alt-key">Each row is one alteration in one gene across these samples: a sample's marker where it carries it, -- where it does not. A gene's rows sit together, shaded alike, in sample order.</span>
        </div>
      ) : <p className="meta">No patient to list: the cohort's patient list is empty.</p>}
      {p && TABLES.map(({ key, name }) => {
        const t = a.tables[key];
        if (!t) return null;
        return (
          <section key={key} className="alt-table" aria-label={name}>
            <DataTable t={t} query={specQuery((spec[key] || {}) as Record<string, unknown>)} updating={updating} vi={vi} docJson={docJson} table={key} unit={name} groupBy={key === "sv" ? "gene1" : "gene"}
              onQuery={(q) => setQuery(key, q)}
              num={(id, x) => id === "vaf" ? x.toFixed(2) : id === "freq" ? x.toFixed(1) + "%" : x.toLocaleString()}
              cell={(id, x) => id === "samples" ? sampleCell(x)
                : id === "annotation" ? <AnnotationBadge text={String(x || "")} />
                : id === "cna" && x ? <span className={"alt-cna " + (x === "AMP" ? "amp" : "del")}>{x}</span>
                : id === "gene" || id === "gene1" || id === "gene2" ? <b>{x}</b>
                : undefined} />
          </section>);
      })}
      {listOpen && (
        <PatientsDialog title={"Patients of " + (a.lists[0]?.cohort ?? "the cohort")} onClose={() => setListOpen(false)}>
          {(close) => (
            <DataTable t={a} query={specQuery(spec)} updating={updating} vi={vi} docJson={docJson} unit="patients"
              title="choose a patient" onQuery={(q) => patch({ ...q })}
              onRow={(row) => { if (!isSel(row)) patch({ patient: { study: row.study, id: row.patient } }); close(); }} selected={isSel}
              cell={(id, x) => id === "patient" ? <span className="mono">{x}</span> : undefined} />
          )}
        </PatientsDialog>
      )}
    </div>
  );
}
