"use client";
// Cards for the view kinds described by KIND_CARDS, rather than hand-built in view-cards.tsx. The
// page draws every one of them the same way — ViewHead, then this kind's controls, then the
// server-rendered figure or the kind's own body — so all that differs per kind lives here: its
// title, whether it takes a gene list, how many cohorts it draws, and its own settings.
import React, { useEffect, useState } from "react";
import { DataTable, specQuery } from "../_table/DataTable.tsx";
import { CancertypesBody, EnrichmentBody, CorrelatesBody, AssaysBody, MutationsBody } from "./portal-bodies";
import { PickMenu } from "./view-chrome.tsx";
import { TimelineBody } from "./timeline-body";
import { AlterationsBody } from "./alterations-body";

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

export interface KindCardSpec {
  label: string;
  /** the card's title */
  title: string;
  /** a gene list edited through the page's shared gene dialog */
  genes?: boolean;
  /** the most cohorts this view can draw at once */
  maxCohorts?: number;
  /** the header's subtitle names the one cohort drawn, so the header leaves out its "Showing" line */
  cohortInHeader?: boolean;
  /** the fewest it compares; an empty view says so beside its "+ Add cohort" */
  minCohorts?: number;
  /** why the add button is disabled for this study, or null when it can be added */
  why?: (known: Known) => string | null;
}

/** What the page knows about the study before a view is added. */
export interface Known {
  genes: string[]; attrs: { attribute: string; kind: string }[]; profiles: string[];
  /** generic-assay profiles (mutational signatures, arm-level CNA, …) */
  assays: string[];
  events: { canonical: string; label: string; n: number }[]; cohorts: string[];
}

export const KIND_CARDS: Record<string, KindCardSpec> = {
  attrition: { label: "Cohort attrition (CONSORT)", title: "Cohort attrition", maxCohorts: 6 },
  genome: { label: "Genome-wide copy number", title: "Genome-wide copy number", maxCohorts: 4 },
  pathways: { label: "Oncogenic pathways", title: "Oncogenic signalling pathways", maxCohorts: 4 },
  enrichment: { label: "Alteration enrichment (all genes)", title: "Alteration enrichment", maxCohorts: 6, minCohorts: 2 },
  assays: { label: "Generic assays (signatures, arm-level CNA, …)", title: "Generic assays", maxCohorts: 6, minCohorts: 2,
    why: (k) => !k.assays.length ? "this study has no generic-assay profiles (mutational signatures, arm-level copy number, …)" : null },
  table: { label: "Clinical data table (download)", title: "Clinical data", maxCohorts: 6 },
  mutations: { label: "Mutation table (one gene)", title: "Mutations", maxCohorts: 6 },
  timeline: { label: "Patient timeline (one patient at a time)", title: "Patient timeline", maxCohorts: 1, cohortInHeader: true,
    why: (k) => k.events.length ? null : "this study records no timeline events" },
  alterations: { label: "Patient alterations (mutations, copy number, SVs; one patient at a time)", title: "Patient alterations", maxCohorts: 1, cohortInHeader: true },
  correlates: { label: "Co-expression with one gene (genome-wide)", title: "Co-expression", maxCohorts: 1,
    why: (k) => !k.profiles.filter((p) => p !== "cna").length ? "this study has no continuous molecular profile (mRNA, protein, …) to correlate on" : null },
  overlap: { label: "Cohort overlap (UpSet)", title: "Cohort overlap", maxCohorts: 6, minCohorts: 2 },
  cancertypes: { label: "Cancer types summary", title: "Cancer types summary", genes: true, maxCohorts: 2 },
  labs: { label: "Lab course and response (e.g. PSA50)", title: "Lab course", maxCohorts: 4,
    why: (k) => k.events.some((e) => /lab/i.test(e.canonical)) ? null : "this study records no lab-test timeline events" },
  incidence: { label: "Cumulative incidence (competing risks)", title: "Cumulative incidence", maxCohorts: 6,
    why: (k) => k.events.length ? null : "this study records no timeline events to estimate the incidence of" },
  clonality: { label: "Clonality (FACETS)", title: "Clonality", genes: true, maxCohorts: 3 },
  paired: { label: "Paired samples (primary vs metastasis, before vs after)", title: "Paired samples", genes: true, maxCohorts: 3 },
  riskmodel: { label: "Risk model (elastic-net Cox, OncoCast-style)", title: "Risk model", maxCohorts: 1 },
  diffexpr: { label: "Differential expression + GSEA", title: "Differential expression", maxCohorts: 2, minCohorts: 2,
    why: (k) => !k.profiles.length ? "this study has no molecular profile to compare expression on" : null }
};

