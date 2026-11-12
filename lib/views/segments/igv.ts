// The segments result as igv.js reads it (the card body, app/lab/segments-igv.tsx): its seg features and where to start.
import type { SegmentsResult } from "./types.ts";

/** where IGV starts: the view's region (a gene's span with its flank, a chromosome or a stretch), else the whole genome */
export function igvLocus(s: Pick<SegmentsResult, "region">): string {
  const r = s.region;
  return r.chrom == null ? "all" : "chr" + r.chrom + ":" + r.start + "-" + r.end;
}

/**
 * The result's segments as igv.js seg features (0-based start, as a .seg file is read), in the
 * result's row order: IGV draws samples in the order they first appear, one row per distinct name.
 * One patient's samples carry their number, as the patient's other views name them; with several
 * studies each name carries its study, so two studies' samples with the same id stay two rows.
 */
export function igvSegFeatures(s: Pick<SegmentsResult, "samples" | "segChroms">) {
  const out: { chr: string; start: number; end: number; value: number; sample: string }[] = [];
  const several = new Set(s.samples.map((x) => x.study)).size > 1;
  for (const smp of s.samples) {
    const id = several ? smp.study + ":" + smp.sample : smp.sample;
    const name = smp.mark ? smp.mark.label + ". " + id : id;
    for (let k = 0; k < smp.segs.length; k += 4)
      out.push({ chr: "chr" + s.segChroms[smp.segs[k]], start: smp.segs[k + 1] - 1, end: smp.segs[k + 2], value: smp.segs[k + 3], sample: name });
  }
  return out;
}

// ---- the patient page's genomic overview, as cbioportal-frontend's GenomicOverview draws it --------
// (patientView/genomicOverview/GenomicOverview.tsx, GenomicOverviewUtils.ts, CnaTrackSampleSummary.tsx,
// shared/lib/IGVUtils.ts): each rule below copies the one cited.

/** IGV_TRACK_SAMPLE_EXPAND_HEIGHT: one sample's row on the overview's tracks */
export const OVERVIEW_ROW = 18;
export const MUT_TRACK = "MUT";
export const CNA_TRACK = "CNA";

/** calcIgvTrackHeight(features, 600, 25, 18): the track's height for its samples */
export const overviewTrackHeight = (samples: number): number => Math.max(Math.min(600, samples * OVERVIEW_ROW), 25);

/** IGVUtils getLocation: "chr17:7,577,094-7,577,094" */
const location = (chrom: string, start: number, end: number) =>
  "chr" + chrom + ":" + start.toLocaleString("en-US") + "-" + end.toLocaleString("en-US");

type PopupRow = { name: string; value: string | number };

/** generateSegmentFeatures + segmentPopupData: the CNA track's features, one sample's in a run, the samples in row order */
export function overviewSegFeatures(s: Pick<SegmentsResult, "samples" | "segChroms">) {
  const out: { chr: string; start: number; end: number; value: number; sample: string; popupData: () => PopupRow[] }[] = [];
  for (const smp of s.samples)
    for (let k = 0; k < smp.segs.length; k += 4) {
      const chrom = s.segChroms[smp.segs[k]], st = smp.segs[k + 1], en = smp.segs[k + 2], m = smp.segs[k + 3];
      out.push({ chr: "chr" + chrom, start: st - 1, end: en, value: m, sample: smp.sample,
        popupData: () => [{ name: "Sample", value: smp.sample }, { name: "Mean CN log2 value", value: m }, { name: "Location", value: location(chrom, st, en) }] });
    }
  return out;
}

/**
 * generateMutationFeatures + mutationPopupData: the MUT track's features, each coloured as
 * getColorForProteinImpactType([mutation]) colours one mutation (lollipopColor, every mutation a driver).
 */
export function overviewMutFeatures(s: Pick<SegmentsResult, "samples" | "mutations">, colorOf: (mtype: string) => string) {
  return (s.mutations || []).map((m) => {
    const sample = s.samples[m.s].sample;
    return { chr: "chr" + m.chrom, start: m.start - 1, end: m.end, sample, value: m.type, color: colorOf(m.type),
      popupData: () => [{ name: "Sample", value: sample }, { name: "Gene", value: m.gene }, { name: "Protein Change", value: m.change },
        { name: "Location", value: location(m.chrom, m.start, m.end) }] };
  });
}

/** the samples a track draws, in row order: those with segments (CNA) or with mutations (MUT) — getSampleIds over the sorted features */
export function trackSamples(s: Pick<SegmentsResult, "samples" | "mutations">, track: "mut" | "cna"): string[] {
  if (track === "cna") return s.samples.filter((x) => x.segs.length).map((x) => x.sample);
  const has = new Set((s.mutations || []).map((m) => m.s));
  return s.samples.filter((_, i) => has.has(i)).map((x) => x.sample);
}

/** CnaTrackSampleSummary.calcAlterationPercentage: the share of the measured genome in segments ≥ 50 kb with |mean| ≥ 0.2, in percent; null when nothing is measured */
export function cnaAlteredPct(segs: number[]): number | null {
  let measured = 0, altered = 0;
  for (let k = 0; k < segs.length; k += 4) {
    const diff = segs[k + 2] - segs[k + 1];
    measured += diff;
    if (diff >= 50000 && Math.abs(segs[k + 3]) >= 0.2) altered += diff;
  }
  return measured === 0 ? null : 100 * altered / measured;
}

export interface PanelIcon { label: string; color: string; panel: string | null }
/**
 * GenePanelIdSpecialValue: a sample with one of these (or none) was sequenced whole-exome or
 * whole-genome. The warehouse writes 'WES' where the portal's API gives no panel, so both get the
 * portal's "no panel" badge.
 */
const WHOLE = new Set(["WES", "WGS"]);
const WHOLE_ICON: PanelIcon = { label: "W", color: "#007fff", panel: null };

/**
 * genePanelIdToIconData + sampleIdToIconData: each track's gene-panel badge per sample — "P1",
 * "P2" … (blue) for the study's panels in name order, "W" for whole exome/genome; a track whose
 * samples are all whole exome/genome has none. `show` is whether the column is drawn at all.
 */
export function panelIcons(samples: Pick<SegmentsResult["samples"][number], "sample" | "panels">[]):
  { mut: Map<string, PanelIcon>; cna: Map<string, PanelIcon>; show: boolean } {
  const ids = [...new Set(samples.flatMap((x) => [x.panels?.mutation, x.panels?.cna]).filter((p): p is string => !!p && !WHOLE.has(p)))].sort();
  const lookup = new Map<string, PanelIcon>(ids.map((p, i) => [p, { label: "P" + (i + 1), color: "blue", panel: p }]));
  const per = (key: "mutation" | "cna") => {
    const out = new Map<string, PanelIcon>();
    if (samples.every((x) => !x.panels?.[key] || WHOLE.has(x.panels[key]!))) return out;
    for (const x of samples) { const p = x.panels?.[key]; out.set(x.sample, (p && lookup.get(p)) || WHOLE_ICON); }
    return out;
  };
  const mut = per("mutation"), cna = per("cna");
  return { mut, cna, show: mut.size > 0 || cna.size > 0 };
}
