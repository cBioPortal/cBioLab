// How the mutation table spells its Genome Nexus cells, as cBioPortal's mutation table does
// (react-mutation-mapper's Hgvsg, ClinvarInterpretation and Signal columns; cbioportal-utils'
// SignalMutationUtils and FormatUtils). The cells (app/lab/mutation-cells.tsx) draw these.

/** the Genome Nexus variant page HGVSg links to: the GRCh38 service's for a study on hg38 */
export function hgvsgUrl(hgvsg: string, grch38: boolean): string {
  return (grch38 ? "https://grch38.genomenexus.org" : "https://www.genomenexus.org") + "/variant/" + encodeURIComponent(hgvsg);
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

/** FormatUtils.formatPercentValue on a fraction: one decimal, "< 0.1" when it rounds to 0, "-" when missing */
export function percent(f: number | null): string {
  if (f == null || Number.isNaN(f)) return "-";
  const fixed = (f * 100).toFixed(1);
  return f !== 0 && Number(fixed) === 0 ? "< 0.1" : fixed;
}
/** FormatUtils.formatNumberValueInSignificantDigits(x, 2), as text: 0 is "0" */
export const twoDigits = (x: number) => x === 0 ? "0" : String(Number(x.toLocaleString("en-US", { maximumSignificantDigits: 2 }).replace(/,/g, "")));
export const num = (x: number | null, digits?: number) => x == null ? "-" : digits ? x.toFixed(digits) : String(x);
export const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