const PAIRED_DEFAULT_GENES = ["TP53", "KRAS", "PIK3CA", "ESR1", "AR", "CDKN2A", "MYC", "TERT"];

export const hasKindCard = (k: unknown): boolean => Object.prototype.hasOwnProperty.call(KIND_CARDS, String(k));

/**
 * Views that show their own waiting state (the table views: their search, filters and headers stay
 * usable while the rows are covered), so the page must not cover the card with its own.
 */
export const drawsOwnWaiting = (k: unknown): boolean => k === "table" || k === "mutations" || k === "timeline" || k === "alterations";

/** What a card needs from the page: the view as written, its result, and a way to edit it. */
export interface KindCardCtx {
  vi: number;
  /** the view as the DOCUMENT holds it (never the result, which has different fields) */
  spec: any;
  /** the view's result */
  v: any;
  busy: boolean;
  /** a request for this view is running (its own re-run, or the whole document's) — a view that draws its own
   *  waiting state (drawsOwnWaiting) shows it; for the rest the page covers the card */
  updating?: boolean;
  patch: (p: Record<string, unknown>) => void;
  attrs: { attribute: string; kind: string }[];
  profiles: string[];
  assays: string[];
  events: { canonical: string; label: string; n: number }[];
  /** the document as it stands, for a table's download */
  docJson?: () => string;
  /** settings the surrounding page controls for every view at once (a portal tab's gene chips), so not offered here */
  locked?: string[];
}

/** the risk model's covariate menus, open or shut, by view (a viewport state, not the document's) */
const RISK_MENUS = new Map<string, boolean>();

