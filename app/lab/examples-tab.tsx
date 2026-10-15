"use client";
// The Examples tab: the documented analyses (lib/dsl-reference.ts EXAMPLES), filtered by tag. The
// tag belongs to the page, which keeps it while this unmounts. The examples are written against the
// public warehouse's studies; where this deployment's database does not hold them (EXAMPLES_URL,
// lib/site.ts), Run opens each on the deployment that does, after saying the reader is leaving.
import { useState } from "react";
import { Check, ExternalLink, Link2, Play } from "lucide-react";
import { EXAMPLES, type DslExample } from "../../lib/dsl-reference.ts";
import { Button } from "../_ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../_ui/dialog";
import { usePublicEnv } from "../_env/public-env-context.tsx";
import { parseExamplesUrl } from "../../lib/site.ts";

/** a tag filter: an outline chip, filled while it is the one shown */
const TAG = "group rounded-pill px-2.5 text-sm font-normal aria-pressed:border-link aria-pressed:bg-link aria-pressed:text-card aria-pressed:hover:bg-link/90 aria-pressed:hover:text-card";
const TAG_N = "text-muted-foreground group-aria-pressed:text-card/80";
const TAGS = [...new Set(EXAMPLES.flatMap(e => e.tags || []))].sort();
const viewKinds = (ex: DslExample): string[] => [...new Set((ex.doc.views || []).map(v => String(v.kind)))];
const studiesOf = (ex: DslExample): string[] => [...new Set(Object.values(ex.doc.cohorts || {})
  .flatMap((c: any) => (c && c.studies) || (c && c.study ? [c.study] : []))
  .concat(ex.doc.study ? [ex.doc.study] : []))];

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };

/** Where this deployment's gallery examples run (EXAMPLES_URL, lib/site.ts): null for here, else the
 *  deployment that holds their studies; with an error when the setting is not a URL. */
export function useExamplesUrl(): { examplesUrl: string | null; examplesUrlError: string | null } {
  const raw = usePublicEnv().EXAMPLES_URL;
  try { return { examplesUrl: parseExamplesUrl(raw), examplesUrlError: null }; }
  catch (e) { return { examplesUrl: null, examplesUrlError: String((e as Error)?.message || e) }; }
}

export function ExamplesTab({ tag, onTag, busy, onRun, link, elsewhere, elsewhereError, onError }: {
  tag: string;
  onTag: (t: string) => void;
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
  // the example whose Run is waiting on the reader's go-ahead to leave this site
  const [leaving, setLeaving] = useState<DslExample | null>(null);
  const run = (ex: DslExample) => { if (elsewhere) setLeaving(ex); else onRun(ex); };
  const runWhy = elsewhereError ? "can't tell where examples run on this site: " + elsewhereError : null;
  const copy = async (ex: DslExample) => {
    try { await navigator.clipboard.writeText(link(ex)); setCopied(ex.title); setTimeout(() => setCopied(null), 1800); }
    catch { onError("could not copy to clipboard"); }
  };
  const shown = tag === "all" ? EXAMPLES : EXAMPLES.filter(e => (e.tags || []).includes(tag));

  return (
    <div>
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
        <div className="extags">
          <Button variant="outline" size="xs" className={TAG} aria-pressed={tag === "all"} onClick={() => onTag("all")}>
            all <span className={TAG_N}>{EXAMPLES.length}</span>
          </Button>
          {TAGS.map(t => (
            <Button key={t} variant="outline" size="xs" className={TAG} aria-pressed={tag === t} onClick={() => onTag(t)}>
              {t} <span className={TAG_N}>{EXAMPLES.filter(e => (e.tags || []).includes(t)).length}</span>
            </Button>
          ))}
        </div>
      </div>

      <div className="exgrid">
        {shown.map(ex => {
          const cohortNames = Object.keys(ex.doc.cohorts || {});
          const studies = studiesOf(ex);
          const kinds = viewKinds(ex);
          return (
            <div className="card excard" key={ex.title}>
              <h3>{ex.title}</h3>
              <div className="extags small">
                {kinds.map(k => <span key={k} className="vkind">{k}</span>)}
                {(ex.tags || []).filter(t => !kinds.includes(t)).map(t => <span key={t} className="extag is-static">{t}</span>)}
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
