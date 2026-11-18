"use client";
// The Explore page's Clinical Data tab, as cBioPortal's study view draws it
// (docs/legacy-spec/parity/clinical-tab-cases.md): a row per selected sample with a column per
// visible clinical-attribute chart, searched and sorted in the database, 20 rows a page, and its
// download. The rows are the clinical `table` view's, the patient-level path (docs/DATA-BOUNDARY.md).
import { useEffect, useMemo, useState } from "react";
import { DataTable } from "../_table/DataTable.tsx";
import { patientHref, sampleHref } from "../portal/cohort-navigation.ts";
import { api } from "./api.ts";
import { runCaseFile } from "./chart-files.ts";
import { clinicalCell, clinicalTabColumns, clinicalTabDoc, type TabChart } from "../../lib/study-view-clinical-tab.ts";
import { caseFileName, type CaseFile } from "../../lib/study-view-case-files.ts";
import type { TableQuery } from "../../lib/table-query.ts";
import type { TableResult } from "../../lib/views/table/types.ts";
import type { CohortDef } from "../../lib/types.ts";

export interface ClinicalTabProps {
  /** the selection: the draft (or every selected study), in the first study's document */
  selection: { def: CohortDef; study: string } | null;
  /** the selected studies, for the download's name */
  studies: string[];
  /** the visible clinical-attribute charts */
  charts: TabChart[];
}

export function ClinicalDataTab({ selection, studies, charts }: ClinicalTabProps) {
  const [query, setQuery] = useState<TableQuery>({});
  const columns = useMemo(() => clinicalTabColumns(charts), [charts]);
  const doc = useMemo(() => selection ? clinicalTabDoc(selection.def, selection.study, columns, query) : null, [selection, columns, query]);
  const docText = doc ? JSON.stringify(doc) : "";
  /** the shown table and the document it came from; `failed`, the document whose request failed with `error` */
  const [res, setRes] = useState<{ doc: string; shown?: { query: TableQuery; columns: string[] }; table?: TableResult; error?: string; failed?: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!doc) return;
    const ac = new AbortController();
    api.analysis(doc, { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => {
        if (ac.signal.aborted) return;
        const v = j.views?.[0];
        // a failed refetch keeps the table it had, so the search box and the page stay
        setRes((prev) => j.error || !v || v.error || !v.table
          ? { doc: prev?.doc ?? docText, shown: prev?.shown, table: prev?.table, error: String(j.error || v?.error || "the table returned nothing"), failed: docText }
          : { doc: docText, shown: { query, columns }, table: v.table });
      })
      .catch((e) => { if (!ac.signal.aborted) setRes((prev) => ({ doc: prev?.doc ?? docText, shown: prev?.shown, table: prev?.table, error: String((e as Error)?.message || e), failed: docText })); });
    return () => ac.abort();
  }, [docText]);   // eslint-disable-line react-hooks/exhaustive-deps -- keyed on docText, the string form of doc

  if (!selection) return <div className="card"><p className="note">Select a study first.</p></div>;
  if (!res) return <div className="card"><p className="waiting" role="status"><span className="spinner" /> loading clinical data…</p></div>;
  if (!res.table) return <div className="card"><p className="note">Could not load the clinical data: {res.error}</p></div>;
  const updating = res.doc !== docText && res.failed !== docText;
  // the file lists the rows shown: after a failed update, those of the last query that answered
  const asShown = res.failed === docText && res.shown ? res.shown : { query, columns };
  const file: CaseFile = { kind: "tab", columns: asShown.columns, query: asShown.query, studies: studies.length };
  const fileName = caseFileName(file, "", studies);
  const download = () => { void runCaseFile(file, fileName, selection, setMessage, setSaving); };
  return (
    <div className="card" data-tab="clinical-data">
      {res.failed === docText && <p className="note">Could not update the clinical data: {res.error}</p>}
      <DataTable t={res.table} query={{ ...query, columns }} updating={updating} vi={0} docJson={() => res.doc} unit="results" plain oneCohort
        onQuery={(q) => setQuery({ ...(q.search ? { search: q.search } : {}), ...(q.sort ? { sort: q.sort } : {}) })}
        download={{ label: saving ? "preparing…" : "Download", disabled: saving,
          tip: "every row the search keeps, the columns shown, as " + fileName, onClick: download }}
        cell={(id, x, row) => {
          const v = x == null ? "" : String(x);
          if (id === "patient" || id === "sample")
            return <a className="mono" href={id === "patient" ? patientHref({ study: row.study, id: v }, null) : sampleHref(row.study, v)} target="_blank" rel="noreferrer">{v}</a>;
          const kind = clinicalCell(v);
          if (kind === "missing") return <span className="meta" data-tip="No data available">—</span>;
          if (kind === "url") return <a href={v} target="_blank" rel="noreferrer">{v}</a>;
          return undefined;
        }} />
      {message && <p className="note">{message}</p>}
    </div>
  );
}
