// How the mutation table spells its Genome Nexus cells, as cBioPortal's mutation table does
// (react-mutation-mapper's Hgvsg, ClinvarInterpretation, Signal, Gnomad and Dbsnp columns and GnomadUtils;
// cbioportal-utils' SignalMutationUtils; the Functional Impact column's predictors). The cells
// (app/lab/mutation-cells.tsx) draw these; FormatUtils' number formats are lib/chart/format.ts's
// portalSig2 and portalPct.

/** the Genome Nexus variant page HGVSg links to: the GRCh38 service's for a study on hg38 */
export function hgvsgUrl(hgvsg: string, grch38: boolean): string {
  return (grch38 ? "https://grch38.genomenexus.org" : "https://www.genomenexus.org") + "/variant/" + encodeURIComponent(hgvsg);
}

/**
 * The Ensembl page of a transcript, as the portal's GeneSummary links it: the GRCh38 site for a
 * GRCh38 query, else the GRCh37 archive; the id's version left out of t=.
 */
export function ensemblTranscriptUrl(id: string, grch38: boolean): string {
  return (grch38 ? "https://www.ensembl.org" : "https://grch37.ensembl.org") + "/homo_sapiens/Transcript/Summary?t=" + id.replace(/\.\d+$/, "");
}

/**
 * Whether a query is on GRCh38, as the portal decides which Genome Nexus to ask (StoreUtils
 * getGenomeBuildFromStudies): only when every study's reference genome is GRCh38 or hg38.
 */
export function isGrch38(builds: string[]): boolean {
  return builds.length > 0 && builds.every((b) => /grch38|hg38/i.test(b));
}

/** cBioPortal's TruncatedText: past 32 characters, the first 30 and "..." */
export function truncate(text: string, max = 30, buffer = 2): string {
  return text.length > max + buffer ? text.substring(0, max) + "..." : text;
}

type Count = { tumorType: string; tumorTypeCount: number; variantCount: number };
type Stats = { tumorType: string; ageAtDx?: number | null; tmb?: number | null; msiScore?: number | null;
  hrdScore?: { lst?: number | null; ntelomericAi?: number | null; fractionLoh?: number | null } | null };
/** SIGNAL's entry for a variant, as Genome Nexus returns it (the fields its table reads) */
export type SignalEntry = { mutationStatus: string; pathogenic?: string; countsByTumorType?: Count[]; biallelicCountsByTumorType?: Count[];
  qcPassCountsByTumorType?: Count[]; statsByTumorType?: Stats[] };

/** one row per cancer type, as SignalMutationUtils.generateTumorTypeDecomposition builds it */
export function signalRows(e: SignalEntry) {
  const by = <T extends { tumorType: string }>(xs?: T[]) => new Map((xs || []).map((x) => [x.tumorType, x]));
  const bi = by(e.biallelicCountsByTumorType), qc = by(e.qcPassCountsByTumorType), st = by(e.statsByTumorType);
  const both = !!e.biallelicCountsByTumorType && !!e.qcPassCountsByTumorType;
  const status = e.mutationStatus.toLowerCase() === "germline" ? (e.pathogenic === "1" ? "Germline - Pathogenic" : "Germline - Benign/VUS")
    : e.mutationStatus.toLowerCase() === "somatic" ? "Somatic" : "Unknown";
  return (e.countsByTumorType || []).map((c) => {
    const b = bi.get(c.tumorType), q = qc.get(c.tumorType), s = st.get(c.tumorType);
    const ratio = both ? (b ? b.variantCount : 0) / (q ? q.variantCount : 0) : null;
    return {
      tumorType: c.tumorType, mutationStatus: status, tumorTypeCount: c.tumorTypeCount, variantCount: c.variantCount,
      frequency: c.variantCount / c.tumorTypeCount, biallelicRatio: ratio == null || Number.isNaN(ratio) ? null : ratio,
      biallelicTumorCount: b ? b.variantCount : null, qcPassTumorCount: q ? q.variantCount : null,
      ageAtDx: s?.ageAtDx ?? null, tmb: s?.tmb ?? null, msiScore: s?.msiScore ?? null,
      lst: s?.hrdScore?.lst ?? null, ntelomericAi: s?.hrdScore?.ntelomericAi ?? null, fractionLoh: s?.hrdScore?.fractionLoh ?? null,
    };
  });
}

