"use client";
// The alterations view's card: one patient's Mutations, Copy Number Alterations and Structural
// Variants tables (cBioPortal's patient view), one under the other, each the shared table
// (app/_table/DataTable.tsx) with its own query in the spec. The navigator above them steps through
// the cohort's patients and opens their list (app/lab/patient-nav.tsx); the cohort is the header's
// picker, as for every view.
import React, { useEffect, useMemo, useState } from "react";
import { DataTable, specQuery } from "../_table/DataTable.tsx";
import { GearMenu } from "../_ui/gear-menu.tsx";
import { RadioGroup, RadioGroupItem } from "../_ui/radio-group";
import { Settings } from "lucide-react";
import type { TableQuery } from "../../lib/types";
import { AnnotationBadge } from "./portal-bodies";
import { MutationTypeCell } from "./mutation-cells.tsx";
import { PatientNav, PatientsDialog, patientKeys, type PatientKey } from "./patient-nav.tsx";
import type { AlterationsResult, AlleleReads } from "../../lib/views/alterations/types";
import { CohortCell } from "./cohort-cell.tsx";
import { STYLE } from "../../lib/oncoprint-style.ts";
import { useGenePanelDialog } from "./gene-panel-dialog.tsx";
import { portalPercentage, portalVaf } from "../../lib/chart/format.ts";
import { mrnaDot, mrnaTooltip } from "../../lib/views/alterations/mrna-cell.ts";
import { emitLocus, onLocus, patientKey } from "./locus-bus";
import { VafPlotHead } from "./vaf-plot-head";
import { NotProfiledNote } from "../portal/sample-marker";

type Spec = { patient?: PatientKey } & Record<string, unknown>;

/** what the portal's not-profiled alerts call each table's data */
const NOT_PROFILED_FOR: Record<"mutations" | "cna" | "sv", string> = { mutations: "mutations", cna: "copy number alterations", sv: "structural variants" };

/** the portal's words for a sample whose panel leaves out the row's gene (TumorColumnFormatter) */
const NOT_PROFILED = "This gene was not profiled for this sample (absent from gene panel)";
const PILL = STYLE.notProfiledPill;

/** The three tables, in the portal's order (Mutations, Structural Variants, Copy Number Alterations): the spec's key, and its name — its count line reads "7 Mutations", as the portal's does. */
const TABLES = [
  { key: "mutations", name: "Mutations" },
  { key: "sv", name: "Structural Variants" },
  { key: "cna", name: "Copy Number Alterations" },
] as const;

