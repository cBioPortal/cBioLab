"use client";
// cBioPortal's Results page for a gene query, laid out as the portal lays it out: one tab per
// portal tab over the queried patients, and Comparison/Survival comparing those altered in any of
// the genes with the profiled rest. What is
// queried is one study (?study=) or several (?studies=a,b), narrowed by Explore's filters
// (?filters=) or not; ?genes= is the query, as OQL. The page's state — every setting changed on
// it — is one analysis document built by results-layout.ts, whose changes travel in ?changes=
// (page-doc.ts).
import { useEffect, useMemo, useState } from "react";
import { useLinkParams } from "../../_links/use-link.ts";
import { PortalTabs } from "../PortalTabs";
import { useQueryKnown, expressionProfile, discreteCnaProfile, assayComparisonProfiles } from "../study-known";
import { usePageDoc } from "../page-doc";
import { resultsLayout, samplesLine, svCheckCohort, syncDrivers } from "../results-layout.ts";
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
import type { CohortDef } from "../../../lib/types.ts";
import { resultsMaxStudies, queryProductLimit, crossStudyExpression, expressionAcross, isExpressionProfile, isExpressionType } from "../../../lib/results-settings.ts";
import { useQueryOptionsData } from "../query-options.tsx";
import { chosenQuery, legacyQueryParams, queryLimitProblem } from "../../../lib/query-options.ts";

const IDS_SHOWN = 3;