export const num = (x: number | null, digits?: number) => x == null ? "-" : digits ? x.toFixed(digits) : String(x);
export const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);


type Counts = Record<string, number | null | undefined>;
/** gnomAD's counts for one of exome or genome, as stored (Genome Nexus's myvariant.info record) */
export type GnomadCounts = { alleleCount?: Counts | null; alleleNumber?: Counts | null; homozygotes?: Counts | null; alleleFrequency?: Counts | null };
export type GnomadRow = { population: string; alleleCount: number; alleleNumber: number; homozygotes: number; alleleFrequency: number };

/** gnomAD's populations, in GnomadUtils' order, and the suffix of their keys ("" for the total) */
const GNOMAD_POPULATIONS: [string, string][] = [["African", "afr"], ["Latino", "amr"], ["Other", "oth"], ["European (Non-Finnish)", "nfe"],
  ["European (Finnish)", "fin"], ["Ashkenazi Jewish", "asj"], ["East Asian", "eas"], ["South Asian", "sas"], ["Total", ""]];

/** GnomadUtils.calculateGnomadAlleleFrequency: the stored frequency, else count over number, else 0 */
function gnomadFreq(count: number, total: number, freq: number | null | undefined): number {
  if (freq != null) return freq;
  return count && total ? count / total : 0;
}

/**
 * gnomAD's table by population, as GnomadUtils.getGnomadDataSortedByFrequency builds it: exome or genome
 * alone, or both pooled (counts summed, frequency recomputed); the eight populations by frequency, highest
 * first, then the total. Empty when neither is stored.
 */
export function gnomadRows(g: { exome?: GnomadCounts | null; genome?: GnomadCounts | null } | null | undefined): GnomadRow[] {
  if (!g || (!g.exome && !g.genome)) return [];
  const of = (d: GnomadCounts) => GNOMAD_POPULATIONS.map(([population, k]) => {
    const key = (name: string) => k ? name + "_" + k : name;
    const ac = d.alleleCount?.[key("ac")] || 0, an = d.alleleNumber?.[key("an")] || 0;
    return { population, alleleCount: ac, alleleNumber: an, homozygotes: d.homozygotes?.[key("hom")] || 0, alleleFrequency: gnomadFreq(ac, an, d.alleleFrequency?.[key("af")]) };
  });
  let rows: GnomadRow[];
  if (g.exome && g.genome) {
    const e = of(g.exome), n = of(g.genome);
    rows = e.map((x, i) => {
      const ac = x.alleleCount + n[i].alleleCount, an = x.alleleNumber + n[i].alleleNumber;
      return { population: x.population, alleleCount: ac, alleleNumber: an, homozygotes: x.homozygotes + n[i].homozygotes, alleleFrequency: gnomadFreq(ac, an, null) };
    });
  } else rows = of((g.exome || g.genome)!);
  // lodash sortBy is stable and ascending; reversed, ties come out in reverse population order
  const pops = rows.slice(0, 8).map((r, i) => ({ r, i })).sort((a, b) => a.r.alleleFrequency - b.r.alleleFrequency || a.i - b.i).map((x) => x.r).reverse();
  return [...pops, rows[8]];
}

/** gnomAD's variant page (GnomadUtils.generateGnomadUrl), its home page when a part is missing */
export function gnomadUrl(chromosome: string, vcf: { position?: string; ref?: string; alt?: string } | null | undefined): string {
  return chromosome && vcf?.position && vcf.ref && vcf.alt
    ? "https://gnomad.broadinstitute.org/variant/" + chromosome + "-" + vcf.position + "-" + vcf.ref + "-" + vcf.alt : "https://gnomad.broadinstitute.org/";
}

/** a gnomAD frequency as GnomadFrequency shows it: two significant digits, kept ("0.50"); 0 as "0" */
export const gnomadText = (af: number) => af === 0 ? "0" : af.toLocaleString("en-US", { maximumSignificantDigits: 2, minimumSignificantDigits: 2 });

/** dbSNP's page for an id */
export const dbsnpUrl = (rsid: string) => "https://www.ncbi.nlm.nih.gov/snp/" + rsid;

/** One predictor's call on the canonical transcript, for the Functional Impact column. */
export type Prediction = { prediction: string | null; score: number | null };
/** MutationAssessor's call, with its multiple sequence alignment */
export type MaPrediction = Prediction & { msa: string | null };

