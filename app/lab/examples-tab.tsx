"use client";
// The Examples tab: the documented analyses (lib/dsl-reference.ts EXAMPLES), filtered by one view kind
// or topic (lib/example-features.ts) and by a search over their text. Both belong to the page, which
// keeps them while this unmounts; the search box keeps its own draft and hands it over after a pause,
// so a keystroke re-renders this tab, not the page. The examples are written against the
// public warehouse's studies; where this deployment's database does not hold them (EXAMPLES_URL,
// lib/site.ts), Run opens each on the deployment that does, after saying the reader is leaving.
import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Link2, Play, Search } from "lucide-react";
import { EXAMPLES, type DslExample } from "../../lib/dsl-reference.ts";
import { exampleFeatures, matchesSearch, studiesOf } from "../../lib/example-features.ts";
import { Button } from "../_ui/button";
import { Input } from "../_ui/input";
import { cn } from "../../lib/cn";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../_ui/dialog";
import { usePublicEnv } from "../_env/public-env-context.tsx";
import { parseExamplesUrl } from "../../lib/site.ts";
import type { CohortDef } from "../../lib/types.ts";
import { Tabs, TabsList, TabsTrigger } from "../_ui/tabs";
import CohortPills from "./pills";
import { isNewKind } from "../../lib/new-in-lab.ts";
import { NewMark } from "./new-mark.tsx";

/** a tag filter: an outline chip, filled while it is the one shown */
const TAG = "group rounded-pill px-2.5 text-sm font-normal aria-pressed:border-link aria-pressed:bg-link aria-pressed:text-card aria-pressed:hover:bg-link/90 aria-pressed:hover:text-card";
const TAG_N = "text-muted-foreground group-aria-pressed:text-card/80";
const FEATURES = new Map(EXAMPLES.map(e => [e, exampleFeatures(e)]));
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
const VIEWS = [...new Set([...FEATURES.values()].flatMap(f => f.views))].sort(byName);
const TOPICS = [...new Set([...FEATURES.values()].flatMap(f => f.topics))].sort(byName);
/** chips (a view kind, or a topic) under which at least one example draws a NEW view */
const HAS_NEW = new Set([...FEATURES.values()].filter(f => f.views.some(isNewKind)).flatMap(f => [...f.views.filter(isNewKind), ...f.topics]));
const has = (ex: DslExample, t: string) => { const f = FEATURES.get(ex)!; return f.views.includes(t) || f.topics.includes(t); };

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };

/** Where this deployment's gallery examples run (EXAMPLES_URL, lib/site.ts): null for here, else the
 *  deployment that holds their studies; with an error when the setting is not a URL. */
export function useExamplesUrl(): { examplesUrl: string | null; examplesUrlError: string | null } {
  const raw = usePublicEnv().EXAMPLES_URL;
  try { return { examplesUrl: parseExamplesUrl(raw), examplesUrlError: null }; }
  catch (e) { return { examplesUrl: null, examplesUrlError: String((e as Error)?.message || e) }; }
}

/** An example cohort: a definition to preview, analyse or save, one per kind of clause. */
export type ExampleCohort = { name: string; desc: string; def: CohortDef };
export type ExampleEval = { count?: number; error?: string; busy?: boolean } | null;

