"use client";
// The mutation table's Genome Nexus cells, as cBioPortal's mutation table draws them
// (react-mutation-mapper's Hgvsg, Hgvsc, ClinvarInterpretation and Signal columns): HGVSg links to the
// variant's page on the Genome Nexus of the study's genome; ClinVar shows the clinical significance,
// cut at 30 characters, and its record on hover; SIGNAL shows the germline frequency and, on hover,
// its table by cancer type. The values come from the offline store (lib/variant-annotation.ts), so
// there is no loading or failed state here: a row whose variant the store does not hold says so.
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { FloatingTip, useHoverTip, type TipBox } from "../_ui/tooltip.tsx";
import { hgvsgUrl, num, signalRows, truncate, upperFirst, type SignalEntry } from "../../lib/mutation-cell-text.ts";
import { portalPct, portalSig2 } from "../../lib/chart/format.ts";

export type CellTip = { at: TipBox; body: React.ReactNode };
type Show = (t: CellTip | null, x: number, y: number) => void;
type Detail = Record<string, unknown> | undefined;

/** One table's rich tips: the cells call `show`, the table draws `tip` once. */
export function useCellTips() {
  const { tip, move, hide, live } = useHoverTip<CellTip>();
  const node = tip ? <FloatingTip at={tip.at} live={live} className="mut-tip-box"><div className="mut-tip">{tip.body}</div></FloatingTip> : null;
  return { show: move as Show, hide, node };
}

/** pointer and keyboard handlers that open `body` beside the element */
function hover(show: Show, body: () => React.ReactNode) {
  const open = (el: HTMLElement, x: number, y: number) => {
    const b = el.getBoundingClientRect();
    show({ at: { left: b.left, top: b.top, right: b.right, bottom: b.bottom }, body: body() }, x, y);
  };
  return {
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => open(e.currentTarget, e.clientX, e.clientY),
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => show(null, e.clientX, e.clientY),
    onFocus: (e: React.FocusEvent<HTMLElement>) => { const b = e.currentTarget.getBoundingClientRect(); open(e.currentTarget, b.left, b.top); },
    onBlur: () => show(null, 0, 0),
  };
}

/** a hover target the keyboard can reach, drawn as the plain text it is */
const PLAIN = "cursor-default border-0 bg-transparent p-0 text-left font-[inherit] text-[length:inherit] text-[var(--ink)]";

const NOT_ANNOTATED = "not annotated: the Genome Nexus store holds no annotation of this variant (its study is not synced yet, or Genome Nexus could not annotate it)";

export function HgvsgCell({ hgvsg, detail, show }: { hgvsg: string; detail: Detail; show: Show }) {
  if (!hgvsg) return <span />;
  const url = hgvsgUrl(hgvsg, !!detail?.grch38);
  return (
    <span className="block max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap">
      <a className="text-[var(--ink)] no-underline hover:underline" href={url} target="_blank" rel="noopener noreferrer"
        {...hover(show, () => <>{hgvsg}<br />Click to see this variant on <a href={url} target="_blank" rel="noopener noreferrer">Genome Nexus</a></>)}>
        {hgvsg}&nbsp;<ExternalLink className="inline size-[0.9em] align-[-0.1em]" aria-hidden="true" />
      </a>
    </span>
  );
}

export function HgvscCell({ hgvsc, detail }: { hgvsc: string; detail: Detail }) {
  if (!detail?.annotated) return <span className="meta" data-tip={NOT_ANNOTATED}>&nbsp;</span>;
  return <span className="float-right">{hgvsc}</span>;
}

export function ClinvarCell({ detail, show }: { detail: Detail; show: Show }) {
  const cv = detail?.clinvar as { significance: string; conflicting: string; id: number | null } | undefined;
  if (!detail?.annotated) return <span className="block w-full overflow-hidden" data-tip={NOT_ANNOTATED}>&nbsp;</span>;
  if (!cv) return <span className="block w-full overflow-hidden" data-tip="Variant has no ClinVar data.">&nbsp;</span>;
  const link = "https://www.ncbi.nlm.nih.gov/clinvar/variation/" + cv.id + "/";
  return (
    <button type="button" className={PLAIN + " min-w-[1em] whitespace-nowrap"}
      {...hover(show, () => (
        <div className="max-w-[300px]">
          <div>{cv.significance}</div>
          {cv.conflicting && <div>{cv.conflicting}</div>}
          <div>(ClinVar ID: <a href={link} target="_blank" rel="noopener noreferrer">{cv.id}</a>)</div>
        </div>))}>
      {truncate(cv.significance) || "\u00a0"}
    </button>
  );
}

