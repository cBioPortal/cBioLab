"use client";
// cBioPortal's Patient page for one patient of one study (?study=&patient=, or the portal's own
// ?studyId=&caseId=), laid out as the portal lays it out: Summary (genomic overview, alterations,
// timeline), Pathways, Clinical Data, and the portal's other tabs, which say what they will show
// until their views exist. With ?sample= (the portal's ?sampleId=) it is the portal's sample view:
// the same page over that one sample. The header (patient-header.tsx) lists the patient's samples
// as the portal's does, a sample's id opening its sample view. The page's state is one analysis
// document built by patient-layout.ts, whose changes travel in ?changes= (page-doc.ts); a switch
// between patient and sample remounts it, as the portal's page is keyed by its ids. With ?cohort=
// (Explore's "View patients") it steps through that cohort's patients (cohort-nav.tsx); with a
// cohort and no patient it opens the cohort's first.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useAddressLink, useLinkParams } from "../../_links/use-link.ts";
import { PortalTabs } from "../PortalTabs";
import { useStudyKnown } from "../study-known";
import { usePageDoc } from "../page-doc";
import { patientLayout, SAMPLE_COHORT, type PatientQuery } from "../patient-layout.ts";
import { PortalSummary, PortalLoading } from "../portal-chrome.tsx";
import { SiteHeader } from "../../_ui/site-header.tsx";
import { api } from "../../lab/api.ts";
import type { ViewPageBody } from "../../../lib/api-schemas.ts";
import { PatientHeader, usePatientRecord } from "../patient-header.tsx";
import { CohortNav, navLink, useCohortPosition } from "../cohort-nav.tsx";
import { navigationFromHash, navigationParams, patientHref, readNavigation, type CohortNavigation } from "../cohort-navigation.ts";

const ID = /[^A-Za-z0-9._-]/g;

/** the page's hash changes: a link followed within the page, Back and Forward */
function subscribeHash(on: () => void): () => void {
  window.addEventListener("hashchange", on);
  window.addEventListener("popstate", on);
  return () => { window.removeEventListener("hashchange", on); window.removeEventListener("popstate", on); };
}

/** The patient a sample belongs to, read through the sample table view; null while it loads. */
function useSamplePatient(study: string, sample: string): { patient: string | null; error: string | null } {
  const [out, setOut] = useState<{ patient: string | null; error: string | null }>({ patient: null, error: null });
  useEffect(() => {
    if (!study || !sample) return;
    setOut({ patient: null, error: null });
    let live = true;
    api.analysis({ study, cohorts: { [SAMPLE_COHORT]: { study, all: [{ kind: "sampleList", ids: [study + ":" + sample] }] } },
      views: [{ kind: "table", unit: "sample", cohorts: [SAMPLE_COHORT], columns: [] }] })
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        const v = j.views?.[0];
        const row = v?.table?.rows?.[0];
        if (j.error || v?.error) setOut({ patient: null, error: j.error || v.error });
        else if (!row) setOut({ patient: null, error: "no sample " + sample + " in " + study });
        else setOut({ patient: String(row.patient), error: null });
      })
      .catch((e) => { if (live) setOut({ patient: null, error: String(e) }); });
    return () => { live = false; };
  }, [study, sample]);
  return out;
}

/**
 * Whether the patient is one the Genomic Evolution view can draw — two or more samples and a
 * mutation with a VAF above 0, the portal's condition for its tab — read as one row of the view's
 * patient list; null while it loads, and true when it fails, so the tab is laid out and says why.
 */
function useEvolutionDrawable(study: string, patient: string | null, samples: number | undefined): boolean | null {
  const [out, setOut] = useState<boolean | null>(null);
  const wanted = !!(study && patient && (samples ?? 0) > 1);
  useEffect(() => {
    if (!wanted) return;
    setOut(null);
    const ctl = new AbortController();
    api.viewPage({ doc: { study, cohorts: { [EVOLUTION_COHORT]: { study, all: [{ kind: "patientList", ids: [study + ":" + patient] }] } },
      views: [{ kind: "evolution", cohorts: [EVOLUTION_COHORT], columns: ["patient"] }] } as ViewPageBody["doc"], view: 0, offset: 0, limit: 1 }, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => setOut(j.error ? true : Number(j.total) > 0))
      .catch(() => { if (!ctl.signal.aborted) setOut(true); });
    return () => ctl.abort();
  }, [study, patient, wanted]);
  return wanted ? out : false;
}
const EVOLUTION_COHORT = "Patient";

export default function PatientPage() {
  const q = useLinkParams();
  const study = (q.get("study") || q.get("studyId") || "").replace(ID, "");
  const sample = (q.get("sample") || q.get("sampleId") || "").replace(ID, "");
  // as on the portal, a sample in the link makes it the sample view, whatever patient is named too
  const patient = sample ? "" : (q.get("patient") || q.get("caseId") || "").replace(ID, "");
  const link = useAddressLink();
  // a cbioportal.org link's cohort rides in the hash (#navCaseIds=), which only the browser sees; read on every render
  // (a client navigation fires no hashchange), null until the page runs in the browser
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => null);
  const router = useRouter();
  const { nav, error, hashNote } = useMemo(() => {
    const fromQuery = readNavigation(q, link);
    if (fromQuery.nav || fromQuery.error || !hash) return { ...fromQuery, hashNote: null };
    const h = navigationFromHash(hash);
    return { nav: h.nav, error: null, hashNote: h.error };
  }, [q, link, hash]);
  const fromHash = !!nav && !q.get("cohort") && !!hash?.includes("navCaseIds");
  // the link's patients become the page's own cohort link once, stored past the address's limit, so every link after carries it short
  const [hashFailed, setHashFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!fromHash || !nav) return;
    const to = { ...(study ? { study } : {}), ...(sample ? { sample } : patient ? { patient } : {}), ...(q.get("tab") ? { tab: q.get("tab")! } : {}) };
    navLink("/portal/patient", nav, to).then((href) => router.replace(href)).catch((e) => setHashFailed(String((e as Error)?.message || e)));
  }, [fromHash]);   // eslint-disable-line react-hooks/exhaustive-deps -- once, for the link the page opened with
  if (error) return <><SiteHeader page="patient" /><main className="analysis-main"><div className="error">{error}</div></main></>;
  if (hash === null || (fromHash && !hashFailed)) return <><SiteHeader page="patient" /><main className="analysis-main"><PortalLoading /></main></>;
  if (hashFailed) return <><SiteHeader page="patient" /><main className="analysis-main"><div className="error">this link's patients could not be opened: {hashFailed}</div></main></>;
  if (nav && !patient && !sample) return <CohortStart nav={nav} tab={q.get("tab")} />;
  return <PatientView key={study + "|" + patient + "|" + sample} study={study} patient={patient} sample={sample} nav={nav} tab={q.get("tab")} note={hashNote} />;
}

