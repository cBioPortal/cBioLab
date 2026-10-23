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
import { Checkbox } from "../_ui/checkbox";
import { Input } from "../_ui/input";
import { Choice, OptionSelect } from "../_ui/choice.tsx";
import { FIELD } from "../_ui/toolbar.ts";
import { RISK_LABEL_ABOVE } from "../../lib/figures/riskmodel.ts";
import { RiskTable1Button } from "./risk-table1-dialog.tsx";
import { RiskGroupsButton } from "./risk-groups-dialog.tsx";
import { GearMenu } from "../_ui/gear-menu";
import { Settings2 } from "lucide-react";

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
  return <Input type="text" value={draft} disabled={disabled} placeholder={placeholder} title={title} className={FIELD} style={{ width: width || "8rem" }}
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
  composition: { label: "Composition (cell types, states, signatures as parts of a whole)", title: "Composition", maxCohorts: 8, minCohorts: 1,
    why: (k) => !k.assays.length && !k.attrs.some((a) => a.kind === "num") ? "this study has no generic-assay profile and no numeric attribute to draw as parts" : null },
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
  cutpoint: { label: "Biomarker cut-point (best split of a number for OS)", title: "Cut-point", maxCohorts: 1,
    why: (k) => k.attrs.some((a) => a.kind === "num") ? null : "this study has no numeric clinical attribute to find a cut-point of" },
  predictive: { label: "Predictive biomarkers (gene × treatment interaction)", title: "Predictive biomarkers", genes: true, maxCohorts: 2,
    why: (k) => k.events.some((e) => /treat|therap|drug|medicat/i.test(e.canonical)) ? null : "this study records no treatment timeline events to define an exposure" },
  txendpoints: { label: "Treatment endpoints (TTNT, time on treatment, real-world PFS)", title: "Treatment endpoints", maxCohorts: 6,
    why: (k) => k.events.some((e) => /treat|therap|drug|medicat/i.test(e.canonical)) ? null : "this study records no treatment timeline events" },
  clonality: { label: "Clonality (FACETS)", title: "Clonality", genes: true, maxCohorts: 3 },
  paired: { label: "Paired samples (primary vs metastasis, before vs after)", title: "Paired samples", genes: true, maxCohorts: 3 },
  acquired: { label: "Acquired under therapy (samples before vs after a treatment start)", title: "Acquired under therapy", genes: true, maxCohorts: 3,
    why: (k) => k.events.some((e) => /treat|therap|drug|medicat/i.test(e.canonical)) ? null : "this study records no treatment timeline events to anchor on" },
  instability: { label: "Genomic instability (aneuploidy score, FGA, arm-level calls)", title: "Genomic instability", maxCohorts: 6 },
  exclusivity: { label: "Mutual exclusivity (DISCOVER, burden-aware)", title: "Mutual exclusivity", genes: true, maxCohorts: 1, cohortInHeader: true },
  ctdna: { label: "ctDNA vs tissue (plasma against tissue, OS by ctDNA detected)", title: "ctDNA vs tissue", genes: true, maxCohorts: 3 },
  riskmodel: { label: "Risk model (elastic-net Cox, OncoCast-style)", title: "Risk model", maxCohorts: 1 },
  adjusted: { label: "Adjusted enrichment (every gene, logistic on covariates)", title: "Adjusted enrichment", maxCohorts: 2, minCohorts: 2 },
  forest: { label: "Pan-cancer forest (one exposure's HR per cancer type, random-effects pooled)", title: "Forest plot", maxCohorts: 6 },
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
/** the runs the model settings offer (OncoCast recommends 50 or more) */
const RISK_RUN_STEPS = [5, 10, 20, 50];
const RISK_PENALTIES: [string, string][] = [["1", "lasso"], ["0.5", "elastic net"], ["0.1", "mostly ridge"]];

/**
 * The risk model's fitting settings, set once and rarely changed, behind the view's settings menu
 * (the sequence and course views' idiom) so the toolbar keeps to what a reader works with.
 */
function RiskModelSettings({ vi, spec, busy, patch }: { vi: number; spec: any; busy: boolean; patch: (p: Record<string, unknown>) => void }) {
  const alpha = String(spec.alpha ?? 0.5), runs = String(spec.runs ?? 10);
  const penalties = RISK_PENALTIES.some(([v]) => v === alpha) ? RISK_PENALTIES : [[alpha, "alpha " + alpha] as [string, string], ...RISK_PENALTIES];
  const runSteps = RISK_RUN_STEPS.map(String);
  return (
    <GearMenu menuId={"risk-settings:" + vi} menuStore={RISK_MENUS} wide className="risksettingsbtn" contentClassName="gap-1.5 px-2.5 py-2" title="risk model options"
      label={<><Settings2 />settings</>}>
      <div className="setrow" title="the lasso share of the penalty: lasso keeps fewer genes, ridge keeps all of them shrunk">
        <span className="meta">penalty</span>
        <Choice className="flex-1" value={alpha} disabled={busy} onChange={(v) => patch({ alpha: Number(v) })} options={penalties} />
      </div>
      <div className="setrow" title="random two-thirds / one-third splits; each patient's score is the mean over the runs that held them out (OncoCast recommends 50 or more)">
        <span className="meta">runs</span>
        <Choice className="flex-1" value={runs} disabled={busy} onChange={(v) => patch({ runs: Number(v) })}
          options={(runSteps.includes(runs) ? runSteps : [runs, ...runSteps]).map((r) => [r, r] as const)} />
      </div>
      <label className="chk" title="train only on the discovery half of the engine's fixed split, and report the groups, table and C-index on the validation half, which the model never saw">
        <Checkbox checked={!!spec.validate} disabled={busy} onCheckedChange={(on) => patch({ validate: (on === true) || undefined })} /> validate on held-out half
      </label>
      <div className="setrow" title="another cohort of this analysis to score with the fitted model, cut at the training thresholds, with its C-index and curves (empty for none)">
        <span className="meta">validate on</span>
        <DraftInput value={spec.validateOn || ""} disabled={busy} width="10rem" placeholder="cohort name"
          onCommit={(t) => patch({ validateOn: t.trim() || undefined })} />
      </div>
    </GearMenu>
  );
}

/** the volcano's label thresholds the card offers */
const RISK_LABEL_STEPS = [0.1, 0.25, 0.5, 0.75, 0.9, 1];

