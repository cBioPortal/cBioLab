"use client";
// The mutation table's Genome Nexus cells, as cBioPortal's mutation table draws them
// (react-mutation-mapper's Hgvsg, Hgvsc, ClinvarInterpretation, Signal, Gnomad and Dbsnp columns, and the
// Functional Impact column): HGVSg links to the variant's page on the Genome Nexus of the study's genome;
// ClinVar shows the clinical significance, cut at 30 characters, and its record on hover; SIGNAL and
// gnomAD show a frequency and, on hover, their tables; dbSNP links the id; Functional Impact draws a dot
// per predictor, its call on hover. The values come from the offline store (lib/variant-annotation.ts), so
// there is no loading or failed state here: a row whose variant the store does not hold says so.
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { FloatingTip, useHoverTip, type TipBox } from "../_ui/tooltip.tsx";
import { dbsnpUrl, gnomadText, hgvsgUrl, impactLevel, msaUrls, num, signalRows, truncate, upperFirst,
  type GnomadRow, type MaPrediction, type Prediction, type SignalEntry } from "../../lib/mutation-cell-text.ts";
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

const GNOMAD_COLUMNS: [keyof GnomadRow, string, string][] = [
  ["population", "Population", ""],
  ["alleleCount", "Allele Count", "Number of individuals with this allele"],
  ["alleleNumber", "Allele Number", "Number of times any allele has been observed at this position in the population"],
  ["homozygotes", "Number of Homozygotes", "Number of individuals carrying this allele in both copies"],
  ["alleleFrequency", "Allele Frequency", "Proportion of the population with this allele"],
];

/** gnomAD's table by population (GnomadFrequencyTable): the total last and in bold, and where the data comes from */
function GnomadTable({ rows, url }: { rows: GnomadRow[]; url: string }) {
  return (
    <div className="max-w-[90vw]">
      <table className="mut-signal">
        <thead><tr>{GNOMAD_COLUMNS.map(([k, h, tip]) => <th key={k} className={k === "population" ? undefined : "num"} data-tip={tip || undefined}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.population} style={{ fontWeight: r.population === "Total" ? "bold" : "normal" }}>
            <td>{r.population}</td><td className="num">{r.alleleCount}</td><td className="num">{r.alleleNumber}</td>
            <td className="num">{r.homozygotes}</td><td className="num">{gnomadText(r.alleleFrequency)}</td>
          </tr>))}</tbody>
      </table>
      <div className="mt-1 text-center text-[length:var(--t-xs)]">
        Source: <a href="https://www.genomenexus.org/" target="_blank" rel="noopener noreferrer">genomenexus.org</a>, which serves{" "}
        <a href="https://myvariant.info/" target="_blank" rel="noopener noreferrer">myvariant.info</a>&apos;s gnomAD data.<br />
        Latest <a href={url} target="_blank" rel="noopener noreferrer">gnomAD</a> data may differ.
      </div>
    </div>
  );
}

/** gnomAD's overall frequency, its table by population on hover (GnomadFrequency) */
export function GnomadCell({ detail, show }: { detail: Detail; show: Show }) {
  if (!detail?.annotated) return <span className="meta" data-tip={NOT_ANNOTATED}>&nbsp;</span>;
  const g = detail.gnomad as { rows: GnomadRow[]; url: string } | undefined;
  if (!g) return <span className="block w-full overflow-hidden" data-tip="Variant has no data in gnomAD.">&nbsp;</span>;
  const total = g.rows[g.rows.length - 1].alleleFrequency;
  return <button type="button" className={PLAIN} {...hover(show, () => <GnomadTable rows={g.rows} url={g.url} />)}>{gnomadText(total)}</button>;
}

/** dbSNP's id, linked to its page (DbsnpId) */
export function DbsnpCell({ rsid, detail }: { rsid: string; detail: Detail }) {
  if (!detail?.annotated) return <span className="meta" data-tip={NOT_ANNOTATED}>&nbsp;</span>;
  if (!rsid) return <span className="block w-full overflow-hidden" data-tip="Variant has no dbSNP data.">&nbsp;</span>;
  return (
    <span className="float-right text-right">
      <a href={dbsnpUrl(rsid)} target="_blank" rel="noopener noreferrer" data-tip="Click to see variant on dbSNP website.">{rsid}</a>
    </span>
  );
}

