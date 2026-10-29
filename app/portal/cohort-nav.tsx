"use client";
// The Patient page over a cohort, as cBioPortal's patient view steps through the patients a study
// view selected (its navCaseIds): « ‹ [n] of N patients › ». The page carries the cohort's DEFINITION (?cohort=), never its patients: the list's
// order, its length and where the shown patient falls in it are asked of the server — a table view
// over the cohort naming the patient (its `position`), or one row of it at an offset — so a cohort
// of any size is one short link, and one whose clauses hold a long id list names a stored set.
// The list's order (?order=: search, filters, sort) is the list dialog's, so prev / next step
// through what the reader sees there.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../lab/api.ts";
import { Button } from "../_ui/button";
import { DataTable } from "../_table/DataTable.tsx";
import { PatientsDialog } from "../lab/patient-nav.tsx";
import type { AnalysisDoc, TableRows } from "../../lib/types.ts";
import type { TableQuery } from "../../lib/table-query.ts";
import { listDoc, patientHref, type CohortNavigation, type PatientKey } from "./cohort-navigation.ts";

type Position = { index: number; prev: PatientKey | null; next: PatientKey | null } | null;
type ListResult = TableRows<string> & { position?: Position };

async function runList(doc: AnalysisDoc, signal?: AbortSignal): Promise<ListResult> {
  const j = await (await api.analysis(doc, { signal })).json();
  const v = j.views?.[0];
  if (j.error || v?.error) throw new Error(j.error || v.error);
  return v.table as ListResult;
}

/** The patient at `offset` in the navigation's order: one row of the list. */
async function patientAt(nav: CohortNavigation, offset: number): Promise<PatientKey | null> {
  const res = await api.viewPage({ doc: listDoc(nav, { rows: 1, columns: ["patient"] }), view: 0, offset, limit: 1 });
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  const row = j.rows?.[0];
  return row ? { study: String(row.study), id: String(row.patient) } : null;
}

/** Where `at` falls in the cohort's list (null `at`: the list's first patient), and how long the list is. */
export function useCohortPosition(nav: CohortNavigation | null, at: PatientKey | null) {
  const [out, setOut] = useState<{ list: ListResult | null; error: string | null }>({ list: null, error: null });
  const key = nav ? JSON.stringify([nav, at]) : "";
  useEffect(() => {
    if (!nav) return;
    setOut({ list: null, error: null });
    const ctl = new AbortController();
    runList(listDoc(nav, { rows: 1, columns: ["patient"], at }), ctl.signal)
      .then((list) => setOut({ list, error: null }))
      .catch((e) => { if (!ctl.signal.aborted) setOut({ list: null, error: (e as Error).message }); });
    return () => ctl.abort();
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps -- `key` is nav and at, by value
  return out;
}

/**
 * The legacy pager over the cohort: first, previous, the shown patient's number (typed to jump),
 * "of N patients" (opens the list), next and last.
 */
export function CohortNav({ nav, at, tab }: { nav: CohortNavigation; at: PatientKey; tab: string | null }) {
  const router = useRouter();
  const { list, error } = useCohortPosition(nav, at);
  const [jumping, setJumping] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const pos = list?.position ?? null;
  const total = list?.total ?? 0;
  useEffect(() => { setDraft(pos ? String(pos.index + 1) : ""); }, [pos]);
  const go = useCallback((to: PatientKey | null) => { if (to) router.push(patientHref(to, nav, tab)); }, [router, nav, tab]);
  const jump = async (offset: number) => {
    if (!(offset >= 0 && offset < total)) return;
    setJumping(null);
    try { go(await patientAt(nav, offset)); } catch (e) { setJumping((e as Error).message); }
  };
  if (error) return <p data-tw className="text-sm text-destructive" role="alert">the cohort's patients could not be listed: {error}</p>;
  if (!list) return <span data-tw className="skeleton h-8 w-80" role="status" aria-label="placing the patient in the cohort" />;
  const first = !pos || pos.index === 0, last = !pos || pos.index === total - 1;
  const href = (to: PatientKey | null) => to ? patientHref(to, nav, tab) : undefined;
  const IconLink = ({ to, label, children }: { to: PatientKey | null; label: string; children: React.ReactNode }) => to
    ? <Button asChild variant="outline" size="icon-sm" data-tip={label + " (" + to.id + ")"}><Link href={href(to)!} aria-label={label}>{children}</Link></Button>
    : <Button variant="outline" size="icon-sm" disabled data-tip={label} aria-label={label}>{children}</Button>;
  return (
    <div data-tw className="cohort-nav flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5 text-md">
        <Button variant="outline" size="icon-sm" disabled={first} data-tip="the cohort's first patient" aria-label="first patient" onClick={() => void jump(0)}><ChevronFirst /></Button>
        <IconLink to={pos?.prev ?? null} label="previous patient"><ChevronLeft /></IconLink>
        {pos ? (
          <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void jump(Number(draft) - 1); }}>
            <input className="h-8 w-16 rounded-md border bg-background px-1.5 text-right tabular-nums" inputMode="numeric" aria-label="patient number in the cohort"
              data-tip={"type a number from 1 to " + total.toLocaleString() + " and press Enter"} value={draft} onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))} />
            <span className="text-muted-foreground">of</span>
          </form>
        ) : <span className="text-muted-foreground">{at.id} is not in this cohort ·</span>}
        <button type="button" className="text-primary hover:underline" data-tip="list the cohort's patients: search, filter, sort, and pick one" onClick={() => setListOpen(true)}>
          {total.toLocaleString()} patients
        </button>
        <IconLink to={pos?.next ?? null} label="next patient"><ChevronRight /></IconLink>
        <Button variant="outline" size="icon-sm" disabled={last} data-tip="the cohort's last patient" aria-label="last patient" onClick={() => void jump(total - 1)}><ChevronLast /></Button>
      </div>
      {!pos && total > 0 && <Button variant="link" size="xs" onClick={() => void jump(0)}>go to the cohort's first patient</Button>}
      {(list.excluded || []).map((x) => (
        <span key={x.study} className="text-sm text-muted-foreground">{x.patients.toLocaleString()} patients of {x.study} are not listed: it {x.reason}</span>
      ))}
      {jumping && <span className="text-sm text-destructive" role="alert">{jumping}</span>}
      {listOpen && <CohortList nav={nav} at={at} tab={tab} onClose={() => setListOpen(false)} />}
    </div>
  );
}