const SIGNAL_COLUMNS: [string, string][] = [
  ["Cancer Type", "Main cancer type based on OncoTree"],
  ["Mutation Status", "Somatic, Pathogenic Germline, or Rare Benign/VUS Germline"],
  ["# Patients", "Total number of patients"],
  ["# Carriers", "Total number of patients harboring a germline pathogenic variant"],
  ["% Prevalence", "# Carriers / # Patients"],
  ["% Biallelic", "Fraction of carriers with somatic biallelic inactivation in the corresponding tumor sample."],
  ["Median Age at Dx", "Median age at diagnosis of carriers"],
  ["Median TMB", "Median tumor mutational burden (TMB)"],
  ["MSI Score", "Median microsatellite instability (MSI) score determined by MSIsensor"],
  ["Median HRD LST", "Median of LST (large-scale state transitions) scores for carriers (a measure of # of breakpoints between large copy-number segments)"],
  ["Median HRD ntelomeric AI", "Median of HRD-TAI scores for carriers (a measure of allelic imbalance at telomeres)"],
  ["Median HRD Fraction LOH %", "Median of HRD-LOH scores for carriers (a measure of large LOH regions in the genome)"],
];

/** SIGNAL's table by cancer type (MutationTumorTypeFrequencyTable): by % prevalence, ten rows a page, totals underneath */
export function SignalTable({ entry }: { entry: SignalEntry }) {
  const rows = signalRows(entry).sort((a, b) => b.frequency - a.frequency);
  const [page, setPage] = useState(0);
  const size = Math.min(rows.length, 10), pages = Math.max(1, Math.ceil(rows.length / 10));
  const shown = rows.slice(page * 10, page * 10 + 10);
  const sum = (f: (r: (typeof rows)[number]) => number | null) => rows.reduce((a, r) => a + (f(r) || 0), 0);
  const patients = sum((r) => r.tumorTypeCount), carriers = sum((r) => r.variantCount);
  const bi = sum((r) => r.biallelicTumorCount), qc = sum((r) => r.qcPassTumorCount);
  const total = (x: number) => Number.isFinite(x) ? portalSig2(x) : "0";
  return (
    <div className="w-[780px] max-w-[90vw]">
      <table className="mut-signal">
        <thead><tr>{SIGNAL_COLUMNS.map(([h, tip]) => <th key={h} data-tip={tip}>{h}</th>)}</tr></thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.tumorType}>
              <td>{upperFirst(r.tumorType)}</td><td>{upperFirst(r.mutationStatus)}</td>
              <td className="num">{r.tumorTypeCount}</td><td className="num">{r.variantCount}</td>
              <td className="num" style={{ fontWeight: r.frequency > 0 ? "bold" : "normal" }}>{portalPct(r.frequency)}</td>
              <td className="num">{portalPct(r.biallelicRatio)}</td>
              <td className="num">{num(r.ageAtDx)}</td><td className="num">{num(r.tmb, 1)}</td><td className="num">{num(r.msiScore)}</td>
              <td className="num">{num(r.lst)}</td><td className="num">{num(r.ntelomericAi)}</td>
              <td className="num">{r.fractionLoh === 0 ? "0" : portalPct(r.fractionLoh)}</td>
            </tr>))}
          {Array.from({ length: size - shown.length }, (_, k) => <tr key={"pad" + k}><td colSpan={12}>&nbsp;</td></tr>)}
        </tbody>
        <tfoot><tr>
          <td><strong>Total</strong></td><td />
          <td className="num"><strong>{patients}</strong></td><td className="num"><strong>{carriers}</strong></td>
          <td className="num"><strong>{total((carriers * 100) / patients)}</strong></td>
          <td className="num"><strong>{total((bi * 100) / qc)}</strong></td>
          <td colSpan={6} />
        </tr></tfoot>
      </table>
      {pages > 1 && (
        <div className="mt-1 flex items-center justify-center gap-2">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="previous page">&lt;</button>
          <span className="meta">{page + 1} of {pages}</span>
          <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} aria-label="next page">&gt;</button>
        </div>)}
    </div>
  );
}

export function SignalCell({ value, detail, show }: { value: string; detail: Detail; show: Show }) {
  if (!detail?.annotated) return <span className="meta" data-tip={NOT_ANNOTATED}>&nbsp;</span>;
  const entry = detail.signal as SignalEntry | undefined;
  // the portal shows a frequency of 0 as nothing (its download keeps "0")
  if (!entry || !value || value === "0") return <div />;
  return <button type="button" className={PLAIN} {...hover(show, () => <SignalTable entry={entry} />)}>{value}</button>;
}