/** The result as the figure draws it: settings applied in the browser (dataPart) read from the document, not the last run. */
export function figureView(spec: any, v: any): any {
  if (v?.kind === "riskmodel" && v.riskmodel) return { ...v, riskmodel: { ...v.riskmodel, labelAbove: Number(spec.labelAbove ?? RISK_LABEL_ABOVE) } };
  return v;
}

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
  if (kind === "composition") {
    const c = v.composition;
    const what = c ? c.sourceName : spec.profileType || (spec.attributes?.length ? spec.attributes.length + " attributes" : "no parts chosen");
    return what + (c ? " · " + c.parts.length + " parts per " + c.unit.replace(/s$/, "") : "") + ((spec.normalize ?? true) ? ", as shares" : ", as recorded") +
      (c ? " · sorted by " + (c.parts.find((x: { id: string }) => x.id === c.sort)?.name || c.sort) : "");
  }
  if (kind === "cancertypes") return "by " + (spec.groupBy || "CANCER_TYPE") + (spec.measure === "driver" ? ", drivers" : ", any alteration") + ", % of profiled samples";
  if (kind === "riskmodel") return (spec.endpoint || "OS") + (spec.anchor?.eventType ? " from first " + spec.anchor.eventType + (spec.anchor.key ? " [" + spec.anchor.key + "=" + spec.anchor.value + "]" : "") : "") +
    " on " + (spec.measure === "driver" ? "driver mutations" : "mutated genes") +
    (spec.covariates?.length ? " + " + spec.covariates.length + " covariate" + (spec.covariates.length === 1 ? "" : "s") : "") +
    (spec.strata ? ", stratified by " + spec.strata : "") + " · " + (spec.runs ?? 10) + " held-out splits" + (spec.validate ? ", validated on the held-out half" : "") +
    (spec.validateOn ? ", scored on “" + spec.validateOn + "”" : "");
  if (kind === "adjusted") return "mutations in every gene mutated in ≥" + (100 * (spec.minShare ?? 0.05)).toFixed(0) + "% · adjusted for " + (spec.covariates?.length ? spec.covariates.join(", ") : "nothing");
  if (kind === "forest") {
    const e = spec.exposure || {};
    const what = e.source === "alteration" ? (e.oql || (e.genes || [e.gene]).join(" or ") + " mutated") : e.attribute ? e.attribute + (spec.threshold != null ? " ≥ " + spec.threshold : spec.exposed ? " = " + spec.exposed : "") : "no exposure chosen";
    return what + " · " + (spec.endpoint || "OS") + " hazard ratio per " + (spec.strata || "CANCER_TYPE") + ", random-effects pooled";
  }
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
  if (kind === "cutpoint") return (spec.attribute || "TMB_NONSYNONYMOUS") + " on " + (spec.endpoint || "OS") + " · best log-rank cut, " + (spec.permutations ?? 1000) + " permutations" +
    (spec.stratifyBy ? " · per " + spec.stratifyBy : "");
  if (kind === "predictive") {
    const ex = spec.exposure || {};
    return "gene × " + (ex.eventType || "?") + (ex.key ? " [" + ex.key + "=" + ex.value + "]" : "") + " on " + (spec.endpoint || "OS") +
      (spec.covariates?.length ? " + " + spec.covariates.length + " covariate" + (spec.covariates.length === 1 ? "" : "s") : "") + " · Cox per gene";
  }
  if (kind === "txendpoints") {
    const an = spec.anchor || {};
    const ep = spec.endpoint === "tot" ? "time on treatment" : spec.endpoint === "rwpfs" ? "real-world PFS" : "time to next treatment";
    return ep + " from " + (an.occurrence === "LAST" ? "last " : "first ") + (an.eventType || "?") + (an.key ? " [" + an.key + "=" + an.value + "]" : "") + ", death an event";
  }
  if (kind === "clonality") return "FACETS allele-specific copy number" + (spec.measure === "any" ? ", every mutation" : ", driver mutations") + (spec.qc === false ? ", all samples" : ", QC-passing samples");
  if (kind === "paired") {
    const pb = spec.pairBy || { attribute: "SAMPLE_TYPE", a: "Primary", b: "Metastasis" };
    const j = (x: any) => Array.isArray(x) ? x.join("/") : String(x ?? "");
    const sides = v.paired ? v.paired.labels.a + " vs " + v.paired.labels.b
      : pb.studies ? "sides set per study" : pb.attribute + ": " + j(pb.a) + " vs " + j(pb.b);
    return sides + (spec.measure === "any" ? ", any alteration" : ", drivers") + (spec.genes && spec.genes.length ? "" : ", every gene scanned");
  }
  if (kind === "acquired") {
    const an = spec.anchor || { eventType: "Treatment" };
    return "last sample before the first " + (an.eventType || "?") + (an.key ? " [" + an.key + "=" + an.value + "]" : "") + " vs the first ≥" + (spec.minGapDays ?? 30) + " days after" +
      (spec.measure === "driver" ? ", oncogenic only" : ", any alteration") + (spec.genes && spec.genes.length ? "" : ", every gene scanned");
  }
  if (kind === "instability") return "from hg19 segments, ±" + (spec.threshold ?? 0.2) + ", arm called past " + Math.round(100 * (spec.armShare ?? 0.5)) + "% of its length" + (spec.includeX ? ", with chrX" : "");
  if (kind === "exclusivity") {
    const cohort = Array.isArray(v.cohorts) && v.cohorts[0] ? String(v.cohorts[0]).split(" / ").join(" › ") : null;
    return <>{cohort && <><strong>{cohort}</strong> · </>}{(spec.measure === "driver" ? "oncogenic alterations" : "any alteration") + ", background from each tumour's burden" +
      (spec.stratifyBy ? ", within " + spec.stratifyBy : "")}</>;
  }
  if (kind === "ctdna") return "plasma " + (spec.attribute || "SAMPLE_CLASS") + " = " + (spec.plasma || ["cfDNA", "ctDNA"]).join("/") + " vs tissue " + (spec.tissue || ["Tumor"]).join("/") +
    (spec.measure === "driver" ? ", oncogenic only" : ", any alteration") + (spec.withinDays != null ? ", drawn within " + spec.withinDays + " days" : "") +
    (spec.genes && spec.genes.length ? "" : ", the most altered genes");
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
          bins <OptionSelect value={String(spec.binMb ?? 2)} disabled={busy} onValueChange={(v) => patch({ binMb: Number(v) })}>
            {[1, 2, 5, 10, 20].map((b) => <option key={b} value={b}>{b} Mb</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" title="the |log2 segment mean| at or past which a bin counts as gained or lost">
          threshold <OptionSelect value={String(spec.threshold ?? 0.2)} disabled={busy} onValueChange={(v) => patch({ threshold: Number(v) })}>
            {[0.1, 0.2, 0.3, 0.5, 1].map((t) => <option key={t} value={t}>±{t}</option>)}
          </OptionSelect>
        </label>
        <label className="chk" title="chromosome X's log ratio mostly records sex against the reference, so it is off by default">
          <Checkbox checked={spec.includeX === true} disabled={busy} onCheckedChange={(on) => patch({ includeX: (on === true) || undefined })} /> chrX
        </label>
      </div>
    </div>
  );
  if (spec.kind === "diffexpr") return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="the molecular profile both cohorts are compared on">
          profile <OptionSelect value={spec.profileType || ""} disabled={busy} onValueChange={(v) => patch({ profileType: v, log2: undefined })}>
            {!c.profiles.includes(spec.profileType) && <option value={spec.profileType || ""}>{spec.profileType || "choose…"}</option>}
            {c.profiles.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
          </OptionSelect>
        </label>
        <label className="chk" title="compare log2(v + 1) instead of the stored value; on by default for a non-z-score RNA-seq profile">
          <Checkbox checked={c.v.diffexpr ? !!c.v.diffexpr.log2 : spec.log2 === true} disabled={busy}
            onCheckedChange={(on) => patch({ log2: (on === true) })} /> log2
        </label>
        <label className="chk" title="preranked GSEA against the 50 MSigDB Hallmark sets; untick to draw the volcano alone">
          <Checkbox checked={!(Array.isArray(spec.geneSets) && spec.geneSets.length === 0)} disabled={busy}
            onCheckedChange={(on) => patch({ geneSets: (on === true) ? undefined : [] })} /> enrichment
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
          rows per <OptionSelect value={spec.unit === "patient" ? "patient" : "sample"} disabled={busy}
            onValueChange={(v) => patch({ unit: v === "patient" ? "patient" : undefined, sort: undefined, filters: undefined, columns: undefined, attributes: undefined, search: undefined })}>
            <option value="sample">sample</option><option value="patient">patient</option>
          </OptionSelect>
        </label>
      </div>
    </div>
  );
  if (spec.kind === "correlates") {
    const profs = c.profiles.filter((p) => p !== "cna");
    const pick = (value: string, set: (v: string) => void, title: string, label: string) => (
      <label className="tbfield" title={title}>
        {label} <OptionSelect value={value} disabled={busy} onValueChange={(v) => set(v)}>
          {!profs.includes(value) && <option value={value}>{value || "choose…"}</option>}
          {profs.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
        </OptionSelect>
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
            list <OptionSelect value={String(spec.show ?? 100)} disabled={busy} onValueChange={(v) => patch({ show: Number(v) === 100 ? undefined : Number(v) })}>
              {[25, 100, 250].map((n) => <option key={n} value={n}>{n}</option>)}
            </OptionSelect> each way
          </label>
        </div>
      </div>
    );
  }
  if (spec.kind === "assays") return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="the generic-assay profile whose every entity is compared">
          profile <OptionSelect value={spec.profileType || ""} disabled={busy} onValueChange={(v) => patch({ profileType: v })}>
            {!c.assays.includes(spec.profileType) && <option value={spec.profileType || ""}>{spec.profileType || "choose…"}</option>}
            {c.assays.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" title="an entity with fewer values than this in any cohort is counted but not tested">
          test with ≥ <OptionSelect value={String(spec.minN ?? 3)} disabled={busy} onValueChange={(v) => patch({ minN: Number(v) === 3 ? undefined : Number(v) })}>
            {[2, 3, 5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </OptionSelect> per cohort
        </label>
      </div>
    </div>
  );
  if (spec.kind === "composition") {
    const parts: string[] = c.v?.composition ? c.v.composition.parts.map((x: { id: string }) => x.id) : spec.attributes || spec.entities || [];
    const names = new Map<string, string>(c.v?.composition ? c.v.composition.parts.map((x: { id: string; name: string }) => [x.id, x.name]) : []);
    const fromProfile = !spec.attributes?.length;
    return (
      <div className="viewtb">
        <div className="tbz"><span className="tbl">data</span>
          <label className="tbfield" title="where the parts come from: every entity of a generic-assay profile, or numeric clinical attributes you list">
            parts <OptionSelect value={fromProfile ? "profile:" + (spec.profileType || "") : "attributes"} disabled={busy}
              onValueChange={(v) => v === "attributes"
                ? patch({ profileType: undefined, entities: undefined, attributes: spec.attributes?.length ? spec.attributes : [], sort: undefined })
                : patch({ profileType: v.slice("profile:".length), attributes: undefined, entities: undefined, unit: undefined, sort: undefined })}>
              {fromProfile && !c.assays.includes(spec.profileType) && <option value={"profile:" + (spec.profileType || "")}>{spec.profileType || "choose…"}</option>}
              {c.assays.map((pr) => <option key={pr} value={"profile:" + pr}>{pr}</option>)}
              <option value="attributes">clinical attributes…</option>
            </OptionSelect>
          </label>
          {!fromProfile && <label className="tbfield" title="the numeric clinical attributes that are the parts, comma-separated (2–16; custom: names work)">
            attributes <DraftInput value={(spec.attributes || []).join(", ")} disabled={busy} width="22rem" placeholder="custom:my-data/A, custom:my-data/B"
              onCommit={(t) => patch({ attributes: t.split(",").map((x) => x.trim()).filter(Boolean), sort: undefined })} />
          </label>}
          {!fromProfile && <label className="tbfield" title="one bar per patient, or per sample">
            per <OptionSelect value={spec.unit === "sample" ? "sample" : "patient"} disabled={busy} onValueChange={(v) => patch({ unit: v === "sample" ? "sample" : undefined })}>
              <option value="patient">patient</option><option value="sample">sample</option>
            </OptionSelect>
          </label>}
        </div>
        <div className="tbz"><span className="tbl">view</span>
          {parts.length > 0 && <label className="tbfield" title="the part the cases are ordered by, highest first">
            sort by <OptionSelect value={spec.sort || parts[0]} disabled={busy} onValueChange={(v) => patch({ sort: v === parts[0] ? undefined : v })}>
              {parts.map((x) => <option key={x} value={x}>{names.get(x) || x}</option>)}
            </OptionSelect>
          </label>}
          <label className="chk" title="divide each case's parts by their sum, so every bar is a whole">
            <Checkbox checked={spec.normalize !== false} disabled={busy} onCheckedChange={(on) => patch({ normalize: on === true ? undefined : false })} /> shares
          </label>
        </div>
      </div>
    );
  }
  if (spec.kind === "enrichment") return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="which alteration to compare across every gene">
          alteration <OptionSelect value={spec.alteration || "mutation"} disabled={busy} onValueChange={(v) => patch({ alteration: v === "mutation" ? undefined : v })}>
            <option value="mutation">mutation</option><option value="cna">amp or deep deletion</option><option value="amp">amplification</option>
            <option value="homdel">deep deletion</option><option value="sv">structural variant</option>
          </OptionSelect>
        </label>
        <label className="tbfield" title="count every alteration, or only OncoKB drivers">
          count <OptionSelect value={spec.measure === "driver" ? "driver" : "any"} disabled={busy} onValueChange={(v) => patch({ measure: v === "driver" ? "driver" : undefined })}>
            <option value="any">any</option><option value="driver">drivers</option>
          </OptionSelect>
        </label>
        <label className="tbfield" title="genes altered in fewer samples than this across the cohorts are counted but not tested">
          test genes altered in ≥ <OptionSelect value={String(spec.minAltered ?? 5)} disabled={busy} onValueChange={(v) => patch({ minAltered: Number(v) })}>
            {[1, 5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </OptionSelect>
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
            category <OptionSelect value={by} disabled={busy} onValueChange={(v) => patch({ groupBy: v === "CANCER_TYPE" ? undefined : v })}>
              <option value="study">Cancer Study</option>
              <option value="CANCER_TYPE">Cancer Type</option>
              <option value="CANCER_TYPE_DETAILED">Cancer Type Detailed</option>
              {!cats.includes(by) && !["study", "CANCER_TYPE", "CANCER_TYPE_DETAILED"].includes(by) && <option value={by}>{by}</option>}
              {cats.filter((a) => a !== "CANCER_TYPE" && a !== "CANCER_TYPE_DETAILED").map((a) => <option key={a} value={a}>{a}</option>)}
            </OptionSelect>
          </label>
          <label className="tbfield" title="count patients (as the portal does by default — a patient counts in each group one of their samples is in) or samples">
            count by <OptionSelect value={spec.unit === "sample" ? "sample" : "patient"} disabled={busy} onValueChange={(v) => patch({ unit: v === "sample" ? "sample" : undefined })}>
              <option value="patient">patients</option><option value="sample">samples</option>
            </OptionSelect>
          </label>
          <label className="tbfield" title="count every alteration, or only OncoKB drivers">
            count <OptionSelect value={spec.measure === "driver" ? "driver" : "any"} disabled={busy} onValueChange={(v) => patch({ measure: v === "driver" ? "driver" : undefined })}>
              <option value="any">any alteration</option><option value="driver">drivers</option>
            </OptionSelect>
          </label>
          <label className="tbfield" title="groups with fewer profiled patients (or samples) than this are pooled into one bar, never dropped">
            min group <OptionSelect value={String(spec.minSamples ?? 10)} disabled={busy} onValueChange={(v) => patch({ minSamples: Number(v) })}>
              {[...new Set([1, 10, 50, 100, 200, 500, spec.minSamples ?? 10])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}</option>)}
            </OptionSelect>
          </label>
        </div>
        <div className="tbz"><span className="tbl">view</span>
          <label className="tbfield" title="the y axis: each group's altered share, or its altered count">
            y-axis <OptionSelect value={spec.show === "count" ? "count" : "frequency"} disabled={busy} onValueChange={(v) => patch({ show: v === "count" ? "count" : undefined })}>
              <option value="frequency">Alteration Frequency</option><option value="count">Absolute Counts</option>
            </OptionSelect>
          </label>
        </div>
      </div>
    );
  }
  if (spec.kind === "riskmodel") {
    const cats = c.attrs.filter((a) => a.kind !== "num").map((a) => a.attribute);
    const labelAbove = Number(spec.labelAbove ?? RISK_LABEL_ABOVE);
    return (
      <div className="viewtb riskmodel-tb">
        <div className="tbz"><span className="tbl">data</span>
          <label className="tbfield" title="mutations counted as a gene's feature">
            genes <OptionSelect value={spec.measure || "any"} disabled={busy} onValueChange={(v) => patch({ measure: v })}>
              <option value="any">any mutation</option><option value="driver">OncoKB drivers</option>
            </OptionSelect>
          </label>
          <label className="tbfield" title="a separate baseline hazard per value — use CANCER_TYPE on a cohort of several cancers, or a gene that marks a type carries its prognosis">
            stratify by <OptionSelect value={spec.strata || ""} disabled={busy} onValueChange={(v) => patch({ strata: v || undefined })}>
              <option value="">nothing</option>
              {!cats.includes(spec.strata) && spec.strata && <option value={spec.strata}>{spec.strata}</option>}
              {cats.map((a) => <option key={a} value={a}>{a}</option>)}
            </OptionSelect>
          </label>
          <PickMenu label="covariates" title="clinical attributes always kept in the model, never penalised (at most 6): numbers as they are, categories against their commonest value. Prefer an age at diagnosis to an age at last contact, which makes longer survivors look older"
            options={c.attrs.filter((a) => a.attribute !== spec.strata).map((a) => ({ value: a.attribute, label: a.attribute, hint: a.kind === "num" ? "number" : "category" }))}
            chosen={spec.covariates || []} max={6} busy={busy} menuId={"risk-cov:" + c.vi} menuStore={RISK_MENUS}
            onChange={(next) => patch({ covariates: next.length ? next : undefined })} />
          <label className="tbfield" title="start each patient's clock at a timeline event instead of the study's day 0; they then enter the risk set at day 0 (delayed entry)">
            clock from <OptionSelect value={spec.anchor?.eventType || ""} disabled={busy}
              onValueChange={(v) => patch({ anchor: v ? { ...(spec.anchor || {}), eventType: v } : undefined })}>
              <option value="">study's day 0</option>
              {spec.anchor?.eventType && !c.events.some((x) => x.label === spec.anchor.eventType) && <option value={spec.anchor.eventType}>{spec.anchor.eventType}</option>}
              {c.events.map((x) => <option key={x.label} value={x.label}>first {x.label}</option>)}
            </OptionSelect>
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
          <RiskModelSettings vi={c.vi} spec={spec} busy={busy} patch={patch} />
          <RiskGroupsButton spec={spec} m={c.v?.riskmodel} busy={busy} onApply={patch} />
          <RiskTable1Button vi={c.vi} spec={spec} m={c.v?.riskmodel} busy={busy} attrs={c.attrs} docJson={c.docJson} onPatch={patch} />
        </div>
        <div className="tbz"><span className="tbl">view</span>
          <label className="tbfield" title="the volcano names the genes the model kept in at least this share of its runs; the rest are drawn unnamed">
            label genes kept in ≥ <OptionSelect value={String(labelAbove)} disabled={busy} onValueChange={(v) => patch({ labelAbove: Number(v) === RISK_LABEL_ABOVE ? undefined : Number(v) })}>
              {!RISK_LABEL_STEPS.includes(labelAbove) && <option value={labelAbove}>{Math.round(labelAbove * 100)}%</option>}
              {RISK_LABEL_STEPS.map((t) => <option key={t} value={t}>{Math.round(t * 100)}%</option>)}
            </OptionSelect>
          </label>
        </div>
      </div>
    );
  }
  if (spec.kind === "adjusted") {
    const covs: string[] = Array.isArray(spec.covariates) ? spec.covariates : [];
    return (
      <div className="viewtb">
        <div className="tbz"><span className="tbl">data</span>
          <label className="tbfield" title="clinical attributes to adjust for, comma-separated (e.g. MSI_TYPE, TMB_NONSYNONYMOUS, CANCER_TYPE)">
            adjust for <DraftInput value={covs.join(", ")} disabled={busy} width="14rem" placeholder="none"
              onCommit={(t) => { const l = t.split(",").map((x) => x.trim()).filter(Boolean); patch({ covariates: l.length ? l : undefined }); }} />
          </label>
          <label className="tbfield" title="count every called mutation, or only OncoKB drivers">
            count <OptionSelect value={spec.measure === "driver" ? "driver" : "any"} disabled={busy} onValueChange={(v) => patch({ measure: v === "driver" ? "driver" : undefined })}>
              <option value="any">any</option><option value="driver">drivers</option>
            </OptionSelect>
          </label>
          <label className="tbfield" title="test the genes mutated in at least this share of the patients profiled for them (at most 200 genes)">
            genes mutated in ≥ <OptionSelect value={String(spec.minShare ?? 0.05)} disabled={busy} onValueChange={(v) => patch({ minShare: v === "0.05" ? undefined : Number(v) })}>
              {[...new Set([0.02, 0.03, 0.05, 0.1, 0.2, spec.minShare ?? 0.05])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{(100 * n).toFixed(0)}%</option>)}
            </OptionSelect>
          </label>
        </div>
      </div>
    );
  }
  if (spec.kind === "forest") {
    const e = spec.exposure || { source: "alteration", gene: "" };
    const isGene = e.source === "alteration";
    const cats = c.attrs.filter((a) => a.kind !== "num").map((a) => a.attribute);
    const strata = spec.strata || "CANCER_TYPE";
    return (
      <div className="viewtb">
        <div className="tbz"><span className="tbl">exposure</span>
          <label className="tbfield" title="a gene's mutation (patients not profiled for it are left out), or a clinical attribute">
            is <OptionSelect value={isGene ? "gene" : "attribute"} disabled={busy}
              onValueChange={(v) => patch(v === "gene" ? { exposure: { source: "alteration", gene: "TP53" }, threshold: undefined, exposed: undefined } : { exposure: { source: "clinical", attribute: "TMB_NONSYNONYMOUS" }, threshold: 10, exposed: undefined })}>
              <option value="gene">gene mutated</option><option value="attribute">attribute</option>
            </OptionSelect>
          </label>
          {isGene
            ? <span className="tbfield"><DraftInput value={e.gene || (e.genes || []).join(",")} disabled={busy} width="6rem" title="the gene whose mutation is the exposure"
                onCommit={(t) => patch({ exposure: { source: "alteration", gene: t.trim().toUpperCase() } })} /></span>
            : <>
                <span className="tbfield"><DraftInput value={e.attribute || ""} disabled={busy} width="9rem" title="the clinical attribute"
                  onCommit={(t) => patch({ exposure: { source: "clinical", attribute: t.trim() } })} /></span>
                <label className="tbfield" title="a numeric attribute: patients at or above this are the exposed">
                  ≥ <DraftInput value={spec.threshold != null ? String(spec.threshold) : ""} disabled={busy} width="4rem" placeholder="number"
                    onCommit={(t) => patch(t.trim() ? { threshold: Number(t), exposed: undefined } : { threshold: undefined })} />
                </label>
                <label className="tbfield" title="a categorical attribute: the level counted as exposed">
                  or = <DraftInput value={spec.exposed || ""} disabled={busy} width="6rem" placeholder="level"
                    onCommit={(t) => patch(t.trim() ? { exposed: t.trim(), threshold: undefined } : { exposed: undefined })} />
                </label>
              </>}
        </div>
        <div className="tbz"><span className="tbl">rows</span>
          <label className="tbfield" title="what one row is: a cancer type (or any categorical attribute), a study, or one of the view's cohorts">
            per <OptionSelect value={strata} disabled={busy} onValueChange={(v) => patch({ strata: v === "CANCER_TYPE" ? undefined : v })}>
              <option value="CANCER_TYPE">cancer type</option>
              <option value="CANCER_TYPE_DETAILED">detailed cancer type</option>
              <option value="study">study</option><option value="cohort">cohort</option>
              {!cats.includes(strata) && !["study", "cohort", "CANCER_TYPE", "CANCER_TYPE_DETAILED"].includes(strata) && <option value={strata}>{strata}</option>}
              {cats.filter((a) => a !== "CANCER_TYPE" && a !== "CANCER_TYPE_DETAILED").map((a) => <option key={a} value={a}>{a}</option>)}
            </OptionSelect>
          </label>
          <label className="tbfield" title="a stratum with fewer patients than this (or fewer than minEvents deaths) is pooled into Other, or left out">
            min <OptionSelect value={String(spec.minPatients ?? 30)} disabled={busy} onValueChange={(v) => patch({ minPatients: v === "30" ? undefined : Number(v) })}>
              {[...new Set([10, 30, 50, 100, 200, spec.minPatients ?? 30])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n} patients</option>)}
            </OptionSelect>
          </label>
          <label className="tbfield" title="the small strata: pooled into one Other row (each keeping its own baseline hazard), or left out and listed">
            small <OptionSelect value={spec.small === "drop" ? "drop" : "pool"} disabled={busy} onValueChange={(v) => patch({ small: v === "drop" ? "drop" : undefined })}>
              <option value="pool">pooled as Other</option><option value="drop">left out</option>
            </OptionSelect>
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
          <span className="tbfield">
            <DraftInput value={spec.test || ""} disabled={busy} width="7rem" title="the lab test, as its timeline attribute names it (e.g. PSA, CEA, CA_19-9)" onCommit={(t) => patch({ test: t.trim() })} />
          </span>
          <label className="tbfield" title="a responder's best fall from baseline, in percent">
            responder <OptionSelect value={String(spec.responseDrop ?? 50)} disabled={busy} onValueChange={(v) => patch({ responseDrop: Number(v) })}>
              {[30, 50, 90].map((d) => <option key={d} value={d}>fell ≥{d}%</option>)}
            </OptionSelect>
          </label>
        </div>
        <div className="tbz"><span className="tbl">clock</span>
          <label className="tbfield" title="the treatment start the course is read from">
            from first <OptionSelect value={an.eventType || ""} disabled={busy} onValueChange={(v) => patch({ anchor: { ...an, eventType: v } })}>
              {!types.includes(an.eventType) && <option value={an.eventType || ""}>{an.eventType || "choose…"}</option>}
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </OptionSelect>
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
            to <OptionSelect value={String(spec.toWeeks ?? 52)} disabled={busy} onValueChange={(v) => patch({ toWeeks: Number(v) })}>
              {[12, 26, 52, 104].map((w) => <option key={w} value={w}>{w} weeks</option>)}
            </OptionSelect>
          </label>
        </div>
      </div>
    );
  }
  if (spec.kind === "cutpoint") {
    const nums = c.attrs.filter((a) => a.kind === "num").map((a) => a.attribute);
    const cats = c.attrs.filter((a) => a.kind !== "num").map((a) => a.attribute);
    const attr = spec.attribute || "TMB_NONSYNONYMOUS";
    return (
      <div className="viewtb">
        <div className="tbz"><span className="tbl">data</span>
          <label className="tbfield" title="the numeric marker whose cut-point is searched">
            marker <OptionSelect value={attr} disabled={busy} onValueChange={(v) => patch({ attribute: v })}>
              {!nums.includes(attr) && <option value={attr}>{attr}</option>}
              {nums.map((a) => <option key={a} value={a}>{a}</option>)}
            </OptionSelect>
          </label>
          <label className="tbfield" title="a cut-point per value of this attribute (its largest values), as a table">
            per <OptionSelect value={spec.stratifyBy || ""} disabled={busy} onValueChange={(v) => patch({ stratifyBy: v || undefined })}>
              <option value="">(no strata)</option>
              {spec.stratifyBy && !cats.includes(spec.stratifyBy) && <option value={spec.stratifyBy}>{spec.stratifyBy}</option>}
              {cats.map((a) => <option key={a} value={a}>{a}</option>)}
            </OptionSelect>
          </label>
          <label className="tbfield" title="seeded permutations of the marker for the corrected p">
            permutations <OptionSelect value={String(spec.permutations ?? 1000)} disabled={busy} onValueChange={(v) => patch({ permutations: Number(v) })}>
              {[200, 1000, 2000, 5000].map((n) => <option key={n} value={n}>{n}</option>)}
            </OptionSelect>
          </label>
        </div>
      </div>
    );
  }
  if (spec.kind === "predictive") {
    const ex = spec.exposure || { eventType: "Treatment" };
    const types = c.events.map((x) => x.label);
    return (
      <div className="viewtb">
        <div className="tbz"><span className="tbl">exposure</span>
          <label className="tbfield" title="patients with an event of this type are exposed, the rest unexposed">
            had <OptionSelect value={ex.eventType || ""} disabled={busy} onValueChange={(v) => patch({ exposure: { ...ex, eventType: v } })}>
              {!types.includes(ex.eventType) && <option value={ex.eventType || ""}>{ex.eventType || "choose…"}</option>}
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </OptionSelect>
          </label>
          <label className="tbfield" title="only events with this attribute (e.g. SUBTYPE, AGENT); empty for any">
            where <DraftInput value={ex.key || ""} disabled={busy} width="6rem" placeholder="attribute"
              onCommit={(t) => patch({ exposure: { eventType: ex.eventType, ...(t.trim() ? { key: t.trim(), value: ex.value || "" } : {}) } })} />
          </label>
          <label className="tbfield" title="the value that attribute must take (e.g. Immuno)">
            = <DraftInput value={ex.value || ""} disabled={busy} width="7rem" placeholder="value"
              onCommit={(t) => patch({ exposure: { ...ex, value: t } })} />
          </label>
        </div>
      </div>
    );
  }
  if (spec.kind === "txendpoints") {
    const an = spec.anchor || { eventType: "Treatment" };
    const types = c.events.map((x) => x.label);
    return (
      <div className="viewtb">
        <div className="tbz"><span className="tbl">endpoint</span>
          <label className="tbfield" title="what ends each patient's time: the next treatment line, stopping this treatment, or recorded progression — death ends it too">
            to <OptionSelect value={spec.endpoint || "ttnt"} disabled={busy} onValueChange={(v) => patch({ endpoint: v })}>
              <option value="ttnt">next treatment (TTNT)</option>
              <option value="tot">end of treatment (TOT)</option>
              <option value="rwpfs">progression (rwPFS)</option>
            </OptionSelect>
          </label>
          <label className="tbfield" title="days without therapy that start a new treatment line">
            line gap <OptionSelect value={String(spec.lineGap ?? 90)} disabled={busy} onValueChange={(v) => patch({ lineGap: Number(v) })}>
              {[30, 60, 90, 120, 180].map((d) => <option key={d} value={d}>{d} days</option>)}
            </OptionSelect>
          </label>
        </div>
        <div className="tbz"><span className="tbl">clock</span>
          <label className="tbfield" title="the treatment record whose start begins the clock">
            from first <OptionSelect value={an.eventType || ""} disabled={busy} onValueChange={(v) => patch({ anchor: { ...an, eventType: v } })}>
              {!types.includes(an.eventType) && <option value={an.eventType || ""}>{an.eventType || "choose…"}</option>}
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </OptionSelect>
          </label>
          <label className="tbfield" title="only treatment records with this attribute (e.g. SUBTYPE, AGENT); empty for any">
            where <DraftInput value={an.key || ""} disabled={busy} width="6rem" placeholder="attribute"
              onCommit={(t) => patch({ anchor: { eventType: an.eventType, ...(an.occurrence ? { occurrence: an.occurrence } : {}), ...(t.trim() ? { key: t.trim(), value: an.value || "" } : {}) } })} />
          </label>
          <label className="tbfield" title="the value that attribute must take (e.g. Immuno, PEMBROLIZUMAB)">
            = <DraftInput value={an.value || ""} disabled={busy} width="7rem" placeholder="value"
              onCommit={(t) => patch({ anchor: { ...an, value: t } })} />
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
            type <OptionSelect value={e.eventType || ""} disabled={busy} onValueChange={(v) => setEvent({ ...e, eventType: v })}>
              {!types.includes(e.eventType) && <option value={e.eventType || ""}>{e.eventType || "choose…"}</option>}
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </OptionSelect>
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
            from <OptionSelect value={an ? an.eventType : ""} disabled={busy}
              onValueChange={(v) => patch({ anchor: v ? { eventType: v, occurrence: "FIRST" } : undefined })}>
              <option value="">day 0</option>
              {types.map((t) => <option key={t} value={t}>first {t}</option>)}
            </OptionSelect>
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
          count <OptionSelect value={spec.measure === "any" ? "any" : "driver"} disabled={busy} onValueChange={(v) => patch({ measure: v === "any" ? "any" : undefined })}>
            <option value="driver">driver mutations</option><option value="any">every mutation</option>
          </OptionSelect>
        </label>
        <label className="chk" title="use only samples whose FACETS_QC is Pass">
          <Checkbox checked={spec.qc !== false} disabled={busy} onCheckedChange={(on) => patch({ qc: (on === true) ? undefined : false })} /> FACETS QC pass only
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
            <span className="tbfield">
              <DraftInput value={csv(pb.a)} disabled={busy} title="the value(s) of that attribute on the first side; comma-separated for several" onCommit={(t) => setBy("a", t)} />
            </span>
            <label className="tbfield" title="the value(s) on the second side">
              vs <DraftInput value={csv(pb.b)} disabled={busy} onCommit={(t) => setBy("b", t)} />
            </label>
          </>}
          <label className="tbfield" title="test the genes you chose, or scan every gene altered in a paired patient and draw the most one-sided">
            genes <OptionSelect value={scanning ? "scan" : "chosen"} disabled={busy}
              onValueChange={(v) => patch(v === "scan" ? { genes: undefined } : { genes: PAIRED_DEFAULT_GENES, top: undefined })}>
              <option value="chosen">chosen</option><option value="scan">scan all</option>
            </OptionSelect>
          </label>
          {scanning && (
            <label className="tbfield" title="how many of the most one-sided genes to draw; q is still taken across every gene tested">
              drawn <OptionSelect value={String(spec.top ?? 20)} disabled={busy} onValueChange={(v) => patch({ top: Number(v) === 20 ? undefined : Number(v) })}>
                {[...new Set([10, 20, 30, 40, Number(spec.top ?? 20)])].sort((x, y) => x - y).map((n) => <option key={n} value={n}>{n}</option>)}
              </OptionSelect>
            </label>
          )}
          <label className="tbfield" title="count only OncoKB drivers, or every alteration">
            count <OptionSelect value={spec.measure === "any" ? "any" : "driver"} disabled={busy} onValueChange={(v) => patch({ measure: v === "any" ? "any" : undefined })}>
              <option value="driver">drivers</option><option value="any">any alteration</option>
            </OptionSelect>
          </label>
        </div>
      </div>
    );
  }
  if (spec.kind === "acquired") {
    const an = spec.anchor || { eventType: "Treatment" };
    const types = c.events.map((x) => x.label);
    const scanning = !(spec.genes && spec.genes.length);
    return (
      <div className="viewtb">
        <div className="tbz"><span className="tbl">clock</span>
          <label className="tbfield" title="the treatment start: each patient's first event of this type">
            first <OptionSelect value={an.eventType || ""} disabled={busy} onValueChange={(v) => patch({ anchor: { ...an, eventType: v } })}>
              {!types.includes(an.eventType) && <option value={an.eventType || ""}>{an.eventType || "choose…"}</option>}
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </OptionSelect>
          </label>
          <label className="tbfield" title="only anchor events with this attribute (e.g. SUBTYPE or AGENT); empty for any">
            where <DraftInput value={an.key || ""} disabled={busy} width="6rem" placeholder="attribute"
              onCommit={(t) => patch({ anchor: { eventType: an.eventType, ...(t.trim() ? { key: t.trim(), value: an.value || "" } : {}) } })} />
          </label>
          <label className="tbfield" title="the value that attribute must take (e.g. Hormone)">
            = <DraftInput value={an.value || ""} disabled={busy} width="6rem" placeholder="value"
              onCommit={(t) => patch({ anchor: { ...an, value: t } })} />
          </label>
          <label className="tbfield" title="the after-sample is the first at least this many days after the start">
            after ≥ <OptionSelect value={String(spec.minGapDays ?? 30)} disabled={busy} onValueChange={(v) => patch({ minGapDays: Number(v) === 30 ? undefined : Number(v) })}>
              {[...new Set([0, 30, 90, 180, 365, Number(spec.minGapDays ?? 30)])].sort((x, y) => x - y).map((d) => <option key={d} value={d}>{d} days</option>)}
            </OptionSelect>
          </label>
        </div>
        <div className="tbz"><span className="tbl">data</span>
          <label className="tbfield" title="test the genes you chose, or scan every gene altered after treatment in at least minPost patients">
            genes <OptionSelect value={scanning ? "scan" : "chosen"} disabled={busy}
              onValueChange={(v) => patch(v === "scan" ? { genes: undefined } : { genes: PAIRED_DEFAULT_GENES, top: undefined })}>
              <option value="chosen">chosen</option><option value="scan">scan all</option>
            </OptionSelect>
          </label>
          <label className="tbfield" title="any alteration, or only those OncoKB calls oncogenic">
            count <OptionSelect value={spec.measure === "driver" ? "driver" : "any"} disabled={busy} onValueChange={(v) => patch({ measure: v === "driver" ? "driver" : undefined })}>
              <option value="any">any alteration</option><option value="driver">oncogenic only</option>
            </OptionSelect>
          </label>
        </div>
      </div>
    );
  }
  if (spec.kind === "instability") return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="the |log2 segment mean| at or past which a segment counts as gained or lost">
          threshold <OptionSelect value={String(spec.threshold ?? 0.2)} disabled={busy} onValueChange={(v) => patch({ threshold: v === "0.2" ? undefined : Number(v) })}>
            {[...new Set([0.1, 0.2, 0.3, 0.5, Number(spec.threshold ?? 0.2)])].sort((x, y) => x - y).map((t) => <option key={t} value={t}>±{t}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" title="an arm is gained or lost when more than this share of its length is past the threshold">
          arm call <OptionSelect value={String(spec.armShare ?? 0.5)} disabled={busy} onValueChange={(v) => patch({ armShare: v === "0.5" ? undefined : Number(v) })}>
            {[...new Set([0.5, 0.75, 0.8, Number(spec.armShare ?? 0.5)])].sort((x, y) => x - y).map((t) => <option key={t} value={t}>&gt;{Math.round(t * 100)}% of arm</option>)}
          </OptionSelect>
        </label>
        <label className="chk" title="chromosome X's log ratio mostly records sex against the reference, so it is off by default">
          <Checkbox checked={spec.includeX === true} disabled={busy} onCheckedChange={(on) => patch({ includeX: (on === true) || undefined })} /> chrX
        </label>
      </div>
    </div>
  );
  if (spec.kind === "exclusivity") {
    const cats = c.attrs.filter((a) => a.kind !== "num").map((a) => a.attribute);
    return (
      <div className="viewtb">
        <div className="tbz"><span className="tbl">data</span>
          <label className="tbfield" title="estimate the background within each value of this sample attribute, so that subtypes with different drivers do not read as exclusivity">
            stratify by <OptionSelect value={spec.stratifyBy || ""} disabled={busy} onValueChange={(v) => patch({ stratifyBy: v || undefined })}>
              <option value="">none</option>
              {spec.stratifyBy && !cats.includes(spec.stratifyBy) && <option value={spec.stratifyBy}>{spec.stratifyBy}</option>}
              {cats.map((a) => <option key={a} value={a}>{a}</option>)}
            </OptionSelect>
          </label>
          <label className="tbfield" title="any alteration, or only those OncoKB calls oncogenic">
            count <OptionSelect value={spec.measure === "driver" ? "driver" : "any"} disabled={busy} onValueChange={(v) => patch({ measure: v === "driver" ? "driver" : undefined })}>
              <option value="any">any alteration</option><option value="driver">oncogenic only</option>
            </OptionSelect>
          </label>
        </div>
      </div>
    );
  }
  if (spec.kind === "ctdna") {
    const choosing = !!(spec.genes && spec.genes.length);
    const csv = (x: any, d: string[]) => (Array.isArray(x) && x.length ? x : d).join(", ");
    const parse = (t: string) => t.split(",").map((y) => y.trim()).filter(Boolean);
    return (
      <div className="viewtb">
        <div className="tbz"><span className="tbl">data</span>
          <label className="tbfield" title="the sample attribute's values that mark a plasma (cfDNA) sample; comma-separated">
            plasma <DraftInput value={csv(spec.plasma, ["cfDNA", "ctDNA"])} disabled={busy} width="7rem" onCommit={(t) => patch({ plasma: parse(t).length ? parse(t) : undefined })} />
          </label>
          <label className="tbfield" title="the values that mark a tissue sample">
            tissue <DraftInput value={csv(spec.tissue, ["Tumor"])} disabled={busy} width="6rem" onCommit={(t) => patch({ tissue: parse(t).length ? parse(t) : undefined })} />
          </label>
          <label className="tbfield" title="test the genes you chose, or the most altered in the paired patients">
            genes <OptionSelect value={choosing ? "chosen" : "top"} disabled={busy}
              onValueChange={(v) => patch(v === "top" ? { genes: undefined } : { genes: ["EGFR", "KRAS", "TP53", "PIK3CA", "BRAF"], top: undefined })}>
              <option value="chosen">chosen</option><option value="top">most altered</option>
            </OptionSelect>
          </label>
          <label className="tbfield" title="pair only samples the timeline dates within this many days of each other">
            drawn within <OptionSelect value={spec.withinDays == null ? "" : String(spec.withinDays)} disabled={busy} onValueChange={(v) => patch({ withinDays: v === "" ? undefined : Number(v) })}>
              {[...new Set(["", "30", "90", "365", spec.withinDays == null ? "" : String(spec.withinDays)])].map((d) => <option key={d} value={d}>{d === "" ? "any time" : d + " days"}</option>)}
            </OptionSelect>
          </label>
          <label className="tbfield" title="any alteration, or only those OncoKB calls oncogenic">
            count <OptionSelect value={spec.measure === "driver" ? "driver" : "any"} disabled={busy} onValueChange={(v) => patch({ measure: v === "driver" ? "driver" : undefined })}>
              <option value="any">any alteration</option><option value="driver">oncogenic only</option>
            </OptionSelect>
          </label>
        </div>
      </div>
    );
  }
  if (spec.kind === "pathways") return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="count only OncoKB-annotated drivers (as the paper counted curated oncogenic events), or every alteration">
          count <OptionSelect value={spec.measure === "any" ? "any" : "driver"} disabled={busy} onValueChange={(v) => patch({ measure: v === "any" ? "any" : undefined })}>
            <option value="driver">drivers</option><option value="any">any alteration</option>
          </OptionSelect>
        </label>
        <label className="tbfield" title="how many of each pathway's most-altered genes to draw; the rest are pooled and counted, never dropped">
          genes shown <OptionSelect value={String(spec.topGenes ?? 6)} disabled={busy} onValueChange={(v) => patch({ topGenes: Number(v) })}>
            {[3, 6, 9, 12].map((n) => <option key={n} value={n}>{n}</option>)}
          </OptionSelect>
        </label>
      </div>
    </div>
  );
  return null;
}