/**
 * The colour class of a prediction (functionalImpact.scss): high/medium/low/neutral for MutationAssessor;
 * SIFT, PolyPhen-2 and AlphaMissense on red/yellow/gray. Null: not drawn.
 */
export function impactLevel(tool: "ma" | "sift" | "polyphen" | "alphaMissense", prediction: string | null): "high" | "medium" | "low" | "neutral" | null {
  if (!prediction) return null;
  const p = prediction.toLowerCase();
  const by: Record<string, Record<string, "high" | "medium" | "low" | "neutral">> = {
    ma: { high: "high", medium: "medium", low: "low", neutral: "neutral" },
    sift: { deleterious: "high", deleterious_low_confidence: "low", tolerated_low_confidence: "neutral", tolerated: "neutral" },
    polyphen: { probably_damaging: "high", possibly_damaging: "low", benign: "neutral" },
    alphaMissense: { pathogenic: "high", ambiguous: "low", benign: "neutral" },
  };
  return by[tool][p] ?? null;
}

/** MutationAssessor's alignment file, and the viewer that opens it (MutationAssessor.tsx) */
export function msaUrls(msa: string): { view: string; download: string } {
  const file = "https://genome-nexus-static-data.s3.us-east-1.amazonaws.com/mutationassessor-v4-multiple-sequence-alignment-files-uncompressed/" + msa + ".fa";
  return { view: "https://projects.sanderlab.org/av/?url=" + file, download: file };
}

/**
 * The Protein Change cell as the portal draws it (ProteinChangeColumnFormatter renderWithMutationStatus):
 * the change cut by TruncatedText at 40 characters, the whole text its tooltip, and a "Germline" tag
 * when the call's status reads as germline (isGermlineMutationStatus, /germline/i).
 */
export function proteinChangeCell(change: string | null | undefined, status: string | null | undefined): { shown: string; full: string; germline: boolean } {
  const full = change ?? "";
  return { shown: truncate(full, 40), full, germline: /germline/i.test(status ?? "") };
}

/**
 * The MS (Mutation Status) cell as the portal draws it (MutationStatusColumnFormatter renderFunction):
 * "S" for a status containing "somatic", else "G" for one containing "germline" (either case), each on
 * its badge with the stored value as tooltip; any other value as written, small and grey; none blank.
 */
export function mutationStatusCell(raw: string | null | undefined): { kind: "somatic" | "germline" | "other" | "none"; text: string; tip: string | null } {
  const v = raw ?? "";
  if (!v) return { kind: "none", text: "", tip: null };
  const low = v.toLowerCase();
  if (low.includes("somatic")) return { kind: "somatic", text: "S", tip: v };
  if (low.includes("germline")) return { kind: "germline", text: "G", tip: v };
  return { kind: "other", text: v, tip: null };
}

/**
 * The tooltip of an Allele Freq (T) cell with no frequency (none, 0, or a count missing): the portal's
 * TableCellStatusIndicator NA, which has no text, only this tip (TumorAlleleFreqColumnFormatter
 * renderFunction); null for a cell that has a frequency.
 */
export function vafEmptyTip(value: unknown): string | null {
  return value == null || value === "" ? "Data not available." : null;
}

/** what the mutation table counts its rows as, in its title and pager: the portal's "N Mutations", "1 Mutation" (MUT-TB-1) */
export function mutationUnit(n: number): string {
  return n === 1 ? "Mutation" : "Mutations";
}

/** the tip of a clinical attribute's cell with no value (ClinicalAttributeColumnFormatter's LazyLoadedTableCell naAlt) */
export const CLINICAL_NA_TIP = "Clinical attribute not available for this sample.";

/**
 * A clinical attribute's cell (MUT-COL-36), as the portal's TruncatedText draws it (maxLength 30, the default
 * buffer 2): a value longer than 32 characters cut to its first 30 and "...", the whole value as its tip; no value
 * is an empty cell whose tip says the attribute is not available. A number is written as the value it holds.
 */
export function clinicalCellText(value: unknown): { text: string; tip: string | null } {
  if (value == null || value === "") return { text: "", tip: CLINICAL_NA_TIP };
  const text = String(value);
  return text.length > 32 ? { text: text.substring(0, 30) + "...", tip: text } : { text, tip: null };
}
