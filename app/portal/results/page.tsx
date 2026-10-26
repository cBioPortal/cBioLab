"use client";
// cBioPortal's Results page for a gene query, laid out as the portal lays it out: one tab per
// portal tab over the queried patients, and Comparison/Survival comparing those altered in any of
// the genes with the profiled rest. What is
// queried is one study (?study=) or several (?studies=a,b), narrowed by Explore's filters
// (?filters=) or not; ?genes= is the query, as OQL. The page's state — every setting changed on
// it — is one analysis document built by results-layout.ts, whose changes travel in ?changes=
// (page-doc.ts).
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PortalTabs } from "../PortalTabs";
import { useQueryKnown, expressionProfile, discreteCnaProfile, assayComparisonProfiles } from "../study-known";
import { decodeDoc, usePageDoc } from "../page-doc";
import { resultsLayout } from "../results-layout.ts";
import { Button } from "../../_ui/button";
import { TB } from "../../_ui/toolbar.ts";
import { Pencil } from "lucide-react";
import CohortPills from "../../lab/pills.tsx";
import { usePublicEnv } from "../../_env/public-env-context.tsx";
import { fmtInt } from "../../../lib/chart/format.ts";
import { PortalSummary, PortalLoading } from "../portal-chrome.tsx";
import { SiteHeader } from "../../_ui/site-header.tsx";
import { RESULTS_MAX_GENES, readResultsTarget, studiesProblem } from "../query-editor.tsx";
import { QueryFlow } from "../../_home/query-flow.tsx";
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
  const linked = useMemo(() => decodeDoc(q.get("doc")), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const { known, error } = useQueryKnown(tooMany ? [] : studies, filters);
  const across = expressionAcross(studies, crossStudyExpression(env));
  const fresh = useMemo(() => known && genes.length && genes.length <= RESULTS_MAX_GENES && !queryError
    ? resultsLayout({ studies, filters, entries: check.entries.map((e) => e.text), genes }, {
        expr: expressionProfile(known.profileCatalog), cna: discreteCnaProfile(known.profileCatalog), clinical: known.clinical,
        numeric: known.attrs.filter((a) => a.kind === "num").map((a) => a.attribute), expressionAcross: across, held: known.held,
        assays: assayComparisonProfiles(known.profileCatalog) })
    : null, [known, studies, filters, check, genes, queryError, across]);
  const page = usePageDoc(fresh, linked);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [editing, setEditing] = useState(false);
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
  // Altered and Unaltered are the profiled patients; the rest of the queried are named, not compared
  const altered = counts?.Altered, profiled = counts ? (counts.Altered ?? 0) + (counts.Unaltered ?? 0) : 0;
  const unprofiled = counts && counts.Queried != null ? counts.Queried - profiled : null;
  const ids = studies.length <= IDS_SHOWN ? studies.join(", ") : studies.slice(0, IDS_SHOWN).join(", ") + " +" + (studies.length - IDS_SHOWN) + " more";
  // as cBioPortal does: no expression profiles to draw across studies its rule does not allow
  const profiles = known ? known.profiles.filter((p) => across || !isExpressionProfile(p)) : [];
  const profileCatalog = known ? known.profileCatalog.filter((p) => across || !isExpressionType(p.type)) : [];
  return shell(<>
    <PortalSummary eyebrow="Query results" title={known ? known.name : studies.length === 1 ? studies[0] : studies.length + " studies"} study={ids}
      studyTitle={studies.map((s) => s + (known?.names[s] ? " — " + known.names[s] : "")).join("\n")} genes={check.entries.map((e) => e.text)}
      detail={known && <span className="tabular-nums">{filters.length ? fmtInt(known.patients) + " patients after filters" : fmtInt(known.samples) + " samples · " + fmtInt(known.patients) + " patients"}</span>}
      groups={Object.keys(fresh?.doc.cohorts || {})} counts={counts} left={fresh?.left || []}
      stat={altered != null && profiled ? { value: altered, of: profiled, label: "of " + fmtInt(profiled) + " profiled patients altered in " + (check.entries.length === 1 ? check.entries[0].text : "any of the " + check.entries.length + " query lines") } : null}
      action={<Button variant="outline" size="sm" className={TB} aria-expanded={editing} onClick={() => setEditing((e) => !e)}><Pencil />Modify query</Button>}>
      {filters.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold tracking-[0.12em] text-muted-foreground uppercase">Filters</span>
          <CohortPills def={{ all: filters }} />
        </div>
      )}
      {(unprofiled || oqlNarrows) ? (
        <p className="mt-2.5 mb-0 text-sm text-muted-foreground">
          {unprofiled ? fmtInt(unprofiled) + " queried patient" + (unprofiled === 1 ? " was" : "s were") + " not profiled for the query's genes, so Comparison/Survival leaves them out of both Altered and Unaltered. " : ""}
          {oqlNarrows ? "The query's OQL decides who is Altered; the oncoprint and the gene tabs draw every alteration of " + (genes.length === 1 ? "its gene." : "its genes.") : ""}
        </p>
      ) : null}
    </PortalSummary>
    {editing && <QueryFlow initial={target} className="mb-4" />}
    {page.note && <p className="note">{page.note}</p>}
    {!ready
      ? <PortalLoading />
      : <PortalTabs doc={page.doc!} tabs={fresh!.tabs} titles={fresh!.titles} open={page.open} onOpen={page.openTab} onDoc={page.update}
          catalog={{ attrs: known!.attrs, profiles, profileCatalog, loading: false }}
          onCounts={(c) => setCounts((o) => o || c)} />}
  </>);
}