export function AlterationsBody({ a, spec, vi, updating, docJson, patch, fixed }: {
  a: AlterationsResult; spec: Spec; vi: number; updating: boolean; docJson?: () => string; patch: (p: Record<string, unknown>) => void;
  /** one patient only (the Patient page): no navigator through the cohort's others */
  fixed?: boolean;
}) {
  const [listOpen, setListOpen] = useState(false);
  const p = a.patient;
  // the portal's gene panel window, which every gene-panel link opens (PAT-GP-3, PAT-GP-4)
  const panels = useGenePanelDialog(p?.study || "");
  // numbered on the server as the header numbers them (collection day, type, id)
  const allMarks = useMemo(() => new Map((p?.samples || []).map((m) => [m.id, m])), [p]);
  // the samples the tables read, each keeping its number among all the patient's (the portal's sample view)
  const marks = useMemo(() => p?.shown ? new Map([...allMarks].filter(([id]) => p.shown!.includes(id))) : allMarks, [p, allMarks]);
  // the Allele Freq bars' slots: one per sample in view, in sample order, as the Samples column's
  const slot = useMemo(() => new Map([...marks.keys()].map((id, i) => [id, i])), [marks]);
  const go = (to: PatientKey | null | undefined) => { if (to && !updating) patch({ patient: to }); };
  // the mutation or copy-number row clicked: the genomic overview zooms to its gene, and its Reset view lets go
  // (the portal's onMutationTableRowClick / onCnaTableRowClick / onResetViewClick); one row at a time across the tables
  const busKey = p ? patientKey(p.study, p.id) : "";
  const [picked, setPicked] = useState<{ table: string; row: string } | null>(null);
  useEffect(() => { setPicked(null); return busKey ? onLocus(busKey, (e) => { if (e.kind === "reset") setPicked(null); }) : undefined; }, [busKey]);
  const isSel = (row: { study: string; patient: string }) => p != null && row.study === p.study && row.patient === p.id;
  // a table's query goes to its own key, keeping its page size; an empty one leaves the key out
  const setQuery = (key: string, q: TableQuery) => {
    const rows = (spec[key] as { rows?: number } | undefined)?.rows;
    const next = Object.fromEntries(Object.entries({ ...q, rows }).filter(([, x]) => x !== undefined));
    patch({ [key]: Object.keys(next).length ? next : undefined });
  };
  // one slot per sample of the patient, in sample order: the sample's marker where it carries the row's alteration,
  // "--" in a slot of the same width where it does not — so a row reads as one alteration across the patient's samples
  // the portal's Samples cell (TumorColumnFormatter): a sample's marker where it carries the row, an empty slot where it
  // was profiled for the gene and does not, a grey pill where its panel leaves the gene out (PAT-GP-2)
  const sampleCell = (x: unknown, row: { detail?: Record<string, unknown> }) => {
    const has = new Set(String(x || "").split(", ").filter(Boolean));
    const off = new Set((row.detail?.notProfiled as string[] | undefined) || []);
    const slots = [...marks.values()].map((m) => ({ id: m.id, label: m.label, color: m.color, type: m.type }));
    for (const id of has) if (!marks.has(id)) slots.push({ id, label: "?", color: "var(--muted)", type: "" });
    return (
      <span className="alt-samples" aria-label={"in " + [...has].join(", ")}>
        {slots.map((m) => {
          const on = has.has(m.id), np = off.has(m.id);
          const who = m.id + (m.type ? " — " + m.type : "");
          const tip = on ? who + (np ? "\n" + NOT_PROFILED : "") : np ? who + "\n" + NOT_PROFILED + ". It is unknown whether it is mutated." : undefined;
          return (
            <svg key={m.id} width="14" height="14" aria-hidden="true" data-tip={tip} data-np={np && !on ? "" : undefined}>
              {on ? <>
                <circle cx="7" cy="7" r="7" fill={m.color} />
                <text x="7" y="7" dy=".33em" textAnchor="middle" fontSize="9" fill="white">{m.label}</text>
              </> : np ? <rect x={(14 - PILL.width) / 2} y={PILL.y + 1} width={PILL.width} height={PILL.height} rx={PILL.height / 2} fill={PILL.fill} /> : null}
            </svg>);
        })}
      </span>
    );
  };

  // the portal's Allele Freq cell (AlleleFreqColumnFormatter): one sample in view, its VAF as text; several, a 6-px bar per
  // sample of the patient in sample order, VAF × 12 px high in the sample's colour; each sample's reads on hover
  const vafCell = (row: { detail?: Record<string, unknown> }) => {
    const reads = ((row.detail?.reads || []) as AlleleReads[]).filter((r) => marks.has(r.sample));
    const vaf = (r: AlleleReads) => r.alt / (r.alt + r.ref);
    const lines = reads.map((r) => (marks.get(r.sample)?.label ?? "?") + "  " + portalVaf(vaf(r)) + " (" + r.alt + " variant reads out of " + (r.alt + r.ref) + " total)");
    const tip = lines.length ? lines.join("\n") : undefined;
    if (marks.size === 1) return <span data-tip={tip}>{reads[0] ? portalVaf(vaf(reads[0])) : ""}</span>;
    if (!reads.length) return <span />;
    return (
      <svg width={slot.size * 6 + (slot.size - 1) * 3} height={12} data-tip={tip} role="img" aria-label={"allele frequency: " + lines.join("; ")}>
        {reads.map((r) => {
          const h = vaf(r) * 12;
          return <rect key={r.sample} x={(slot.get(r.sample) ?? 0) * 9} y={12 - h} width={6} height={h} fill={marks.get(r.sample)?.color} />;
        })}
      </svg>);
  };

  return (
    // eslint-disable-next-line jsx-a11y-x/no-static-element-interactions -- arrow-key shortcuts for the patient buttons PatientNav already provides
    <div className="tl-view" tabIndex={-1} onKeyDown={patientKeys(a.position, go)}>
      {!fixed && <PatientNav shown={p ? p.id : null} position={a.position} total={a.total} updating={updating} go={go} what="list its alterations"
        openList={() => setListOpen(true)} first={() => patch({ patient: undefined })} />}
      {p ? (
        <div className="tl-head">
          <span className="tl-who mono">{p.id}</span>
          <span className="meta">{p.study}{p.source?.remote ? " · from " + p.source.label + " via federation" : ""}</span>
          {[...marks.values()].map((m) => (
            <span key={m.id} className="tl-sample" data-tip={m.id + (m.type ? " — " + m.type : "")}>
              <svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="7" fill={m.color} /><text x="7" y="7" dy=".33em" textAnchor="middle" fontSize="9" fill="white">{m.label}</text></svg>
              <span className="mono">{m.id}</span>
            </span>))}
          {marks.size > 1 && <span className="note alt-key">Each row is one alteration in one gene across these samples: a sample's marker where it carries it, -- where it does not. A gene's rows sit together, shaded alike, in sample order.</span>}
        </div>
      ) : <p className="meta">No patient to list: the cohort's patient list is empty.</p>}
      {p && TABLES.map(({ key, name }) => {
        const t = a.tables[key];
        if (!t) return null;
        // the portal's not-profiled alerts (PAT-CNA-2, PAT-SV-2, PAT-NP-1): no profile, no table; samples outside it named above it
        const pr = a.profiling?.[key];
        const what = NOT_PROFILED_FOR[key];
        if (pr && !pr.study) return <section key={key} className="alt-table" aria-label={name}><p className="note" role="status">Study is not profiled for {what}.</p></section>;
        const outside = pr ? [...marks.values()].filter((m) => !pr.profiled.includes(m.id)) : [];
        const none = pr != null && outside.length === marks.size;
        return (
          <section key={key} className="alt-table" aria-label={name}>
            <NotProfiledNote marks={outside} what={what} period={!none} />
            {!none && <DataTable t={t} query={specQuery((spec[key] || {}) as Record<string, unknown>)} updating={updating} vi={vi} docJson={docJson} table={key} unit={name} groupBy={key === "sv" ? "gene1" : "gene"}
              onQuery={(q) => setQuery(key, q)}
              {...(key === "sv" ? {} : {
                onRow: (r: { values: unknown[] }) => {
                  setPicked({ table: key, row: JSON.stringify(r) });
                  const gene = r.values[t.columns.findIndex((c) => c.id === "gene")];
                  if (gene) emitLocus(busKey, { kind: "gene", gene: String(gene) });
                },
                selected: (r: { values: unknown[] }) => picked?.table === key && picked.row === JSON.stringify(r),
              })}
              num={(id, x) => id === "vaf" ? portalVaf(x) : id === "freq" ? portalPercentage(x / 100) : id === "mrna" ? Math.round(x) + "%" : x.toLocaleString()}
              colHead={(id) => id === "gene" && (key === "mutations" || key === "cna") && marks.size > 1 && a.mixedPanels?.[key]
                ? <GenesProfiledMenu table={key} value={(spec.genesProfiled as "any" | "all" | undefined) || "any"} what={key === "mutations" ? "mutations" : "copy number alterations"} disabled={updating}
                    onChange={(g) => patch({ genesProfiled: g === "any" ? undefined : g })} />
                : id === "vaf" && key === "mutations" ? <VafPlotHead vafs={a.vafs} marks={marks} /> : null}
              cell={(id, x, row) => id === "samples" ? sampleCell(x, row)
                : id === "vaf" && key === "mutations" ? vafCell(row)
                : id === "annotation" ? <AnnotationBadge text={String(x || "")} />
                : id === "mutationType" ? <MutationTypeCell raw={String(row.detail?.mutationType ?? x ?? "")} />
                : id === "genePanel" ? <PanelLinks text={String(row.detail?.genePanelShown ?? x ?? "")} open={p?.source?.remote ? null : (panel) => void panels.open(panel)} />
                : id === "mrna" && key === "mutations" ? <MrnaCell percentile={x == null ? null : Number(x)} z={row.detail?.mrnaZ as number | undefined} />
                : id === "freq" && (key === "mutations" || key === "cna") ? <CohortCell row={row} gene={String(row.values[t.columns.findIndex((c) => c.id === "gene")] ?? "")}
                    cna={key === "cna" ? String(row.values[t.columns.findIndex((c) => c.id === "cna")] ?? "") : undefined} shown={x != null} />
                : id === "cna" && x ? <span className={"alt-cna " + (x === "AMP" ? "amp" : "del")}>{x}</span>
                : id === "status" && key === "sv" ? <SvStatus value={String(x || "")} />
                : id === "gene" || id === "gene1" || id === "gene2" ? <b>{x}</b>
                : undefined} />}
          </section>);
      })}
      {panels.node}
      {listOpen && (
        <PatientsDialog title={"Patients of " + (a.lists[0]?.cohort ?? "the cohort")} onClose={() => setListOpen(false)}>
          {(close) => (
            <DataTable t={a} query={specQuery(spec)} updating={updating} vi={vi} docJson={docJson} unit="patients"
              title="choose a patient" onQuery={(q) => patch({ ...q })}
              onRow={(row) => { if (!isSel(row)) patch({ patient: { study: row.study, id: row.patient } }); close(); }} selected={isSel}
              cell={(id, x) => id === "patient" ? <span className="mono">{x}</span> : undefined} />
          )}
        </PatientsDialog>
      )}
    </div>
  );
}

/**
 * The Gene panel cell (PanelColumnFormatter GenePanelLinks): each sample's panel id, a link opening the
 * gene panel window; "N/A" (a sample with no panel) plain, as is every id of a peer's patient, whose
 * panels' genes are not read from here.
 */
function PanelLinks({ text, open }: { text: string; open: ((panel: string) => void) | null }) {
  const ids = text ? text.split(", ") : [];
  return <span>{ids.map((id, i) => <span key={i}>{i > 0 && ", "}{id === "N/A" || !open ? id
    : <button type="button" className="linkish" data-tip={"the genes of " + id} onClick={() => open(id)}>{id}</button>}</span>)}</span>;
}

/**
 * The mRNA Expr. cell as the portal's (MrnaExprColumnFormatter): a grey line with a dot at the gene's
 * mRNA percentile in the sample, blue when low, red when high, the percent beside it and the z-score
 * on hover; nothing drawn where the gene has no mRNA value, with the portal's words on hover.
 */
function MrnaCell({ percentile, z }: { percentile: number | null; z?: number }) {
  const tip = mrnaTooltip(percentile, z);
  if (percentile == null) return <span className="alt-mrna-na" data-tip={tip}>&nbsp;</span>;
  const d = mrnaDot(percentile);
  return (
    <svg width={d.width} height={d.height} data-tip={tip} role="img" aria-label={tip.replace(/\n/g, "; ")}>
      <text x={d.textX} y={d.textY} fontSize={d.fontSize} fill="currentColor">{d.text}</text>
      <line x1={0} y1={d.lineY} x2={d.lineWidth} y2={d.lineY} stroke={d.line} strokeWidth={d.lineStroke} />
      <circle cx={d.cx} cy={d.lineY} r={d.r} fill={d.fill} />
    </svg>
  );
}

/**
 * A structural variant's status as the portal's patient table draws it (react-mutation-mapper
 * MutationStatus with s / g): a somatic "s" or germline "g" badge, anything else small and grey,
 * the stored value on hover.
 */
function SvStatus({ value }: { value: string }) {
  if (!value) return <span />;
  const v = value.toLowerCase();
  const kind = v.includes("somatic") ? { text: "s", bg: "#ccffff" } : v.includes("germline") ? { text: "g", bg: "#ffffcc" } : null;
  return kind
    ? <span className="px-[5px] text-sm font-bold text-black" style={{ background: kind.bg }} data-tip={value}>{kind.text}</span>
    : <span className="text-xs text-[#9d9d9d]" data-tip={value}>{value}</span>;
}

/** where the gene filter menus' open state outlives the card remounting when a pick re-runs the view */
const MENU_STORE = new Map<string, boolean>();

/**
 * The portal's gene filter in the Gene header (GeneFilterMenu, PAT-MT-6), offered when the samples in
 * view were sequenced with different panels and a row's gene is missing from one: every gene, or only
 * those profiled in all the samples. It sets the view's `genesProfiled` (both tables read it).
 */
function GenesProfiledMenu({ table, value, what, disabled, onChange }: { table: string; value: "any" | "all"; what: string; disabled: boolean; onChange: (g: "any" | "all") => void }) {
  const id = "genes-profiled-" + table;
  return (
    <GearMenu menuId={id} menuStore={MENU_STORE} title={value === "all" ? "showing genes profiled in all samples" : "different gene panels were used for the samples"}
      ariaLabel="filter genes by the samples' gene panels" className="ml-1 h-5 px-1" label={<Settings className="size-3.5" />} wide>
      <p className="mb-2 text-sm">Different gene panels were used for the samples. Filter {what} for:</p>
      <RadioGroup value={value} onValueChange={(v) => onChange(v === "all" ? "all" : "any")} disabled={disabled} aria-label="genes profiled in">
        <label className="flex items-center gap-2 text-sm" htmlFor={id + "-any"}><RadioGroupItem id={id + "-any"} value="any" /> Genes profiled in any sample</label>
        <label className="flex items-center gap-2 text-sm" htmlFor={id + "-all"}><RadioGroupItem id={id + "-all"} value="all" /> Genes profiled in all samples</label>
      </RadioGroup>
    </GearMenu>
  );
}