/** A one-line subtitle for the card header. */
export function kindSub(kind: string, spec: any, v: any): React.ReactNode {
  if (kind === "attrition") return "patients left after each clause, in order";
  if (kind === "enrichment") return ({ mutation: "mutations", cna: "copy-number alterations", amp: "amplifications", homdel: "deep deletions", sv: "structural variants" } as Record<string, string>)[spec.alteration || "mutation"] +
    (spec.measure === "driver" ? " (drivers)" : "") + " in every gene, per sample";
  if (kind === "overlap") return "patients in exactly each combination of cohorts";
  if (kind === "mutations") return (spec.gene || "no gene") + " · every mutation call" + (v.mutations ? " · " + v.mutations.total.toLocaleString() + " rows" : "");
  if (kind === "timeline") {
    const cohort = Array.isArray(v.cohorts) && v.cohorts[0] ? String(v.cohorts[0]).split(" / ").join(" › ") : null;
    return <>{cohort && <><strong>{cohort}</strong> · </>}{v.timeline ? v.timeline.total.toLocaleString() + " patients · " : ""}clinical events from diagnosis</>;
  }
  if (kind === "alterations") {
    const cohort = Array.isArray(v.cohorts) && v.cohorts[0] ? String(v.cohorts[0]).split(" / ").join(" › ") : null;
    return <>{cohort && <><strong>{cohort}</strong> · </>}{v.alterations ? v.alterations.total.toLocaleString() + " patients · " : ""}mutations, copy-number alterations and structural variants</>;
  }
  if (kind === "table") return "one row per " + (spec.unit === "patient" ? "patient" : "sample") + (v.table ? " · " + v.table.total.toLocaleString() + " rows, " + v.table.columns.length + " attributes" : "");
  if (kind === "correlates") return (spec.gene || "no gene") + " on " + (spec.profileType || "no profile") + (spec.otherProfile && spec.otherProfile !== spec.profileType ? " against " + spec.otherProfile : "") + " · Spearman ρ, every gene";
  if (kind === "assays") return (v.assays ? v.assays.profileName + " · " + v.assays.test : spec.profileType || "no profile chosen") + ", per " + (v.assays ? v.assays.unit.replace(/s$/, "") : "sample");
  if (kind === "cancertypes") return "by " + (spec.groupBy || "CANCER_TYPE") + (spec.measure === "driver" ? ", drivers" : ", any alteration") + ", % of profiled samples";
  if (kind === "riskmodel") return (spec.endpoint || "OS") + (spec.anchor?.eventType ? " from first " + spec.anchor.eventType + (spec.anchor.key ? " [" + spec.anchor.key + "=" + spec.anchor.value + "]" : "") : "") +
    " on " + (spec.measure === "driver" ? "driver mutations" : "mutated genes") +
    (spec.covariates?.length ? " + " + spec.covariates.length + " covariate" + (spec.covariates.length === 1 ? "" : "s") : "") +
    (spec.strata ? ", stratified by " + spec.strata : "") + " · " + (spec.runs ?? 10) + " held-out splits" + (spec.validate ? ", validated on the held-out half" : "");
  if (kind === "labs") {
    const an = spec.anchor || {};
    return (spec.test || "no test chosen") + " from first " + (an.eventType || "?") + (an.key ? " [" + an.key + "=" + an.value + "]" : "") +
      " · responders fell ≥" + (spec.responseDrop ?? 50) + "%";
  }
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
    const sides = v.paired ? v.paired.labels.a + " vs " + v.paired.labels.b
      : pb.studies ? "sides set per study" : pb.attribute + ": " + j(pb.a) + " vs " + j(pb.b);
    return sides + (spec.measure === "any" ? ", any alteration" : ", drivers") + (spec.genes && spec.genes.length ? "" : ", every gene scanned");
  }
  if (kind === "diffexpr") return (spec.profileType || "no profile") + (v.diffexpr ? (v.diffexpr.log2 ? ", log2(v+1)" : "") + " · volcano and GSEA" : "");
  if (kind === "pathways") return (spec.measure === "any" ? "any alteration" : "OncoKB drivers") + ", Sanchez-Vega et al. 2018";
  if (kind === "genome") return v.genome ? v.genome.build + ", " + v.genome.binMb + " Mb bins, from segments" : "from copy-number segments";
  void spec; void v;
  return null;
}

