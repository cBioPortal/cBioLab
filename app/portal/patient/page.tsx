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
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PortalTabs } from "../PortalTabs";
import { useStudyKnown } from "../study-known";
import { usePageDoc } from "../page-doc";
import { patientLayout, SAMPLE_COHORT, type PatientQuery } from "../patient-layout.ts";
import { PortalSummary, PortalLoading } from "../portal-chrome.tsx";
import { SiteHeader } from "../../_ui/site-header.tsx";
import { api } from "../../lab/api.ts";
import { PatientHeader, usePatientRecord } from "../patient-header.tsx";
import { CohortNav, useCohortPosition } from "../cohort-nav.tsx";
import { navigationParams, patientHref, readNavigation, type CohortNavigation } from "../cohort-navigation.ts";

const ID = /[^A-Za-z0-9._-]/g;

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

export default function PatientPage() {
  const q = useSearchParams();
  const study = (q.get("study") || q.get("studyId") || "").replace(ID, "");
  const sample = (q.get("sample") || q.get("sampleId") || "").replace(ID, "");
  // as on the portal, a sample in the link makes it the sample view, whatever patient is named too
  const patient = sample ? "" : (q.get("patient") || q.get("caseId") || "").replace(ID, "");
  const { nav, error } = useMemo(() => readNavigation(q), [q]);
  if (error) return <><SiteHeader page="patient" /><main className="analysis-main"><div className="error">{error}</div></main></>;
  if (nav && !patient && !sample) return <CohortStart nav={nav} tab={q.get("tab")} />;
  return <PatientView key={study + "|" + patient + "|" + sample} study={study} patient={patient} sample={sample} nav={nav} tab={q.get("tab")} />;
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

function PatientView({ study, patient, sample, nav, tab }: { study: string; patient: string; sample: string; nav: CohortNavigation | null; tab: string | null }) {
  const { known, error } = useStudyKnown(study && (patient || sample) ? study : "");
  const owner = useSamplePatient(study, sample);
  const owned = sample ? owner.patient : patient;
  const { record, error: recordError } = usePatientRecord(study, owned);
  const query: PatientQuery | null = sample ? { study, sample } : patient ? { study, patient } : null;
  const fresh = useMemo(() => known && query
    ? patientLayout(query, { profileCatalog: known.profileCatalog, held: known.held.every })
    : null, [known, study, patient, sample]);   // eslint-disable-line react-hooks/exhaustive-deps -- `query` is rebuilt every render from these ids
  const page = usePageDoc(fresh);
  const shell = (body: React.ReactNode) => <><SiteHeader page={sample ? "sample" : "patient"} /><main className="analysis-main">{body}</main></>;
  if (!study || !query) return shell(<p className="note">This page shows one patient, or one sample: give the study and the patient as <code>?study=&lt;study id&gt;&amp;patient=&lt;patient id&gt;</code>, or a sample as <code>?study=&lt;study id&gt;&amp;sample=&lt;sample id&gt;</code>.</p>);
  if (error || owner.error) return shell(<div className="error">{error || owner.error}</div>);
  const ready = !!(fresh && page.doc);
  return shell(<>
    <PortalSummary eyebrow={sample ? "Sample" : "Patient"} title={sample || patient} study={study}
      detail={known && <span>{known.name}</span>}
      left={fresh?.left || []}
      aside={nav && owned ? <CohortNav nav={nav} at={{ study, id: owned }} tab={tab} /> : undefined}>
      {record
        ? <PatientHeader record={record} sample={sample || null} hrefFor={(to) => hrefFor(study, to, nav, tab)} />
        : recordError ? <p className="note">{recordError}</p>
        : <div data-tw className="mt-3 flex flex-col gap-1.5" role="status" aria-label="loading the patient's header"><span className="skeleton h-5 w-96" /><span className="skeleton h-5 w-80" /></div>}
    </PortalSummary>
    {page.note && <p className="note">{page.note}</p>}
    {!ready
      ? <PortalLoading />
      : <PortalTabs doc={page.doc!} tabs={fresh!.tabs} titles={fresh!.titles} open={page.open} onOpen={page.openTab} onDoc={page.update}
          catalog={{ attrs: known!.attrs, profiles: known!.profiles, profileCatalog: known!.profileCatalog, loading: false }} fixedPatient />}
  </>);
}
