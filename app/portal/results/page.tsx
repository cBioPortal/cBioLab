"use client";
// cBioPortal's Results page for a gene query, laid out as the portal lays it out: one tab per
// portal tab over the queried patients, and Comparison/Survival comparing those altered in any of
// the genes with the profiled rest. What is
// queried is one study (?study=) or several (?studies=a,b), narrowed by Explore's filters
// (?filters=) or not; ?genes= is the query, as OQL. The page's state — every setting changed on
// it — is one analysis document built by results-layout.ts, whose changes travel in ?changes=
// (page-doc.ts).
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PortalTabs } from "../PortalTabs";
import { useQueryKnown, expressionProfile, discreteCnaProfile, assayComparisonProfiles } from "../study-known";
import { usePageDoc } from "../page-doc";
import { resultsLayout } from "../results-layout.ts";
import { Button } from "../../_ui/button";
import { TB } from "../../_ui/toolbar.ts";
import { Pencil } from "lucide-react";
import CohortPills from "../../lab/pills.tsx";
import { usePublicEnv } from "../../_env/public-env-context.tsx";
import { fmtInt } from "../../../lib/chart/format.ts";
import { api } from "../../lab/api.ts";
import { PortalSummary, PortalLoading } from "../portal-chrome.tsx";
import { SiteHeader } from "../../_ui/site-header.tsx";
import { QueryGenesDialog, RESULTS_MAX_GENES, readResultsTarget, studiesProblem } from "../query-editor.tsx";
import { QueryFlow } from "../../_home/query-flow.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../_ui/dialog";
import { checkGeneQuery } from "../../../lib/gene-query.ts";
import { resultsMaxStudies, crossStudyExpression, expressionAcross, isExpressionProfile, isExpressionType } from "../../../lib/results-settings.ts";

const IDS_SHOWN = 3;