/** The cohort's patients in the shared table, in a dialog: its search, filters and sort become the navigation's order; a click opens one. */
function CohortList({ nav, at, tab, onClose }: { nav: CohortNavigation; at: PatientKey; tab: string | null; onClose: () => void }) {
  const router = useRouter();
  const [order, setOrder] = useState<TableQuery>(nav.order);
  const [columns, setColumns] = useState<string[] | undefined>(undefined);
  const [state, setState] = useState<{ list: ListResult | null; updating: boolean; error: string | null }>({ list: null, updating: true, error: null });
  const shownNav = useMemo(() => ({ ...nav, order }), [nav, order]);
  const doc = useMemo(() => listDoc(shownNav, { rows: 25, columns }), [shownNav, columns]);
  useEffect(() => {
    setState((s) => ({ ...s, updating: true }));
    const ctl = new AbortController();
    runList(doc, ctl.signal)
      .then((list) => setState({ list, updating: false, error: null }))
      .catch((e) => { if (!ctl.signal.aborted) setState({ list: null, updating: false, error: (e as Error).message }); });
    return () => ctl.abort();
  }, [doc]);
  const isAt = (r: { study: string; patient: string }) => r.study === at.study && r.patient === at.id;
  return (
    <PatientsDialog title={"The cohort's patients"} onClose={onClose}>
      {(close) => state.error ? <p className="error">{state.error}</p>
        : !state.list ? <span className="skeleton h-40 w-full" role="status" aria-label="listing the cohort's patients" />
        : <DataTable t={state.list} query={{ ...order, ...(columns ? { columns } : {}) }} updating={state.updating} vi={0} docJson={() => JSON.stringify(doc)} unit="patients"
            title="choose a patient — the list's order is the order ‹ › step through"
            onQuery={(q) => { setColumns(q.columns); setOrder({ search: q.search, filters: q.filters, sort: q.sort }); }}
            onRow={(row) => { router.push(patientHref({ study: row.study, id: row.patient }, shownNav, tab)); close(); }} selected={isAt}
            cell={(id, x) => id === "patient" ? <span className="font-mono">{x}</span> : undefined} />}
    </PatientsDialog>
  );
}