/** A cohort with no patient named yet: open its first patient. */
function CohortStart({ nav, tab }: { nav: CohortNavigation; tab: string | null }) {
  const router = useRouter();
  const { list, error } = useCohortPosition(nav, null);
  const first = list?.rows[0];
  useEffect(() => { if (first) router.replace(patientHref({ study: first.study, id: first.patient }, nav, tab)); }, [first, nav, tab, router]);
  const body = error ? <div className="error">the cohort's patients could not be listed: {error}</div>
    : list && !first ? <p className="note">No patients in this cohort{list.excluded?.length ? " that may be listed here (" + list.excluded.map((x) => x.study + ": " + x.reason).join("; ") + ")" : ""}.</p>
    : <PortalLoading />;
  return <><SiteHeader page="patient" /><main className="analysis-main">{body}</main></>;
}

/** The page's link for the patient view or a sample's: the open tab and the cohort being stepped through kept, the rest of the page's state left behind. */
function hrefFor(study: string, to: { patient: string } | { sample: string }, nav: CohortNavigation | null, tab: string | null): string {
  return "/portal/patient?" + new URLSearchParams({ study, ...to, ...(tab ? { tab } : {}), ...navigationParams(nav) }).toString();
}

function PatientView({ study, patient, sample, nav, tab, note }: { study: string; patient: string; sample: string; nav: CohortNavigation | null; tab: string | null;
  /** why the link's cohort is not stepped through (an unreadable #navCaseIds): the patient is shown without the pager */
  note?: string | null }) {
  const { basics, known, error } = useStudyKnown(study && (patient || sample) ? study : "");
  const owner = useSamplePatient(study, sample);
  const owned = sample ? owner.patient : patient;
  const { record, error: recordError, missing } = usePatientRecord(study, owned);
  const vaf = useEvolutionDrawable(sample ? "" : study, owned, record?.samples.length);
  const query: PatientQuery | null = sample ? { study, sample } : patient ? { study, patient } : null;
  // laid out from the study list at once; the profiles only add the Mutational Signatures tab
  const fresh = useMemo(() => basics && query
    ? patientLayout(query, { profileCatalog: known?.profileCatalog || [], held: basics.held.every, partial: !known || (!sample && (!record || vaf == null)), samples: record?.samples.length, vaf: vaf ?? undefined })
    : null, [basics, known, study, patient, sample, record, vaf]);   // eslint-disable-line react-hooks/exhaustive-deps -- `query` is rebuilt every render from these ids
  const page = usePageDoc(fresh);
  const shell = (body: React.ReactNode) => <><SiteHeader page={sample ? "sample" : "patient"} /><main className="analysis-main">{body}</main></>;
  if (!study || !query) return shell(<p className="note">This page shows one patient, or one sample: give the study and the patient as <code>?study=&lt;study id&gt;&amp;patient=&lt;patient id&gt;</code>, or a sample as <code>?study=&lt;study id&gt;&amp;sample=&lt;sample id&gt;</code>.</p>);
  if (error || owner.error) return shell(<div className="error">{error || owner.error}</div>);
  if (missing) return shell(<div className="error">{recordError}</div>);
  const ready = !!(page.layout && page.doc);
  return shell(<>
    <PortalSummary eyebrow={sample ? "Sample" : "Patient"} title={sample || patient} study={study}
      detail={basics && <span>{basics.name}</span>}
      left={fresh?.left || []}
      aside={nav && owned ? <CohortNav nav={nav} at={{ study, id: owned }} tab={tab} /> : undefined}>
      {record
        ? <PatientHeader record={record} sample={sample || null} hrefFor={(to) => hrefFor(study, to, nav, tab)} />
        : recordError ? <p className="note">{recordError}</p>
        : <div data-tw className="mt-3 flex flex-col gap-1.5" role="status" aria-label="loading the patient's header"><span className="skeleton h-5 w-96" /><span className="skeleton h-5 w-80" /></div>}
    </PortalSummary>
    {note && <p className="note" role="status">The pager is not shown: {note}.</p>}
    {page.note && <p className="note">{page.note}</p>}
    {!ready
      ? <PortalLoading />
      : <PortalTabs legacy={{ page: { page: "patient", study, ...(sample ? { sample } : { patient }) }, held: basics?.portal || null }} doc={page.doc!} tabs={page.layout!.tabs} titles={page.layout!.titles} partial={page.layout!.partial} open={page.open} onOpen={page.openTab} onDoc={page.update}
          catalog={{ attrs: known?.attrs || [], profiles: known?.profiles || [], profileCatalog: known?.profileCatalog || [], loading: !known }} fixedPatient />}
  </>);
}