export default function ResultsPage() {
  const q = useSearchParams();
  const env = usePublicEnv();
  const qs = q.toString();
  const target = useMemo(() => readResultsTarget(new URLSearchParams(qs)), [qs]);
  const { studies, filters } = target;
  const check = useMemo(() => checkGeneQuery(target.query, "oql"), [target.query]);
  const genes = check.genes;
  const queryError = check.error || check.entries.filter((e) => e.error).map((e) => e.text + ": " + e.error).join("; ") || null;
  const oqlNarrows = check.entries.some((e) => e.meaning !== "any alteration");
  const tooMany = studiesProblem(studies.length, resultsMaxStudies(env));
  const { basics, known, error } = useQueryKnown(tooMany ? [] : studies, filters);
  const across = expressionAcross(studies, crossStudyExpression(env));
  // laid out in two steps: from the study list the tabs that need nothing else, so the oncoprint
  // starts at once; with the profiles and attributes Explore's facets give, the rest
  const fresh = useMemo(() => basics && genes.length && genes.length <= RESULTS_MAX_GENES && !queryError
    ? resultsLayout({ studies, filters, entries: check.entries.map((e) => e.text), genes }, known ? {
        expr: expressionProfile(known.profileCatalog), cna: discreteCnaProfile(known.profileCatalog), clinical: known.clinical,
        numeric: known.attrs.filter((a) => a.kind === "num").map((a) => a.attribute), expressionAcross: across, held: known.held,
        assays: assayComparisonProfiles(known.profileCatalog) }
      : { expr: null, cna: null, clinical: [], numeric: [], expressionAcross: across, held: basics.held, partial: true })
    : null, [basics, known, studies, filters, check, genes, queryError, across]);
  const page = usePageDoc(fresh);
  // the header's "altered in N of the queried": its own request, beside the tabs', so no tab waits for it
  const [altered, setAltered] = useState<{ altered: number; queried: number } | null>(null);
  const groups = fresh?.doc.cohorts;
  const groupsKey = JSON.stringify(groups || null);
  useEffect(() => {
    setAltered(null);
    if (!groups) return;
    const ctl = new AbortController();
    api.analysis({ study: fresh!.doc.study, cohorts: { Altered: groups.Altered, Queried: groups.Queried }, views: [] }, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => { if (!j.error) setAltered({ altered: j.cohorts?.Altered?.count ?? 0, queried: j.cohorts?.Queried?.count ?? 0 }); })
      .catch(() => {});
    return () => ctl.abort();
  }, [groupsKey]);   // eslint-disable-line react-hooks/exhaustive-deps -- `groupsKey` is the groups, by value
  const [modifying, setModifying] = useState(false);
  const [editingGenes, setEditingGenes] = useState(false);
  const shell = (body: React.ReactNode) => <><SiteHeader page="query results" /><main className="analysis-main">{body}</main></>;
  // a query that is not one yet, or cannot be read, opens the homepage's flow at the step it needs
  const flow = (note?: string | null) => shell(<>
    {note && <div className="error">{note}</div>}
    <QueryFlow initial={target} />
  </>);
  if (target.error || !studies.length || !genes.length) return flow(target.error);
  if (queryError) return flow("this query cannot be read — " + queryError);
  if (tooMany) return flow(tooMany);
  if (genes.length > RESULTS_MAX_GENES) return shell(<p className="note">a results page takes at most {RESULTS_MAX_GENES} genes, the oncoprint&apos;s rows; this asks for {genes.length}</p>);
  if (error) return shell(<div className="error">{error}</div>);
  const ready = !!(fresh && page.doc);
  const ids = studies.length <= IDS_SHOWN ? studies.join(", ") : studies.slice(0, IDS_SHOWN).join(", ") + " +" + (studies.length - IDS_SHOWN) + " more";
  // as cBioPortal does: no expression profiles to draw across studies its rule does not allow
  const profiles = known ? known.profiles.filter((p) => across || !isExpressionProfile(p)) : [];
  const profileCatalog = known ? known.profileCatalog.filter((p) => across || !isExpressionType(p.type)) : [];
  return shell(<>
    <PortalSummary eyebrow="Query results" title={basics ? basics.name : studies.length === 1 ? studies[0] : studies.length + " studies"} study={ids}
      studyTitle={studies.map((s) => s + (basics?.names[s] ? " — " + basics.names[s] : "")).join("\n")} genes={check.entries.map((e) => e.text)}
      detail={known && <span className="tabular-nums">{filters.length ? fmtInt(known.patients) + " patients after filters" : fmtInt(known.samples) + " samples · " + fmtInt(known.patients) + " patients"}</span>}
      onEditGenes={() => setEditingGenes(true)} left={fresh?.left || []}
      stat={altered && altered.queried ? { value: altered.altered, of: altered.queried, label: "of " + fmtInt(altered.queried) + " queried patients altered in the queried genes" } : null}
      action={<Button variant="outline" size="sm" className={TB} aria-haspopup="dialog" onClick={() => setModifying(true)}><Pencil />Modify query</Button>}>
      {filters.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold tracking-[0.12em] text-muted-foreground uppercase">Filters</span>
          <CohortPills def={{ all: filters }} />
        </div>
      )}
      {oqlNarrows && (
        <p className="mt-2.5 mb-0 text-sm text-muted-foreground">
          The query&apos;s OQL decides who is Altered; the oncoprint and the gene tabs draw every alteration of {genes.length === 1 ? "its gene." : "its genes."}
        </p>
      )}
    </PortalSummary>
    <QueryGenesDialog target={editingGenes ? { studies, filters, query: target.query, title: "Edit genes" } : null}
      names={new Map(Object.entries(basics?.names || {}))} onClose={() => setEditingGenes(false)} />
    <Dialog open={modifying} onOpenChange={setModifying}>
      <DialogContent aria-describedby={undefined}
        className="modifyquerydialog flex h-[90vh] w-[94vw] max-w-[94vw] flex-col gap-3 overflow-auto p-6 sm:max-w-[94vw]">
        <DialogHeader><DialogTitle className="text-base">Modify query</DialogTitle></DialogHeader>
        {modifying && <QueryFlow initial={target} explore={false} />}
      </DialogContent>
    </Dialog>
    {page.note && <p className="note">{page.note}</p>}
    {!ready
      ? <PortalLoading />
      : <PortalTabs doc={page.doc!} tabs={fresh!.tabs} titles={fresh!.titles} partial={fresh!.partial} open={page.open} onOpen={page.openTab} onDoc={page.update}
          catalog={{ attrs: known?.attrs || [], profiles, profileCatalog, loading: !known }} />}
  </>);
}
