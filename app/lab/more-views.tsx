"use client";
// Cards for the view kinds in lib/views-more.ts. The page draws every one of them the same way —
// ViewHead, then this kind's controls, then the server-rendered figure — so all that differs
// per kind lives here: its title, whether it takes a gene list, and its own settings.
import React, { useEffect, useState } from "react";

/**
 * A text field that keeps what is being typed to itself and hands the page the value only on
 * Enter or blur — the page is one large component, and a keystroke in page state re-renders
 * every card.
 */
function DraftInput({ value, onCommit, disabled, width, placeholder, title }: {
  value: string; onCommit: (v: string) => void; disabled?: boolean; width?: string; placeholder?: string; title?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = () => { if (draft !== value) onCommit(draft); };
  return <input type="text" value={draft} disabled={disabled} placeholder={placeholder} title={title} style={{ width: width || "8rem" }}
    onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />;
}

export interface MoreKindUi {
  label: string;
  /** the card's title */
  title: string;
  /** a gene list edited through the page's shared gene dialog */
  genes?: boolean;
  /** the most cohorts this view can draw at once */
  maxCohorts?: number;
  /** why the add button is disabled for this study, or null when it can be added */
  why?: (known: Known) => string | null;
}

/** What the page knows about the study before a view is added. */
export interface Known {
  genes: string[]; attrs: { attribute: string; kind: string }[]; profiles: string[];
  events: { canonical: string; label: string; n: number }[]; cohorts: string[];
}

export const MORE_KINDS: Record<string, MoreKindUi> = {
  attrition: { label: "Cohort attrition (CONSORT)", title: "Cohort attrition", maxCohorts: 6 },
  genome: { label: "Genome-wide copy number", title: "Genome-wide copy number", maxCohorts: 4 },
  pathways: { label: "Oncogenic pathways", title: "Oncogenic signalling pathways", maxCohorts: 4 },
  incidence: { label: "Cumulative incidence (competing risks)", title: "Cumulative incidence", maxCohorts: 6,
    why: (k) => k.events.length ? null : "this study records no timeline events to estimate the incidence of" },
  clonality: { label: "Clonality (FACETS)", title: "Clonality", genes: true, maxCohorts: 3 },
  paired: { label: "Paired samples (primary vs metastasis)", title: "Paired samples", genes: true, maxCohorts: 3 },
  diffexpr: { label: "Differential expression + GSEA", title: "Differential expression", maxCohorts: 2,
    why: (k) => k.cohorts.length < 2 ? "compares exactly two cohorts — this analysis has one"
      : !k.profiles.length ? "this study has no molecular profile to compare expression on" : null }
};

export const isMoreKind = (k: unknown): boolean => Object.prototype.hasOwnProperty.call(MORE_KINDS, String(k));

/** What a card needs from the page: the view as written, its result, and a way to edit it. */
export interface MoreCtx {
  vi: number;
  /** the view as the DOCUMENT holds it (never the result, which has different fields) */
  spec: any;
  /** the view's result */
  v: any;
  busy: boolean;
  patch: (p: Record<string, unknown>) => void;
  attrs: { attribute: string; kind: string }[];
  profiles: string[];
  events: { canonical: string; label: string; n: number }[];
}

/** A one-line subtitle for the card header. */
export function moreSub(kind: string, spec: any, v: any): React.ReactNode {
  if (kind === "attrition") return "patients left after each clause, in order";
  if (kind === "incidence") {
    const e = spec.event || {};
    const an = spec.anchor;
    return (e.label || e.eventType || "no event chosen") +
      (an && an.eventType ? " from first " + an.eventType + (an.key ? " [" + an.key + "=" + an.value + "]" : "") : " from day 0") + ", death competing";
  }
  if (kind === "clonality") return "FACETS allele-specific copy number" + (spec.measure === "any" ? ", every mutation" : ", driver mutations") + (spec.qc === false ? ", all samples" : ", QC-passing samples");
  if (kind === "paired") {
    const pb = spec.pairBy || { attribute: "SAMPLE_TYPE", a: "Primary", b: "Metastasis" };
    const j = (x: any) => Array.isArray(x) ? x.join("/") : String(x ?? "");
    return pb.attribute + ": " + j(pb.a) + " vs " + j(pb.b) + (spec.measure === "any" ? ", any alteration" : ", drivers");
  }
  if (kind === "diffexpr") return (spec.profileType || "no profile") + (v.diffexpr ? (v.diffexpr.log2 ? ", log2(v+1)" : "") + " · volcano and GSEA" : "");
  if (kind === "pathways") return (spec.measure === "any" ? "any alteration" : "OncoKB drivers") + ", Sanchez-Vega et al. 2018";
  if (kind === "genome") return v.genome ? v.genome.build + ", " + v.genome.binMb + " Mb bins, from segments" : "from copy-number segments";
  void spec; void v;
  return null;
}

/** This kind's settings row, or nothing when it has none. */
export function MoreControls({ c }: { c: MoreCtx }) {
  const { spec, busy, patch } = c;
  if (spec.kind === "genome") return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="bin width along the genome; a bin takes the value of the segment over its midpoint, so a narrower bin catches a narrower event">
          bins <select value={String(spec.binMb ?? 2)} disabled={busy} onChange={(e) => patch({ binMb: Number(e.target.value) })}>
            {[1, 2, 5, 10, 20].map((b) => <option key={b} value={b}>{b} Mb</option>)}
          </select>
        </label>
        <label className="tbfield" title="the |log2 segment mean| at or past which a bin counts as gained or lost">
          threshold <select value={String(spec.threshold ?? 0.2)} disabled={busy} onChange={(e) => patch({ threshold: Number(e.target.value) })}>
            {[0.1, 0.2, 0.3, 0.5, 1].map((t) => <option key={t} value={t}>±{t}</option>)}
          </select>
        </label>
        <label className="chk" title="chromosome X's log ratio mostly records sex against the reference, so it is off by default">
          <input type="checkbox" checked={spec.includeX === true} disabled={busy} onChange={(e) => patch({ includeX: e.target.checked || undefined })} /> chrX
        </label>
      </div>
    </div>
  );
  if (spec.kind === "diffexpr") return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="the molecular profile both cohorts are compared on">
          profile <select value={spec.profileType || ""} disabled={busy} onChange={(e) => patch({ profileType: e.target.value, log2: undefined })}>
            {!c.profiles.includes(spec.profileType) && <option value={spec.profileType || ""}>{spec.profileType || "choose…"}</option>}
            {c.profiles.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
          </select>
        </label>
        <label className="chk" title="compare log2(v + 1) instead of the stored value; on by default for a non-z-score RNA-seq profile">
          <input type="checkbox" checked={c.v.diffexpr ? !!c.v.diffexpr.log2 : spec.log2 === true} disabled={busy}
            onChange={(e) => patch({ log2: e.target.checked })} /> log2
        </label>
        <label className="chk" title="preranked GSEA against the 50 MSigDB Hallmark sets; untick to draw the volcano alone">
          <input type="checkbox" checked={!(Array.isArray(spec.geneSets) && spec.geneSets.length === 0)} disabled={busy}
            onChange={(e) => patch({ geneSets: e.target.checked ? undefined : [] })} /> enrichment
        </label>
      </div>
    </div>
  );
  if (spec.kind === "incidence") {
    const e = spec.event || { eventType: "" }, a0 = (e.attrs || [])[0] || { key: "", value: "" };
    const an = spec.anchor || null;
    const setEvent = (next: any) => patch({ event: next });
    const types = c.events.map((x) => x.label);
    return (
      <div className="viewtb">
        <div className="tbz"><span className="tbl">event</span>
          <label className="tbfield" title="the timeline event whose first occurrence after the anchor is counted">
            type <select value={e.eventType || ""} disabled={busy} onChange={(ev) => setEvent({ ...e, eventType: ev.target.value })}>
              {!types.includes(e.eventType) && <option value={e.eventType || ""}>{e.eventType || "choose…"}</option>}
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="tbfield" title="only events with this attribute (e.g. TUMOR_SITE); leave empty for any">
            where <DraftInput value={a0.key || ""} disabled={busy} width="8rem" placeholder="attribute"
              onCommit={(t) => setEvent({ ...e, attrs: t.trim() ? [{ key: t.trim(), value: a0.value || "" }] : undefined })} />
          </label>
          <label className="tbfield" title="the value that attribute must take">
            = <DraftInput value={a0.value || ""} disabled={busy} width="8rem" placeholder="value"
              onCommit={(t) => setEvent({ ...e, attrs: a0.key ? [{ key: a0.key, value: t }] : undefined })} />
          </label>
        </div>
        <div className="tbz"><span className="tbl">clock</span>
          <label className="tbfield" title="when the clock starts: the study's day 0, or the first event of a type (left truncation applies, as in survival)">
            from <select value={an ? an.eventType : ""} disabled={busy}
              onChange={(ev) => patch({ anchor: ev.target.value ? { eventType: ev.target.value, occurrence: "FIRST" } : undefined })}>
              <option value="">day 0</option>
              {types.map((t) => <option key={t} value={t}>first {t}</option>)}
            </select>
          </label>
          {an && an.key && <span className="meta" title="set in the document; choosing another clock drops it">where {an.key} = {String(an.value ?? "")}</span>}
        </div>
      </div>
    );
  }
  if (spec.kind === "clonality") return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="OncoKB driver mutations only, or every mutation call">
          count <select value={spec.measure === "any" ? "any" : "driver"} disabled={busy} onChange={(e) => patch({ measure: e.target.value === "any" ? "any" : undefined })}>
            <option value="driver">driver mutations</option><option value="any">every mutation</option>
          </select>
        </label>
        <label className="chk" title="use only samples whose FACETS_QC is Pass">
          <input type="checkbox" checked={spec.qc !== false} disabled={busy} onChange={(e) => patch({ qc: e.target.checked ? undefined : false })} /> FACETS QC pass only
        </label>
      </div>
    </div>
  );
  if (spec.kind === "paired") {
    const pb = spec.pairBy || { attribute: "SAMPLE_TYPE", a: "Primary", b: "Metastasis" };
    const csv = (x: any) => (Array.isArray(x) ? x : [x]).filter((y: any) => y != null && y !== "").join(", ");
    const parse = (t: string) => { const xs = t.split(",").map((y) => y.trim()).filter(Boolean); return xs.length === 1 ? xs[0] : xs; };
    const setBy = (k: "attribute" | "a" | "b", t: string) => patch({ pairBy: { ...pb, [k]: k === "attribute" ? t.trim() : parse(t) } });
    return (
      <div className="viewtb">
        <div className="tbz"><span className="tbl">data</span>
          <label className="tbfield" title="a SAMPLE-level attribute that says which kind each sample is">
            pair by <DraftInput value={pb.attribute} disabled={busy} width="9rem" onCommit={(t) => setBy("attribute", t)} />
          </label>
          <label className="tbfield" title="the value(s) of that attribute on the first side; comma-separated for several">
            <DraftInput value={csv(pb.a)} disabled={busy} onCommit={(t) => setBy("a", t)} />
          </label>
          <label className="tbfield" title="the value(s) on the second side">
            vs <DraftInput value={csv(pb.b)} disabled={busy} onCommit={(t) => setBy("b", t)} />
          </label>
          <label className="tbfield" title="count only OncoKB drivers, or every alteration">
            count <select value={spec.measure === "any" ? "any" : "driver"} disabled={busy} onChange={(e) => patch({ measure: e.target.value === "any" ? "any" : undefined })}>
              <option value="driver">drivers</option><option value="any">any alteration</option>
            </select>
          </label>
        </div>
      </div>
    );
  }
  if (spec.kind === "pathways") return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="count only OncoKB-annotated drivers (as the paper counted curated oncogenic events), or every alteration">
          count <select value={spec.measure === "any" ? "any" : "driver"} disabled={busy} onChange={(e) => patch({ measure: e.target.value === "any" ? "any" : undefined })}>
            <option value="driver">drivers</option><option value="any">any alteration</option>
          </select>
        </label>
        <label className="tbfield" title="how many of each pathway's most-altered genes to draw; the rest are pooled and counted, never dropped">
          genes shown <select value={String(spec.topGenes ?? 6)} disabled={busy} onChange={(e) => patch({ topGenes: Number(e.target.value) })}>
            {[3, 6, 9, 12].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
  return null;
}

/** The view a fresh "add view" click starts from, built from what the study is known to have. */
export function defaultMoreView(kind: string, known: Known): Record<string, unknown> {
  if (kind === "incidence") {
    const ev = known.events.find((e) => /diagnos|progress|status/i.test(e.canonical)) || known.events[0];
    return { kind, event: { eventType: ev ? ev.label : "" } };
  }
  if (kind === "clonality") return { kind, genes: known.genes.length ? known.genes.slice(0, 8) : ["TP53", "KRAS", "APC", "PIK3CA", "SMAD4", "CDH1"] };
  if (kind === "paired") return { kind, genes: known.genes.length ? known.genes.slice(0, 8) : ["TP53", "KRAS", "PIK3CA", "ESR1", "AR", "CDKN2A", "MYC", "TERT"] };
  if (kind === "diffexpr") {
    const profile = known.profiles.find((p) => /zscore/i.test(p) && /mrna|rna_seq/i.test(p))
      || known.profiles.find((p) => /mrna|rna_seq/i.test(p)) || known.profiles[0] || "";
    return { kind, profileType: profile, ...(known.cohorts.length > 2 ? { cohorts: known.cohorts.slice(0, 2) } : {}) };
  }
  return { kind };
}