type Tool = "ma" | "sift" | "polyphen" | "alphaMissense";
const TOOLS: { id: Tool; label: string; name: string; url?: string; about: React.ReactNode }[] = [
  { id: "ma", label: "MA", name: "Mutation Assessor", about: <>
    Mutation Assessor predicts the functional impact of amino-acid substitutions in proteins, such as mutations discovered in cancer or
    missense polymorphisms. The functional impact is assessed based on evolutionary conservation of the affected amino acid in protein
    homologs. The method has been validated on a large set of disease associated and polymorphic variants (
    <a href="https://www.ncbi.nlm.nih.gov/clinvar/" target="_blank" rel="noopener noreferrer">ClinVar</a>).<br />
    <b>Mutation Assessor V4 data is available in the portal since Oct. 8, 2024.</b> New manuscript is in progress. Click{" "}
    <a href="http://mutationassessor.org/r3/" target="_blank" rel="noopener noreferrer">here</a> to see information about V3 data.</> },
  { id: "sift", label: "SIFT", name: "SIFT", url: "http://sift.bii.a-star.edu.sg/", about: <>
    <a href="http://sift.bii.a-star.edu.sg/" target="_blank" rel="noopener noreferrer">SIFT</a> predicts whether an amino acid substitution
    affects protein function based on sequence homology and the physical properties of amino acids. SIFT can be applied to naturally
    occurring nonsynonymous polymorphisms and laboratory-induced missense mutations.</> },
  { id: "polyphen", label: "PP2", name: "PolyPhen-2", url: "http://genetics.bwh.harvard.edu/pph2/", about: <>
    <a href="http://genetics.bwh.harvard.edu/pph2/" target="_blank" rel="noopener noreferrer">PolyPhen-2</a> (Polymorphism Phenotyping v2)
    is a tool which predicts possible impact of an amino acid substitution on the structure and function of a human protein using
    straightforward physical and comparative considerations.</> },
  { id: "alphaMissense", label: "AM", name: "AlphaMissense", url: "https://alphamissense.hegelab.org/", about: <>
    <a href="https://alphamissense.hegelab.org/" target="_blank" rel="noopener noreferrer">AlphaMissense</a> predicts the probability of a
    missense single nucleotide variant being pathogenic and classifies it as either likely benign, likely pathogenic, or uncertain.</> },
];

/** the legend under each predictor's description: the dot colours and each predictor's call for them */
const LEGEND: [string, string, string, string, string][] = [
  ["high", "high", "deleterious", "probably_damaging", "pathogenic"],
  ["medium", "medium", "-", "-", "-"],
  ["low", "low", "deleterious_low_confidence", "possibly_damaging", "ambiguous"],
  ["neutral", "neutral", "tolerated_low_confidence", "benign", "benign"],
  ["neutral", "-", "tolerated", "-", "-"],
];

const Dot = ({ level }: { level: string }) => <span className={"fi-dot fi-" + level} aria-hidden="true">●</span>;

/** a predictor's description and the legend, as the portal's header icons show them; hovering a legend icon switches the description */
function ImpactLegend({ first }: { first: Tool }) {
  const [active, setActive] = useState<Tool>(first);
  return (
    <div className="w-[530px] max-w-[90vw]">
      <div className="mb-2">{TOOLS.find((t) => t.id === active)!.about}</div>
      <table className="mut-signal">
        <thead><tr><th>Legend</th>{TOOLS.map((t) => <th key={t.id} onPointerEnter={() => setActive(t.id)}>{t.label}</th>)}</tr></thead>
        <tbody>{LEGEND.map(([lv, ...calls], i) => <tr key={i}><td><Dot level={lv} /></td>{calls.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** the Functional Impact header's row of predictor labels, each opening its description and the legend */
export function FunctionalImpactHead({ show }: { show: Show }) {
  return (
    <span className="fi-row" aria-label="predictors: Mutation Assessor, SIFT, PolyPhen-2, AlphaMissense">
      {TOOLS.map((t) => <span key={t.id} className="fi-slot fi-label" {...hover(show, () => <ImpactLegend first={t.id} />)}>{t.label}</span>)}
    </span>
  );
}

/** one predictor's call: Source, Impact and Score, as the portal's tooltip tables show them */
function PredictionTip({ tool, p }: { tool: (typeof TOOLS)[number]; p: Prediction | MaPrediction }) {
  const level = impactLevel(tool.id, p.prediction) ?? "neutral";
  const msa = "msa" in p && p.msa ? msaUrls(p.msa) : null;
  return (
    <div>
      <table className="mut-signal"><tbody>
        <tr><td>Source</td><td>{tool.url ? <a href={tool.url} target="_blank" rel="noopener noreferrer">{tool.name}</a> : tool.name}</td></tr>
        <tr><td>Impact</td><td><span className={"fi-" + level}>{p.prediction}</span></td></tr>
        {(p.score || p.score === 0) && <tr><td>Score</td><td><b>{p.score.toFixed(2)}</b></td></tr>}
      </tbody></table>
      {msa && <div className="mt-1">Multiple sequence alignment file:{" "}
        <a href={msa.view} target="_blank" rel="noopener noreferrer">View</a> |{" "}
        <a href={msa.download} target="_blank" rel="noopener noreferrer">Download</a></div>}
    </div>
  );
}

/** a dot per predictor with a call, an empty slot for one without (FunctionalImpactColumnFormatter) */
export function FunctionalImpactCell({ detail, show }: { detail: Detail; show: Show }) {
  if (!detail?.annotated) return <span className="meta" data-tip={NOT_ANNOTATED}>&nbsp;</span>;
  const fi = detail.impact as Record<Tool, Prediction | MaPrediction | null> | undefined;
  if (!fi) return <span className="meta" data-tip="Data not available.">&nbsp;</span>;
  return (
    <span className="fi-row">
      {TOOLS.map((t) => {
        const p = fi[t.id];
        const level = p && p.prediction ? impactLevel(t.id, p.prediction) : null;
        if (!p || !p.prediction || !level) return <span key={t.id} className="fi-slot" />;
        return <button key={t.id} type="button" className={PLAIN + " fi-slot"} aria-label={t.name + ": " + p.prediction}
          {...hover(show, () => <PredictionTip tool={t} p={p} />)}><Dot level={level} /></button>;
      })}
    </span>
  );
}