/** The view a fresh "add view" click starts from, built from what the study is known to have. */
export function defaultKindView(kind: string, known: Known): Record<string, unknown> {
  if (kind === "cancertypes") return { kind, genes: known.genes.length ? known.genes.slice(0, 5) : ["TP53", "KRAS"] };
  if (kind === "adjusted") return { kind };
  if (kind === "forest") return { kind, exposure: { source: "alteration", gene: known.genes[0] || "TP53" } };
  if (kind === "labs") {
    const tx = known.events.find((e) => /treat|therap|drug|medicat/i.test(e.canonical));
    return { kind, test: "PSA", anchor: { eventType: tx ? tx.label : "Treatment" } };
  }
  if (kind === "cutpoint") {
    const num = known.attrs.find((a) => a.attribute === "TMB_NONSYNONYMOUS") || known.attrs.find((a) => a.kind === "num");
    return { kind, attribute: num ? num.attribute : "TMB_NONSYNONYMOUS" };
  }
  if (kind === "predictive") {
    const tx = known.events.find((e) => /treat|therap|drug|medicat/i.test(e.canonical));
    return { kind, exposure: { eventType: tx ? tx.label : "Treatment", key: "SUBTYPE", value: "Immuno" }, genes: known.genes.length ? known.genes.slice(0, 8) : ["STK11", "KEAP1", "KRAS", "TP53", "EGFR"] };
  }
  if (kind === "txendpoints") {
    const tx = known.events.find((e) => /treat|therap|drug|medicat/i.test(e.canonical));
    return { kind, endpoint: "ttnt", anchor: { eventType: tx ? tx.label : "Treatment", key: "SUBTYPE", value: "Immuno" } };
  }
  if (kind === "incidence") {
    const ev = known.events.find((e) => /diagnos|progress|status/i.test(e.canonical)) || known.events[0];
    return { kind, event: { eventType: ev ? ev.label : "" } };
  }
  if (kind === "clonality") return { kind, genes: known.genes.length ? known.genes.slice(0, 8) : ["TP53", "KRAS", "APC", "PIK3CA", "SMAD4", "CDH1"] };
  if (kind === "paired") return { kind, genes: known.genes.length ? known.genes.slice(0, 8) : PAIRED_DEFAULT_GENES };
  if (kind === "acquired") {
    const tx = known.events.find((e) => /treat|therap|drug|medicat/i.test(e.canonical));
    return { kind, anchor: { eventType: tx ? tx.label : "Treatment" } };
  }
  if (kind === "exclusivity") return { kind, genes: known.genes.length >= 2 ? known.genes.slice(0, 8) : ["KRAS", "EGFR", "BRAF", "STK11", "KEAP1", "TP53"] };
  if (kind === "ctdna") return known.genes.length ? { kind, genes: known.genes.slice(0, 10) } : { kind };
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
  if (kind === "composition") {
    const profile = known.assays.find((p) => /cell_type.*relative|fraction|proportion/i.test(p)) || known.assays.find((p) => /signature/i.test(p) && /contribution/i.test(p)) || known.assays[0];
    return profile ? { kind, profileType: profile } : { kind, attributes: [] };
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