export function ExamplesTab({ tag, onTag, query, onQuery, busy, onRun, link, elsewhere, elsewhereError, onError, cohorts }: {
  /** the example cohorts' tab: each previewed, analysed or saved on its own */
  cohorts: {
    examples: ExampleCohort[]; evals: Record<string, ExampleEval>; study: string; canSave: boolean;
    onPreview: (ex: ExampleCohort) => void; onAnalyze: (ex: ExampleCohort) => void; onSave: (ex: ExampleCohort) => void;
  };
  tag: string;
  onTag: (t: string) => void;
  /** the search over titles, descriptions and pills */
  query: string;
  onQuery: (q: string) => void;
  busy: boolean;
  onRun: (ex: DslExample) => void;
  /** the example's shareable ?doc= link — on the deployment that runs it */
  link: (ex: DslExample) => string;
  /** the deployment the examples run on: null for this one */
  elsewhere: string | null;
  /** why `elsewhere` could not be read, if it could not */
  elsewhereError: string | null;
  onError: (msg: string) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [sub, setSub] = useState<"analyses" | "cohorts">("analyses");
  // the example whose Run is waiting on the reader's go-ahead to leave this site
  const [leaving, setLeaving] = useState<DslExample | null>(null);
  const run = (ex: DslExample) => { if (elsewhere) setLeaving(ex); else onRun(ex); };
  const runWhy = elsewhereError ? "can't tell where examples run on this site: " + elsewhereError : null;
  const copy = async (ex: DslExample) => {
    try { await navigator.clipboard.writeText(link(ex)); setCopied(ex.title); setTimeout(() => setCopied(null), 1800); }
    catch { onError("could not copy to clipboard"); }
  };
  const [draft, setDraft] = useState(query);
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => {
    if (draft === query) return;
    const t = setTimeout(() => onQuery(draft), 250);
    return () => clearTimeout(t);
  }, [draft, query, onQuery]);
  // hand a draft still waiting on its pause to the page when the tab is left
  useEffect(() => () => onQuery(latest.current), [onQuery]);
  const searched = EXAMPLES.filter(e => matchesSearch(e, draft));
  const shown = tag === "all" ? searched : searched.filter(e => has(e, tag));
  const chip = (t: string) => {
    const n = searched.filter(e => has(e, t)).length;
    return (
      <Button key={t} variant="outline" size="xs" className={cn(TAG, n === 0 && "opacity-50")} aria-pressed={tag === t} onClick={() => onTag(tag === t ? "all" : t)}>
        {t} <span className={TAG_N}>{n}</span>{HAS_NEW.has(t) && <NewMark />}
      </Button>
    );
  };

  return (
    <div>
      <Tabs value={sub} onValueChange={(v) => setSub(v as typeof sub)} className="mb-3">
        <TabsList aria-label="examples" className="h-8">
          <TabsTrigger value="analyses" className="px-3 text-md">Analyses</TabsTrigger>
          <TabsTrigger value="cohorts" className="px-3 text-md">Cohorts</TabsTrigger>
        </TabsList>
      </Tabs>
      {sub === "cohorts" && <ExampleCohorts {...cohorts} />}
      {sub === "analyses" && <>
      <div className="card">
        <h2>Examples <span className="plain">— every one of these is executed by the test gate</span></h2>
        <p className="note exintro">
          These are the same analysis documents that <code>docs/dsl.md</code> is generated from, and{" "}
          <code>npm run docs:check</code> runs each of them against the live compiler on every build — so an
          example that stopped working would fail the suite rather than sit here broken. Running one loads it
          into the Analysis tab, where you can edit the JSON and re-run.
        </p>
        {elsewhere && (
          <p className="note exintro">
            They are written for the public cBioPortal datasets, which this site's database does not hold, so
            each one opens on <a href={elsewhere} target="_blank" rel="noopener noreferrer">{hostOf(elsewhere)}</a>,
            in a new tab.
          </p>
        )}
        <div data-tw className="mt-2.5 flex flex-wrap items-center gap-2.5">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" className="exsearch h-8 bg-card pl-8 text-md md:text-md" aria-label="search examples"
              placeholder="search titles, descriptions and pills" value={draft} onChange={(e) => setDraft(e.target.value)} />
          </div>
          <span className="exshown text-sm text-muted-foreground">
            {shown.length === EXAMPLES.length ? `${EXAMPLES.length} examples` : `${shown.length} of ${EXAMPLES.length} examples`}
          </span>
          <Button variant="outline" size="xs" className={TAG} aria-pressed={tag === "all"} onClick={() => onTag("all")}>
            all <span className={TAG_N}>{searched.length}</span>
          </Button>
        </div>
        <div className="extags exfacet"><span className="exfacet-l">views</span>{VIEWS.map(chip)}</div>
        <div className="extags exfacet"><span className="exfacet-l">topics</span>{TOPICS.map(chip)}</div>
      </div>

      {shown.length === 0 && (
        <div className="card exempty">
          No examples match{draft.trim() && <> “{draft.trim()}”</>}{tag !== "all" && <> under <strong>{tag}</strong></>}.{" "}
          {draft && <Button variant="link" size="inline" onClick={() => setDraft("")}>clear the search</Button>}
          {draft && tag !== "all" && " or "}
          {tag !== "all" && <Button variant="link" size="inline" onClick={() => onTag("all")}>show all</Button>}
        </div>
      )}

      <div className="exgrid">
        {shown.map(ex => {
          const cohortNames = Object.keys(ex.doc.cohorts || {});
          const studies = studiesOf(ex);
          const { views, topics } = FEATURES.get(ex)!;
          return (
            <div className="card excard" key={ex.title}>
              <h3>{ex.title}{views.some(isNewKind) && <NewMark />}</h3>
              <div className="extags small">
                {views.map(k => <span key={k} className="vkind" title="a view this example draws">{k}</span>)}
                {topics.map(t => <span key={t} className="extag is-static">{t}</span>)}
              </div>
              {ex.demonstrates && <p className="exdem">{ex.demonstrates}</p>}
              {ex.customData?.length ? <p className="meta flush">
                <span className="customtag">custom</span>
                Runs on demo data bundled with the app: {ex.customData.map((d) => d.name + " (" + d.rows.length + " " + d.level + "s)").join(", ")}.
              </p> : null}
              <p className="exnote">{ex.note}</p>
              <div className="exmeta">
                <span title={studies.join(", ")}>
                  {studies.length === 1 ? studies[0] : studies.length + " studies"}
                </span>
                <span>{cohortNames.length} cohort{cohortNames.length === 1 ? "" : "s"}: {cohortNames.join(", ")}</span>
              </div>
              <details>
                <summary className="meta">document</summary>
                <pre className="exjson">{JSON.stringify(ex.doc, null, 2)}</pre>
              </details>
              <div className="row exactions">
                <Button size="sm" onClick={() => run(ex)} disabled={busy || !!runWhy} title={runWhy || undefined}>
                  {elsewhere ? <ExternalLink /> : <Play />}Run{elsewhere && " on " + hostOf(elsewhere)}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => copy(ex)}>
                  {copied === ex.title ? <Check /> : <Link2 />}{copied === ex.title ? "Copied" : "Copy link"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      </>}
      {leaving && elsewhere && (
        <Dialog open onOpenChange={(open) => { if (!open) setLeaving(null); }}>
          <DialogContent data-tw className="leavedialog gap-3 sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base">You are leaving this site</DialogTitle>
              <DialogDescription>
                “{leaving.title}” is written for the public cBioPortal datasets, which this site's database does
                not hold. It will open on <strong>{hostOf(elsewhere)}</strong> in a new tab, where it runs on the
                public data, not on this site's.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="items-center">
              <Button type="button" variant="ghost" onClick={() => setLeaving(null)}>Cancel</Button>
              <Button type="button" onClick={() => { window.open(link(leaving), "_blank", "noopener,noreferrer"); setLeaving(null); }}>
                <ExternalLink />Open on {hostOf(elsewhere)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/**
 * The example cohorts, one per kind of clause: each previewed (its size), analysed on its own, or
 * saved to the library. One with no study runs in the study the page is on.
 */
function ExampleCohorts({ examples, evals, study, canSave, onPreview, onAnalyze, onSave }: {
  examples: ExampleCohort[]; evals: Record<string, ExampleEval>; study: string; canSave: boolean;
  onPreview: (ex: ExampleCohort) => void; onAnalyze: (ex: ExampleCohort) => void; onSave: (ex: ExampleCohort) => void;
}) {
  return (
    <div className="card excohorts">
      <h2>Example cohorts <span className="plain">— one for each kind of clause; those that name no study run in {study}</span></h2>
      {examples.map((ex) => {
        const ev = evals[ex.name];
        const where = ex.def.studies?.length ? ex.def.studies.join(" + ") : ex.def.study || study;
        return (
          <div key={ex.name} className="listrow">
            <div className="listrow-head">
              <strong>{ex.name}</strong>
              <span className="meta">{ex.desc}</span>
              <span className="meta">{where}</span>
              {ev && ev.count != null && <span className="meta"><strong>{ev.count.toLocaleString()}</strong> pts</span>}
              {ev && ev.busy && <span className="spinner" />}
              <span className="spacer" />
              <Button variant="link" size="inline" onClick={() => onPreview(ex)}>preview</Button>
              <Button variant="link" size="inline" onClick={() => onAnalyze(ex)}>analyze</Button>
              <Button variant="link" size="inline" onClick={() => onSave(ex)}
                title={canSave ? "save it to your library" : "sign in to save it to your library"}>save to library</Button>
            </div>
            {ev && ev.error && <div className="error">{ev.error}</div>}
            <div className="listrow-body"><CohortPills def={ex.def} /></div>
          </div>
        );
      })}
    </div>
  );
}
