"use client";
// The Examples tab: the documented analyses (lib/dsl-reference.ts EXAMPLES), filtered by tag. The
// tag belongs to the page, which keeps it while this unmounts.
import { useState } from "react";
import { Check, Link2, Play } from "lucide-react";
import { EXAMPLES, type DslExample } from "../../lib/dsl-reference.ts";
import { Button } from "../_ui/button";

/** a tag filter: an outline chip, filled while it is the one shown */
const TAG = "group rounded-pill px-2.5 text-sm font-normal aria-pressed:border-link aria-pressed:bg-link aria-pressed:text-card aria-pressed:hover:bg-link/90 aria-pressed:hover:text-card";
const TAG_N = "text-muted-foreground group-aria-pressed:text-card/80";
const TAGS = [...new Set(EXAMPLES.flatMap(e => e.tags || []))].sort();
const viewKinds = (ex: DslExample): string[] => [...new Set((ex.doc.views || []).map(v => String(v.kind)))];
const studiesOf = (ex: DslExample): string[] => [...new Set(Object.values(ex.doc.cohorts || {})
  .flatMap((c: any) => (c && c.studies) || (c && c.study ? [c.study] : []))
  .concat(ex.doc.study ? [ex.doc.study] : []))];

export function ExamplesTab({ tag, onTag, busy, onRun, link, onError }: {
  tag: string;
  onTag: (t: string) => void;
  busy: boolean;
  onRun: (ex: DslExample) => void;
  /** the example's shareable ?doc= link */
  link: (ex: DslExample) => string;
  onError: (msg: string) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
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
                <Button size="sm" onClick={() => onRun(ex)} disabled={busy}><Play />Run</Button>
                <Button variant="ghost" size="sm" onClick={() => copy(ex)}>
                  {copied === ex.title ? <Check /> : <Link2 />}{copied === ex.title ? "Copied" : "Copy link"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
