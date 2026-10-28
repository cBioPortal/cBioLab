"use client";
// cBioPortal's Patient page for one patient of one study (?study=&patient=, or the portal's own
// ?studyId=&caseId=), laid out as the portal lays it out: Summary (genomic overview, alterations,
// timeline), Pathways, Clinical Data, and the portal's other tabs, which say what they will show
// until their views exist. The page's state is one analysis document built by patient-layout.ts,
// whose changes travel in ?changes= (page-doc.ts).
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { PortalTabs } from "../PortalTabs";
import { useStudyKnown } from "../study-known";
import { decodeDoc, usePageDoc } from "../page-doc";
import { patientLayout, PATIENT_COHORT } from "../patient-layout.ts";
import { PortalSummary, PortalLoading } from "../portal-chrome.tsx";
import { SiteHeader } from "../../_ui/site-header.tsx";

const ID = /[^A-Za-z0-9._-]/g;

export default function PatientPage() {
  const q = useSearchParams();
  const study = (q.get("study") || q.get("studyId") || "").replace(ID, "");
  const patient = (q.get("patient") || q.get("caseId") || "").replace(ID, "");
  const linked = useMemo(() => decodeDoc(q.get("doc")), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const { known, error } = useStudyKnown(study && patient ? study : "");
  const fresh = useMemo(() => known && patient
    ? patientLayout({ study, patient }, { profileCatalog: known.profileCatalog, held: known.held.every })
    : null, [known, study, patient]);
  const page = usePageDoc(fresh, linked);
  const shell = (body: React.ReactNode) => <><SiteHeader page="patient" /><main className="analysis-main">{body}</main></>;
  if (!study || !patient) return shell(<p className="note">This page shows one patient: give the study and the patient as <code>?study=&lt;study id&gt;&amp;patient=&lt;patient id&gt;</code>.</p>);
  if (error) return shell(<div className="error">{error}</div>);
  const ready = !!(fresh && page.doc);
  return shell(<>
    <PortalSummary eyebrow="Patient" title={patient} study={study}
      detail={known && <span>{known.name}</span>}
      groups={[PATIENT_COHORT]} counts={null} left={fresh?.left || []} />
    {page.note && <p className="note">{page.note}</p>}
    {!ready
      ? <PortalLoading />
      : <PortalTabs doc={page.doc!} tabs={fresh!.tabs} titles={fresh!.titles} open={page.open} onOpen={page.openTab} onDoc={page.update}
          catalog={{ attrs: known!.attrs, profiles: known!.profiles, profileCatalog: known!.profileCatalog, loading: false }} fixedPatient />}
  </>);
}