export default function ResultsPage() {
  const q = useLinkParams();
  const env = usePublicEnv();
  const qs = q.toString();
  const target = useMemo(() => readResultsTarget(new URLSearchParams(qs)), [qs]);
  const { studies, filters } = target;
  const check = useMemo(() => checkGeneQuery(target.query, "oql"), [target.query]);
  const genes = check.genes;
  const queryError = check.error || check.entries.filter((e) => e.error).map((e) => e.text + ": " + e.error).join("; ") || null;
  const tooMany = studiesProblem(studies.length, resultsMaxStudies(env));
  // the query page's profiles and case set, when the link carries them: what they make of the query, and the clause every group keeps
  const optionsData = useQueryOptionsData(target.options && !tooMany ? studies : []);
  const across = expressionAcross(studies, crossStudyExpression(env));
  const chosen = useMemo(() => chosenQuery(target.options || null, optionsData.data, studies, check.entries.map((e) => e.text), across), [target.options, optionsData.data, studies, check, across]);
  // the profiles can write a bare gene's alterations out, which narrows Altered as an OQL entry does
  const oqlNarrows = check.entries.some((e) => e.meaning !== "any alteration") || chosen.entries.some((e, i) => e !== check.entries[i]?.text);
  const scope = useMemo(() => (chosen.clause ? [...filters, chosen.clause] : filters), [filters, chosen.clause]);
  const { basics, known, error } = useQueryKnown(tooMany || chosen.waiting || chosen.error ? [] : studies, scope);
  // laid out in two steps: from the study list the tabs that need nothing else, so the oncoprint
  // starts at once; with the profiles and attributes Explore's facets give, the rest
  // whether the queried patients carry a structural variant in a queried gene: asked beside the header's count (below)
  const [svs, setSvs] = useState<boolean | null | undefined>(undefined);
  const asked = useMemo(() => ({ studies, filters: scope, entries: chosen.entries, genes, exp: chosen.exp, prot: chosen.prot, ifHeld: chosen.ifHeld }), [studies, scope, chosen, genes]);
  const fresh = useMemo(() => basics && genes.length && genes.length <= RESULTS_MAX_GENES && !queryError && !chosen.waiting && !chosen.error
    ? resultsLayout(asked, known ? {
        expr: expressionProfile(known.profileCatalog), cna: discreteCnaProfile(known.profileCatalog), clinical: known.clinical,
        numeric: known.attrs.filter((a) => a.kind === "num").map((a) => a.attribute), expressionAcross: across, held: known.held,
        assays: assayComparisonProfiles(known.profileCatalog), svs }
      : { expr: null, cna: null, clinical: [], numeric: [], expressionAcross: across, held: basics.held, partial: true, svs })
    : null, [basics, known, asked, chosen, genes, queryError, across, svs]);
  const page = usePageDoc(fresh);
  // the header's "altered in N of the queried": its own request, beside the tabs', so no tab waits for it
  const [altered, setAltered] = useState<{ altered: number; queried: number; alteredSamples?: number; queriedSamples?: number } | null>(null);
  const groups = fresh?.doc.cohorts;
  const groupsKey = JSON.stringify(groups || null);
  const svHeld = !!basics && (basics.held.every.includes("SV") || basics.held.some.includes("SV"));
  useEffect(() => {
    setAltered(null);
    setSvs(undefined);
    if (!groups) return;
    const ctl = new AbortController();
    // the Structural Variants tab's check rides on the same request, as a third cohort counted beside these
    const fused: Record<string, CohortDef> = svHeld ? { Fused: svCheckCohort(asked) } : {};
    api.analysis({ study: fresh!.doc.study, cohorts: { Altered: groups.Altered, Queried: groups.Queried, ...fused }, views: [] }, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) { if (svHeld) setSvs(null); return; }
        setAltered({ altered: j.cohorts?.Altered?.count ?? 0, queried: j.cohorts?.Queried?.count ?? 0,
          alteredSamples: j.cohorts?.Altered?.samples, queriedSamples: j.cohorts?.Queried?.samples });
        if (svHeld) setSvs(typeof j.cohorts?.Fused?.count === "number" ? j.cohorts.Fused.count > 0 : null);
      })
      .catch(() => { if (!ctl.signal.aborted && svHeld) setSvs(null); });
    return () => ctl.abort();
  }, [groupsKey, svHeld]);   // eslint-disable-line react-hooks/exhaustive-deps -- `groupsKey` is the groups, by value
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
  if (chosen.error) return flow(chosen.error);
  if (genes.length > RESULTS_MAX_GENES) return shell(<p className="note">a results page takes at most {RESULTS_MAX_GENES} genes, the oncoprint&apos;s rows; this asks for {genes.length}</p>);
  if (error) return shell(<div className="error">{error}</div>);
  // the portal's size limit, checked again here for a link past it (ResultsViewPage's queryExceedsLimit): no tabs
  const big = known ? queryLimitProblem(genes.length, known.samples, queryProductLimit(env)) : null;
  if (big) return shell(<div className="error" role="alert">{big}</div>);
  if (optionsData.error) return shell(<div className="error">could not read the studies&apos; profiles and case sets: {optionsData.error}</div>);
  const ready = !!(page.layout && page.doc);
  const ids = studies.length <= IDS_SHOWN ? studies.join(", ") : studies.slice(0, IDS_SHOWN).join(", ") + " +" + (studies.length - IDS_SHOWN) + " more";
  // as cBioPortal does: no expression profiles to draw across studies its rule does not allow
  const profiles = known ? known.profiles.filter((p) => across || !isExpressionProfile(p)) : [];
  const profileCatalog = known ? known.profileCatalog.filter((p) => across || !isExpressionType(p.type)) : [];
  return shell(<>
    <PortalSummary eyebrow="Query results" title={basics ? basics.name : studies.length === 1 ? studies[0] : studies.length + " studies"} study={ids}
      studyTitle={studies.map((s) => s + (basics?.names[s] ? " — " + basics.names[s] : "")).join("\n")} genes={check.entries.map((e) => e.text)}
      detail={known && <span className="tabular-nums">{filters.length ? fmtInt(known.patients) + " patients after filters" : fmtInt(known.samples) + " samples · " + fmtInt(known.patients) + " patients"}</span>}
      onEditGenes={() => setEditingGenes(true)} left={fresh?.left || []}
      stat={altered && altered.queried ? { value: altered.altered, of: altered.queried, decimals: 0, also: samplesLine(altered),
        label: "of " + fmtInt(altered.queried) + " queried patients altered in the queried genes" } : null}
      action={<Button variant="outline" size="sm" className={TB} aria-haspopup="dialog" onClick={() => setModifying(true)}><Pencil />Modify query</Button>}>
      {filters.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold tracking-[0.12em] text-muted-foreground uppercase">Filters</span>
          <CohortPills def={{ all: filters }} />
        </div>
      )}
      {chosen.summary && (
        <p className="mt-2.5 mb-0 flex flex-wrap gap-x-5 gap-y-1 text-sm" data-test="queryOptionsSummary">
          <span><span className="font-semibold tracking-[0.12em] text-muted-foreground uppercase">Case set</span> {chosen.summary.caseSet}</span>
          <span><span className="font-semibold tracking-[0.12em] text-muted-foreground uppercase">Profiles</span> {chosen.summary.profiles}</span>
        </p>
      )}
      {chosen.notes.map((n) => <p key={n} className="mt-2.5 mb-0 text-sm text-muted-foreground">{n}</p>)}
      {oqlNarrows && (
        <p className="mt-2.5 mb-0 text-sm text-muted-foreground">
          The query&apos;s OQL decides who is Altered; the oncoprint and the gene tabs draw every alteration of {genes.length === 1 ? "its gene." : "its genes."}
        </p>
      )}
    </PortalSummary>
    <QueryGenesDialog target={editingGenes ? { studies, filters, query: target.query, title: "Edit genes", options: target.options } : null} options={false}
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
      : <PortalTabs legacy={{ page: { page: "results", studies, entries: check.entries.map((e) => e.text), filters,
            query: legacyQueryParams(target.options || null, optionsData.data, studies, check.entries.map((e) => e.text)) }, held: basics?.portal || null }} doc={page.doc!} tabs={page.layout!.tabs} titles={page.layout!.titles} partial={page.layout!.partial} open={page.open} onOpen={page.openTab} onDoc={(d) => page.update({ ...d, views: syncDrivers(page.doc?.views || [], d.views || []) })}
          catalog={{ attrs: known?.attrs || [], profiles, profileCatalog, loading: !known }} />}
  </>);
}