/** This kind's settings row, or nothing when it has none. */
export function KindCardControls({ c }: { c: KindCardCtx }) {
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
  // the gene is its only setting; a portal tab whose chips set it leaves no bar at all
  if (spec.kind === "mutations") return (c.locked || []).includes("gene") ? null : (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        {!(c.locked || []).includes("gene") && <label className="tbfield" title="the gene whose mutations are listed">
          gene <DraftInput value={spec.gene || ""} disabled={busy} width="6rem" placeholder="KRAS" onCommit={(t) => patch({ gene: t.trim().toUpperCase() })} />
        </label>}

      </div>
    </div>
  );
  // its drawing settings sit in the card, over the timeline (app/lab/timeline-body.tsx)
  if (spec.kind === "timeline") return null;
  // every setting is a table's own, in the card (app/lab/alterations-body.tsx)
  if (spec.kind === "alterations") return null;
  // the search, filters, sort and columns are the table's own (app/_table/DataTable.tsx); a change of unit starts them over
  if (spec.kind === "table") return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="a row per sample, carrying its patient's attributes too, or a row per patient with patient attributes only">
          rows per <select value={spec.unit === "patient" ? "patient" : "sample"} disabled={busy}
            onChange={(e) => patch({ unit: e.target.value === "patient" ? "patient" : undefined, sort: undefined, filters: undefined, columns: undefined, attributes: undefined, search: undefined })}>
            <option value="sample">sample</option><option value="patient">patient</option>
          </select>
        </label>
      </div>
    </div>
  );
  if (spec.kind === "correlates") {
    const profs = c.profiles.filter((p) => p !== "cna");
    const pick = (value: string, set: (v: string) => void, title: string, label: string) => (
      <label className="tbfield" title={title}>
        {label} <select value={value} disabled={busy} onChange={(e) => set(e.target.value)}>
          {!profs.includes(value) && <option value={value}>{value || "choose…"}</option>}
          {profs.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
        </select>
      </label>
    );
    return (
      <div className="viewtb">
        <div className="tbz"><span className="tbl">data</span>
          <label className="tbfield" title="the gene every other gene is correlated with">
            gene <DraftInput value={spec.gene || ""} disabled={busy} width="6rem" placeholder="ESR1" onCommit={(t) => patch({ gene: t.trim().toUpperCase() })} />
          </label>
          {pick(spec.profileType || "", (v) => patch({ profileType: v }), "the query gene's profile", "on")}
          {pick(spec.otherProfile || spec.profileType || "", (v) => patch({ otherProfile: v === spec.profileType ? undefined : v }), "the profile every other gene is read from", "against")}
          <label className="tbfield" title="genes listed in each direction; every tested gene is in the histogram">
            list <select value={String(spec.show ?? 100)} disabled={busy} onChange={(e) => patch({ show: Number(e.target.value) === 100 ? undefined : Number(e.target.value) })}>
              {[25, 100, 250].map((n) => <option key={n} value={n}>{n}</option>)}
            </select> each way
          </label>
        </div>
      </div>
    );
  }
  if (spec.kind === "assays") return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="the generic-assay profile whose every entity is compared">
          profile <select value={spec.profileType || ""} disabled={busy} onChange={(e) => patch({ profileType: e.target.value })}>
            {!c.assays.includes(spec.profileType) && <option value={spec.profileType || ""}>{spec.profileType || "choose…"}</option>}
            {c.assays.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
          </select>
        </label>
        <label className="tbfield" title="an entity with fewer values than this in any cohort is counted but not tested">
          test with ≥ <select value={String(spec.minN ?? 3)} disabled={busy} onChange={(e) => patch({ minN: Number(e.target.value) === 3 ? undefined : Number(e.target.value) })}>
            {[2, 3, 5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </select> per cohort
        </label>
      </div>
    </div>
  );
  if (spec.kind === "enrichment") return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="which alteration to compare across every gene">
          alteration <select value={spec.alteration || "mutation"} disabled={busy} onChange={(e) => patch({ alteration: e.target.value === "mutation" ? undefined : e.target.value })}>
            <option value="mutation">mutation</option><option value="cna">amp or deep deletion</option><option value="amp">amplification</option>
            <option value="homdel">deep deletion</option><option value="sv">structural variant</option>
          </select>
        </label>
        <label className="tbfield" title="count every alteration, or only OncoKB drivers">
          count <select value={spec.measure === "driver" ? "driver" : "any"} disabled={busy} onChange={(e) => patch({ measure: e.target.value === "driver" ? "driver" : undefined })}>
            <option value="any">any</option><option value="driver">drivers</option>
          </select>
        </label>
        <label className="tbfield" title="genes altered in fewer samples than this across the cohorts are counted but not tested">
          test genes altered in ≥ <select value={String(spec.minAltered ?? 5)} disabled={busy} onChange={(e) => patch({ minAltered: Number(e.target.value) })}>
            {[1, 5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
  if (spec.kind === "cancertypes") {
    const cats = c.attrs.filter((a) => a.kind !== "num").map((a) => a.attribute);
    const by = spec.groupBy || "CANCER_TYPE";
    return (
      <div className="viewtb">
        <div className="tbz"><span className="tbl">data</span>
          <label className="tbfield" title="the portal's category type: the study, the cancer type or the detailed cancer type — or any other sample attribute">
            category <select value={by} disabled={busy} onChange={(e) => patch({ groupBy: e.target.value === "CANCER_TYPE" ? undefined : e.target.value })}>
              <option value="study">Cancer Study</option>
              <option value="CANCER_TYPE">Cancer Type</option>
              <option value="CANCER_TYPE_DETAILED">Cancer Type Detailed</option>
              {!cats.includes(by) && !["study", "CANCER_TYPE", "CANCER_TYPE_DETAILED"].includes(by) && <option value={by}>{by}</option>}
              {cats.filter((a) => a !== "CANCER_TYPE" && a !== "CANCER_TYPE_DETAILED").map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="tbfield" title="count patients (as the portal does by default — a patient counts in each group one of their samples is in) or samples">
            count by <select value={spec.unit === "sample" ? "sample" : "patient"} disabled={busy} onChange={(e) => patch({ unit: e.target.value === "sample" ? "sample" : undefined })}>
              <option value="patient">patients</option><option value="sample">samples</option>
            </select>
          </label>
          <label className="tbfield" title="count every alteration, or only OncoKB drivers">
            count <select value={spec.measure === "driver" ? "driver" : "any"} disabled={busy} onChange={(e) => patch({ measure: e.target.value === "driver" ? "driver" : undefined })}>
              <option value="any">any alteration</option><option value="driver">drivers</option>
            </select>
          </label>
          <label className="tbfield" title="groups with fewer profiled patients (or samples) than this are pooled into one bar, never dropped">
            min group <select value={String(spec.minSamples ?? 10)} disabled={busy} onChange={(e) => patch({ minSamples: Number(e.target.value) })}>
              {[1, 10, 50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <div className="tbz"><span className="tbl">view</span>
          <label className="tbfield" title="the y axis: each group's altered share, or its altered count">
            y-axis <select value={spec.show === "count" ? "count" : "frequency"} disabled={busy} onChange={(e) => patch({ show: e.target.value === "count" ? "count" : undefined })}>
              <option value="frequency">Alteration Frequency</option><option value="count">Absolute Counts</option>
            </select>
          </label>
        </div>
      </div>
    );
  }
  if (spec.kind === "riskmodel") {
    const cats = c.attrs.filter((a) => a.kind !== "num").map((a) => a.attribute);
    return (
      <div className="viewtb">
        <div className="tbz"><span className="tbl">data</span>
          <label className="tbfield" title="mutations counted as a gene's feature">
            genes <select value={spec.measure || "any"} disabled={busy} onChange={(e) => patch({ measure: e.target.value })}>
              <option value="any">any mutation</option><option value="driver">OncoKB drivers</option>
            </select>
          </label>
          <label className="tbfield" title="a separate baseline hazard per value — use CANCER_TYPE on a cohort of several cancers, or a gene that marks a type carries its prognosis">
            stratify by <select value={spec.strata || ""} disabled={busy} onChange={(e) => patch({ strata: e.target.value || undefined })}>
              <option value="">nothing</option>
              {!cats.includes(spec.strata) && spec.strata && <option value={spec.strata}>{spec.strata}</option>}
              {cats.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        </div>
        <div className="tbz"><span className="tbl">adjust</span>
          <PickMenu label="covariates" title="clinical attributes always kept in the model, never penalised (at most 6): numbers as they are, categories against their commonest value. Prefer an age at diagnosis to an age at last contact, which makes longer survivors look older"
            options={c.attrs.filter((a) => a.attribute !== spec.strata).map((a) => ({ value: a.attribute, label: a.attribute, hint: a.kind === "num" ? "number" : "category" }))}
            chosen={spec.covariates || []} max={6} busy={busy} menuId={"risk-cov:" + c.vi} menuStore={RISK_MENUS}
            onChange={(next) => patch({ covariates: next.length ? next : undefined })} />
          <label className="tbfield" title="start each patient's clock at a timeline event instead of the study's day 0; they then enter the risk set at day 0 (delayed entry)">
            clock from <select value={spec.anchor?.eventType || ""} disabled={busy}
              onChange={(e) => patch({ anchor: e.target.value ? { ...(spec.anchor || {}), eventType: e.target.value } : undefined })}>
              <option value="">study's day 0</option>
              {spec.anchor?.eventType && !c.events.some((x) => x.label === spec.anchor.eventType) && <option value={spec.anchor.eventType}>{spec.anchor.eventType}</option>}
              {c.events.map((x) => <option key={x.label} value={x.label}>first {x.label}</option>)}
            </select>
          </label>
          {spec.anchor?.eventType && <>
            <label className="tbfield" title="only anchor events with this attribute (e.g. SUBTYPE); empty for any">
              where <DraftInput value={spec.anchor.key || ""} disabled={busy} width="6rem" placeholder="attribute"
                onCommit={(t) => patch({ anchor: { eventType: spec.anchor.eventType, ...(t.trim() ? { key: t.trim(), value: spec.anchor.value || "" } : {}) } })} />
            </label>
            <label className="tbfield" title="the value that attribute must take (e.g. Immuno)">
              = <DraftInput value={spec.anchor.value || ""} disabled={busy} width="6rem" placeholder="value"
                onCommit={(t) => patch({ anchor: { ...spec.anchor, value: t } })} />
            </label>
          </>}
        </div>
        <div className="tbz"><span className="tbl">model</span>
          <label className="chk" title="train only on the discovery half of the engine's fixed held-out split, and report the groups, table and C-index on the validation half, which the model never saw">
            <input type="checkbox" checked={!!spec.validate} disabled={busy} onChange={(e) => patch({ validate: e.target.checked || undefined })} /> validate on held-out half
          </label>
          <label className="tbfield" title="the l1 share of the penalty: lasso keeps fewer genes, ridge keeps all of them shrunk">
            penalty <select value={String(spec.alpha ?? 0.5)} disabled={busy} onChange={(e) => patch({ alpha: Number(e.target.value) })}>
              <option value="1">lasso</option><option value="0.5">elastic net</option><option value="0.1">mostly ridge</option>
            </select>
          </label>
          <label className="tbfield" title="random two-thirds / one-third splits; each patient's score is the mean over the runs that held them out (OncoCast recommends 50 or more)">
            runs <select value={String(spec.runs ?? 10)} disabled={busy} onChange={(e) => patch({ runs: Number(e.target.value) })}>
              {[5, 10, 20, 50].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="tbfield" title="risk groups, cut at equal quantiles of the score">
            groups <select value={String(spec.groups ?? 3)} disabled={busy} onChange={(e) => patch({ groups: Number(e.target.value) })}>
              {[2, 3, 4, 5].map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
        </div>
      </div>
    );
  }
  if (spec.kind === "labs") {
    const an = spec.anchor || { eventType: "" };
    const types = c.events.map((x) => x.label);
    return (
      <div className="viewtb">
        <div className="tbz"><span className="tbl">test</span>
          <label className="tbfield" title="the lab test, as its timeline attribute names it (e.g. PSA, CEA, CA_19-9)">
            <DraftInput value={spec.test || ""} disabled={busy} width="7rem" onCommit={(t) => patch({ test: t.trim() })} />
          </label>
          <label className="tbfield" title="a responder's best fall from baseline, in percent">
            responder <select value={String(spec.responseDrop ?? 50)} disabled={busy} onChange={(e) => patch({ responseDrop: Number(e.target.value) })}>
              {[30, 50, 90].map((d) => <option key={d} value={d}>fell ≥{d}%</option>)}
            </select>
          </label>
        </div>
        <div className="tbz"><span className="tbl">clock</span>
          <label className="tbfield" title="the treatment start the course is read from">
            from first <select value={an.eventType || ""} disabled={busy} onChange={(e) => patch({ anchor: { ...an, eventType: e.target.value } })}>
              {!types.includes(an.eventType) && <option value={an.eventType || ""}>{an.eventType || "choose…"}</option>}
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="tbfield" title="only anchor events with this attribute (e.g. SUBTYPE); empty for any">
            where <DraftInput value={an.key || ""} disabled={busy} width="6rem" placeholder="attribute"
              onCommit={(t) => patch({ anchor: { eventType: an.eventType, ...(t.trim() ? { key: t.trim(), value: an.value || "" } : {}) } })} />
          </label>
          <label className="tbfield" title="the value that attribute must take (e.g. Hormone)">
            = <DraftInput value={an.value || ""} disabled={busy} width="6rem" placeholder="value"
              onCommit={(t) => patch({ anchor: { ...an, value: t } })} />
          </label>
          <label className="tbfield" title="how far after the start to follow">
            to <select value={String(spec.toWeeks ?? 52)} disabled={busy} onChange={(e) => patch({ toWeeks: Number(e.target.value) })}>
              {[12, 26, 52, 104].map((w) => <option key={w} value={w}>{w} weeks</option>)}
            </select>
          </label>
        </div>
      </div>
    );
  }
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
    const scanning = !(spec.genes && spec.genes.length);
    const perStudy = pb.studies ? Object.keys(pb.studies).length : 0;
    return (
      <div className="viewtb">
        <div className="tbz"><span className="tbl">data</span>
          {perStudy ? (
            <span className="meta" title={Object.entries(pb.studies).map(([st, sp]: [string, any]) => st + ": " + sp.attribute + " " + csv(sp.a) + " vs " + csv(sp.b)).join("\n")}>
              sides set per study in the document ({perStudy} {perStudy === 1 ? "study" : "studies"})
            </span>
          ) : <>
            <label className="tbfield" title="a SAMPLE-level attribute that says which kind each sample is">
              pair by <DraftInput value={pb.attribute} disabled={busy} width="9rem" onCommit={(t) => setBy("attribute", t)} />
            </label>
            <label className="tbfield" title="the value(s) of that attribute on the first side; comma-separated for several">
              <DraftInput value={csv(pb.a)} disabled={busy} onCommit={(t) => setBy("a", t)} />
            </label>
            <label className="tbfield" title="the value(s) on the second side">
              vs <DraftInput value={csv(pb.b)} disabled={busy} onCommit={(t) => setBy("b", t)} />
            </label>
          </>}
          <label className="tbfield" title="test the genes you chose, or scan every gene altered in a paired patient and draw the most one-sided">
            genes <select value={scanning ? "scan" : "chosen"} disabled={busy}
              onChange={(e) => patch(e.target.value === "scan" ? { genes: undefined } : { genes: PAIRED_DEFAULT_GENES, top: undefined })}>
              <option value="chosen">chosen</option><option value="scan">scan all</option>
            </select>
          </label>
          {scanning && (
            <label className="tbfield" title="how many of the most one-sided genes to draw; q is still taken across every gene tested">
              drawn <select value={String(spec.top ?? 20)} disabled={busy} onChange={(e) => patch({ top: Number(e.target.value) === 20 ? undefined : Number(e.target.value) })}>
                {[...new Set([10, 20, 30, 40, Number(spec.top ?? 20)])].sort((x, y) => x - y).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
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
export function defaultKindView(kind: string, known: Known): Record<string, unknown> {
  if (kind === "cancertypes") return { kind, genes: known.genes.length ? known.genes.slice(0, 5) : ["TP53", "KRAS"] };
  if (kind === "labs") {
    const tx = known.events.find((e) => /treat|therap|drug|medicat/i.test(e.canonical));
    return { kind, test: "PSA", anchor: { eventType: tx ? tx.label : "Treatment" } };
  }
  if (kind === "incidence") {
    const ev = known.events.find((e) => /diagnos|progress|status/i.test(e.canonical)) || known.events[0];
    return { kind, event: { eventType: ev ? ev.label : "" } };
  }
  if (kind === "clonality") return { kind, genes: known.genes.length ? known.genes.slice(0, 8) : ["TP53", "KRAS", "APC", "PIK3CA", "SMAD4", "CDH1"] };
  if (kind === "paired") return { kind, genes: known.genes.length ? known.genes.slice(0, 8) : PAIRED_DEFAULT_GENES };
  if (kind === "mutations") return { kind, gene: known.genes[0] || "TP53" };
  if (kind === "table") return { kind };
  if (kind === "timeline" || kind === "alterations") return { kind };
  if (kind === "correlates") {
    const profs = known.profiles.filter((p) => p !== "cna");
    const profile = profs.find((p) => /mrna|rna_seq/i.test(p) && !/zscore/i.test(p)) || profs.find((p) => /mrna|rna_seq/i.test(p)) || profs[0] || "";
    return { kind, gene: known.genes[0] || "TP53", profileType: profile };
  }
  if (kind === "assays") {
    const profile = known.assays.find((p) => /signature/i.test(p) && /contribution/i.test(p)) || known.assays.find((p) => !/methylation/i.test(p)) || known.assays[0] || "";
    return { kind, profileType: profile };
  }
  if (kind === "diffexpr") {
    const profile = known.profiles.find((p) => /zscore/i.test(p) && /mrna|rna_seq/i.test(p))
      || known.profiles.find((p) => /mrna|rna_seq/i.test(p)) || known.profiles[0] || "";
    return { kind, profileType: profile };
  }
  return { kind };
}

/** A body of the kind's own in place of the server figure, or null to draw the figure. */
export function KindCardBody({ c }: { c: KindCardCtx }): React.ReactNode | null {
  if (c.spec.kind === "cancertypes" && c.v.cancertypes) return <CancertypesBody v={c.v} />;
  if (c.spec.kind === "enrichment" && c.v.enrichment) return <EnrichmentBody v={c.v} />;
  if (c.spec.kind === "correlates" && c.v.correlates) return <CorrelatesBody v={c.v} docJson={c.docJson} />;
  if (c.spec.kind === "assays" && c.v.assays) return <AssaysBody v={c.v} />;
  if (c.spec.kind === "mutations" && c.v.mutations) return <MutationsBody v={c.v} spec={c.spec} vi={c.vi} updating={c.updating ?? c.busy} docJson={c.docJson} onQuery={(q) => c.patch({ ...q })} />;
  if (c.spec.kind === "table" && c.v.table) return <ClinicalTableBody c={c} />;
  if (c.spec.kind === "alterations" && c.v.alterations) return <AlterationsBody a={c.v.alterations} spec={c.spec} vi={c.vi} updating={c.updating ?? c.busy} docJson={c.docJson} patch={c.patch} />;
  if (c.spec.kind === "timeline" && c.v.timeline) return <TimelineBody t={c.v.timeline} spec={c.spec} vi={c.vi} updating={c.updating ?? c.busy} docJson={c.docJson} patch={c.patch} />;

  return null;
}

/** The clinical data table's body, on the shared table (app/_table/DataTable.tsx). */
function ClinicalTableBody({ c }: { c: KindCardCtx }) {
  const t = c.v.table as import("../../lib/types").TableResult;
  return <DataTable t={t} query={specQuery(c.spec)} updating={c.updating ?? c.busy} vi={c.vi} docJson={c.docJson} unit={t.unit + "s"}
    onQuery={(q) => c.patch({ ...q, attributes: undefined })}
    cell={(id, x) => (id === "patient" || id === "sample") ? <span className="mono">{x}</span> : undefined} />;
}
