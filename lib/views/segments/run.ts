// Segments view: the cohort's samples as copy-number segment tracks — cBioPortal's CN Segments tab
// (and the patient view's genomic overview), drawn in the browser by igv.js.
import type { ViewResult } from "../../types.ts";
import { hasPatientTimeline, hasViewAggregates, isPatientLevel, type PatientLevelCapable, type ViewAggregateCapable } from "../../federation.ts";
import { studyGenomeSql, CHROM_LENGTHS } from "../../federation-views.ts";
import { geneLocus } from "../../gene-loci.ts";
import { sampleMarks } from "../../timeline-tracks.ts";
import type { ViewRun } from "../run.ts";
import { plural, refuse } from "../shared.ts";
import { segmentSamplesRows, segmentRows, overviewMutationRows, overviewPanelRows, SEGMENT_CHROMS, type SegmentRegion } from "./sql.ts";
import type { SegmentsView, SegmentsResult, SegmentsSample, SegmentsMutation } from "./types.ts";
import { segmentsMethod } from "./method.ts";

/** rows drawn when the view names none, and the most it may name */
export const SEGMENTS_ROWS_DEFAULT = 300;
export const SEGMENTS_ROWS_MAX = 2000;
/** segments one result carries at most (the drawn samples' whole genomes): past it the view is refused, naming the limit */
export const SEGMENTS_MAX = 250000;
/** mutations one overview carries at most: past it the view is refused, naming the limit */
export const OVERVIEW_MUTATIONS_MAX = 50000;
/** IGV's flank either side of a gene it zooms to (igv.js `flanking`) */
export const GENE_FLANK = 1000;
const AXIS = SEGMENT_CHROMS;

type Holder = PatientLevelCapable & ViewAggregateCapable;

/** "17", "chrX", "chr17:37,000,000-38,000,000" (1-based, inclusive) as a chromosome and a stretch of it, or an error */
export function parseRegion(text: string, build: "hg19" | "hg38"): { chrom: string; start: number; end: number; whole: boolean } | string {
  const m = /^\s*(?:chr)?([0-9]{1,2}|x|y)(?:\s*:\s*([\d,]+)\s*-\s*([\d,]+))?\s*$/i.exec(String(text));
  const chrom = m ? m[1].toUpperCase() : "";
  if (!m || !AXIS.includes(chrom)) return "region is a chromosome (1-22, X, Y: \"17\", \"chrX\") or a stretch of one (\"chr17:37,000,000-38,000,000\"); got " + JSON.stringify(String(text).slice(0, 40));
  const len = CHROM_LENGTHS[build][chrom];
  if (!m[2]) return { chrom, start: 1, end: len, whole: true };
  const start = Number(m[2].replace(/,/g, "")), end = Number(m[3].replace(/,/g, ""));
  if (!(start >= 1 && end > start)) return "region's stretch runs from a position of 1 or more to a larger one; got " + start + "-" + end;
  if (start > len) return "chromosome " + chrom + " is " + len.toLocaleString("en-US") + " bases long on " + build + "; the region starts past its end";
  return { chrom, start, end: Math.min(end, len), whole: false };
}

export async function runSegments(view: SegmentsView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  const no = (msg: string) => refuse("segments", ctx, msg);
  if (vNames.length !== 1) return no("a segments view draws one cohort's samples; this one names " + vNames.length + " — name one in cohorts");
  if (view.gene != null && (typeof view.gene !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,40}$/.test(view.gene))) return no("gene is a gene symbol, e.g. \"ERBB2\"");
  if (view.gene != null && view.region != null) return no("name gene or region, not both: gene zooms to the gene's span, region to a chromosome or a stretch of one");
  if (view.region != null && typeof view.region !== "string") return no("region is text: a chromosome (\"17\") or a stretch of one (\"chr17:37,000,000-38,000,000\")");
  const rows = view.rows == null ? SEGMENTS_ROWS_DEFAULT : Number(view.rows);
  if (!(Number.isInteger(rows) && rows >= 1 && rows <= SEGMENTS_ROWS_MAX)) return no("rows (sample rows drawn at most) is 1 to " + SEGMENTS_ROWS_MAX + "; got " + String(view.rows).slice(0, 20));
  const sort = view.sort ?? "order";
  if (sort !== "order" && sort !== "gained" && sort !== "lost") return no("sort is \"order\" (the study's sample order, the default), \"gained\" or \"lost\" (by the mean over the region drawn)");
  if (view.overview != null && typeof view.overview !== "boolean") return no("overview is true (the patient page's genomic overview: mutations and gene panels too) or false");
  const overview = view.overview === true;
  const name = vNames[0], def = doc.cohorts[name];

  // who may draw sample rows: a local patient-level participant (need: "patients" refuses the rest before this runs)
  const holders: Record<string, Holder> = {};
  const excluded: { study: string; reason: string }[] = [];
  for (const st of cohorts[name].studies) {
    const r = ctx.resolvers[st];
    if (isPatientLevel(r) && hasViewAggregates(r)) holders[st] = r as Holder;
    else excluded.push({ study: st, reason: "does not disclose samples" });
  }
  const studies = Object.keys(holders);
  if (!studies.length) return no("no study here may draw a sample's segments (" + excluded.map((e) => e.study + ": " + e.reason).join("; ") + ")");

  // one reference genome: positions on hg19 and hg38 are not the same places
  const builds: Record<string, string> = {};
  await Promise.all(studies.map(async (st) => { builds[st] = String((await holders[st].viewMeta("genome:build", studyGenomeSql))[0]?.build || "unknown"); }));
  const distinct = [...new Set(Object.values(builds))];
  if (distinct.some((b) => b !== "hg19" && b !== "hg38"))
    return no("no chromosome lengths for reference genome " + studies.filter((st) => builds[st] !== "hg19" && builds[st] !== "hg38").map((st) => st + " (" + builds[st] + ")").join(", "));
  if (distinct.length > 1)
    return no("these studies are on different reference genomes, so their segments are not drawn on one axis: " + studies.map((st) => st + " " + builds[st]).join(", ") + " — draw each build in its own view");
  const build = distinct[0] as "hg19" | "hg38";

  // where to draw
  let region: SegmentsResult["region"];
  if (view.gene) {
    const g = geneLocus(view.gene, build);
    if (!g) return no(view.gene + " has no RefSeq mRNA on " + build + " in IGV's refGene annotation, so there is no span to zoom to — name a region instead (\"chr17:37,000,000-38,000,000\")");
    const len = CHROM_LENGTHS[build][g.chrom];
    region = { label: g.gene + " (chr" + g.chrom + ":" + fmtBp(g.start + 1) + "-" + fmtBp(g.end) + ")", chrom: g.chrom,
      start: Math.max(1, g.start + 1 - GENE_FLANK), end: Math.min(len, g.end + GENE_FLANK), gene: { name: g.gene, start: g.start + 1, end: g.end } };
  } else if (view.region) {
    const r = parseRegion(view.region, build);
    if (typeof r === "string") return no(r);
    region = { label: r.whole ? "chromosome " + r.chrom : "chr" + r.chrom + ":" + fmtBp(r.start) + "-" + fmtBp(r.end), chrom: r.chrom, start: r.start, end: r.end };
  } else region = { label: "whole genome", chrom: null, start: 1, end: 0 };
  const axis = region.chrom ? [region.chrom] : AXIS;
  const where: SegmentRegion = { axis, ...(region.chrom ? { range: { chrom: region.chrom, start: region.start, end: region.end } } : {}) };
  const chroms = axis.map((c) => ({ c, length: CHROM_LENGTHS[build][c] }));

  // each study's samples with segments, in the view's order, cut to the row limit
  type Row = { study: string; sid: number; sample: string; patient: string; stype: string; segs: number; allSegs: number; score: number | null };
  const perStudy = await Promise.all(studies.map(async (st) => {
    const got = await holders[st].viewRows("segments:samples:" + name, def, (c, s, d) => segmentSamplesRows(c, s, d, { ...where, sort, limit: rows }));
    return { st, got };
  }));
  let segmented = 0, otherChrom = 0;
  const all: Row[] = [];
  for (const { st, got } of perStudy) {
    const n = Number(got[0]?.segmented || 0);
    segmented += n; otherChrom += Number(got[0]?.otherChrom || 0);
    if (!n && (cohorts[name].perStudy[st]?.samples || 0) > 0) excluded.push({ study: st, reason: "no copy-number segments for its samples in this cohort" });
    for (const x of got) all.push({ study: st, sid: Number(x.sid), sample: String(x.sample), patient: String(x.patient), stype: String(x.stype ?? ""),
      segs: Number(x.segs), allSegs: Number(x.allSegs ?? x.segs), score: x.score == null ? null : Number(x.score) });
  }
  const cohortSamples = studies.reduce((n, st) => n + (cohorts[name].perStudy[st]?.samples || 0), 0);

  // the overview: the samples' mutations and gene panels; a sample with mutations but no segments gets a row too
  type MutRow = Omit<SegmentsMutation, "s"> & { study: string; sample: string };
  const muts: MutRow[] = [];
  const panels = new Map<string, NonNullable<SegmentsSample["panels"]>>();
  if (overview) {
    const got = await Promise.all(studies.map(async (st) => {
      const [m, p] = await Promise.all([
        holders[st].viewRows("segments:mutations:" + name, def, overviewMutationRows),
        holders[st].viewRows("segments:panels:" + name, def, overviewPanelRows)]);
      return { st, m, p };
    }));
    const have = new Set(all.map((r) => r.study + "\u0000" + r.sid));
    for (const { st, m, p } of got) {
      for (const x of m) {
        const sid = Number(x.sid), k = st + "\u0000" + sid;
        if (!have.has(k)) { have.add(k); all.push({ study: st, sid, sample: String(x.sample), patient: String(x.patient), stype: String(x.stype ?? ""), segs: 0, allSegs: 0, score: null }); }
        muts.push({ study: st, sample: String(x.sample), chrom: String(x.chrom), start: Number(x.st), end: Number(x.en), gene: String(x.gene ?? ""), change: String(x.change ?? ""), type: String(x.mtype ?? "") });
      }
      for (const x of p) {
        const k = st + "\u0000" + String(x.sample), cur = panels.get(k) || {};
        if (x.type === "MUTATION_EXTENDED") cur.mutation = String(x.panel); else cur.cna = String(x.panel);
        panels.set(k, cur);
      }
    }
    // a study whose samples have mutations is drawn, segments or not
    const drawnStudies = new Set(got.filter((g) => g.m.length).map((g) => g.st));
    for (let i = excluded.length - 1; i >= 0; i--) if (drawnStudies.has(excluded[i].study) && /no copy-number segments/.test(excluded[i].reason)) excluded.splice(i, 1);
    if (muts.length > OVERVIEW_MUTATIONS_MAX)
      return no("this overview carries " + muts.length.toLocaleString("en-US") + " mutations, past the " + OVERVIEW_MUTATIONS_MAX.toLocaleString("en-US") + " one view carries");
    if (sort === "order") all.sort((a, b) => studies.indexOf(a.study) - studies.indexOf(b.study) || a.sid - b.sid);
  }
  if (!segmented && !muts.length) return no("no sample of this cohort has copy-number segments" + (overview ? " or mutations" : "") +
    (excluded.length ? " (" + excluded.map((e) => e.study + ": " + e.reason).join("; ") + ")" : "") +
    (overview ? " — the portal leaves out its genomic overview for such a patient" : " — the portal hides its CN Segments tab for such a query"));
  // across studies: the studies in the view's order (each in its own order), or by the score
  const dir = sort === "lost" ? 1 : -1;
  if (sort !== "order") all.sort((a, b) => (a.score == null ? 1 : 0) - (b.score == null ? 1 : 0) || (a.score != null && b.score != null ? dir * (a.score - b.score) : 0) ||
    studies.indexOf(a.study) - studies.indexOf(b.study) || a.sid - b.sid);
  let drawn = all.slice(0, rows);
  // past the drawing limit: refused, naming it, rather than drawn in part
  const segTotal = drawn.reduce((n, r) => n + r.allSegs, 0);
  if (segTotal > SEGMENTS_MAX)
    return no("this draws " + segTotal.toLocaleString("en-US") + " segments, past the " + SEGMENTS_MAX.toLocaleString("en-US") +
      " one view carries — lower rows (now " + rows + ")");

  // one patient's samples: numbered in collection order, as the patient's other views number them
  const marks = new Map<string, { label: string; color: string }>();
  const onePatient = drawn.length > 0 && drawn.every((r) => r.study === drawn[0].study && r.patient === drawn[0].patient) ? drawn[0] : null;
  if (onePatient) {
    const r = holders[onePatient.study];
    const tl = hasPatientTimeline(r) ? await r.patientTimeline(onePatient.patient) : null;
    const m = sampleMarks(tl ? tl.samples : drawn.map((x) => ({ id: x.sample, type: x.stype })), tl ? tl.events : []);
    for (const [id, mk] of m) marks.set(id, { label: mk.label, color: mk.color });
    if (sort === "order") {
      const at = [...m.keys()];
      drawn = [...drawn].sort((a, b) => (at.indexOf(a.sample) + 1 || Infinity) - (at.indexOf(b.sample) + 1 || Infinity) || a.sid - b.sid);
    }
  }

  // the drawn samples' segments over the whole genome, so the browser can zoom and pan anywhere
  const segsOf = new Map<string, number[]>();
  await Promise.all(studies.map(async (st) => {
    const sids = drawn.filter((r) => r.study === st).map((r) => r.sid);
    if (!sids.length) return;
    const got = await holders[st].viewRows("segments:segments:" + name, def, (c, s, d) => segmentRows(c, s, d, { axis: SEGMENT_CHROMS }, sids));
    for (const x of got) {
      const k = st + "\u0000" + String(x.sid), list = segsOf.get(k) || [];
      list.push(Number(x.c), Number(x.st), Number(x.en), Math.round(Number(x.m) * 10000) / 10000);
      segsOf.set(k, list);
    }
  }));
  const samples: SegmentsSample[] = drawn.map((r) => ({ study: r.study, patient: r.patient, sample: r.sample,
    score: r.score == null ? null : Math.round(r.score * 10000) / 10000,
    ...(marks.has(r.sample) ? { mark: marks.get(r.sample)! } : {}), segs: segsOf.get(r.study + "\u0000" + r.sid) || [],
    ...(overview ? { panels: panels.get(r.study + "\u0000" + r.sample) || {} } : {}) }));
  // the overview's mutations of the drawn samples, in row order
  const rowOf = new Map(samples.map((x, i) => [x.study + "\u0000" + x.sample, i]));
  const mutations: SegmentsMutation[] | undefined = overview ? muts.flatMap(({ study, sample, ...m }) => {
    const s = rowOf.get(study + "\u0000" + sample);
    return s == null ? [] : [{ s, ...m }];
  }).sort((a, b) => a.s - b.s) : undefined;
  const leftOut = segmented - samples.length;
  const drawnNoSeg = drawn.filter((r) => !r.segs).length;
  const multi = studies.length > 1;
  const result: SegmentsResult = { build, region, chroms, segChroms: SEGMENT_CHROMS, sort, samples, cohortSamples, segmented, rowsLimit: rows, leftOut, noSegment: drawnNoSeg, otherChrom,
    ...(mutations ? { mutations } : {}),
    ...(excluded.length ? { excluded } : {}) };
  const order = sort === "gained" ? "highest mean over the region first" : sort === "lost" ? "lowest mean over the region first"
    : onePatient ? "the patient's samples in collection order (the numbers the patient's other views give them)" : "each study's own sample order, as the portal lists them";
  return {
    kind: "segments", cohorts: vNames, segments: result,
    method: segmentsMethod({ build, region: region.label, sort, order, rows, cohortSamples, segmented, drawn: samples.length, leftOut, segments: segTotal, noSegment: drawnNoSeg, otherChrom, studies,
      ...(mutations ? { mutations: mutations.length } : {}) }),
    participation: ctx.participationFor(ctx.vStudies, true),
    ...(multi ? { studies } : {}),
    caveat: "One row per sample, coloured by each segment's mean log2 copy-number ratio (" + build + ", " + region.label + "): white within ±0.1, " +
      "deepening to red at +1.5 and blue at −1.5 and beyond (IGV's segment scale, as the portal draws it); grey where no segment of the sample reaches. " +
      (leftOut > 0 ? "ROW LIMIT: " + samples.length.toLocaleString("en-US") + " of " + plural(segmented, "sample") + " with segments are drawn; " +
        leftOut.toLocaleString("en-US") + " are left out (rows: " + rows + ", at most " + SEGMENTS_ROWS_MAX + "). "
        : "All " + plural(segmented, "sample") + " with segments are drawn. ") +
      (cohortSamples > segmented ? (cohortSamples - segmented).toLocaleString("en-US") + " of the cohort's " + plural(cohortSamples, "sample") + " have no segments at all and have no row. " : "") +
      "Rows: " + order + ". " +
      (drawnNoSeg ? plural(drawnNoSeg, "drawn sample") + " " + (drawnNoSeg === 1 ? "has" : "have") + " no segment in this region (a grey row: not measured here, not copy-neutral). " : "") +
      (region.gene ? "Zoomed to " + region.gene.name + "'s span in IGV's refGene annotation, " + GENE_FLANK.toLocaleString("en-US") + " bases either side, as the portal's IGV zooms to a gene. " : "") +
      (otherChrom ? plural(otherChrom, "segment") + " on chromosomes other than 1–22, X and Y are not drawn. " : "") +
      "Log ratios are not purity- or ploidy-corrected" + (!region.chrom || region.chrom === "X" ? ", and chromosome X reads low in male samples against a female reference." : ".") +
      (multi ? " Samples of " + studies.length + " studies; overlap is not deduplicated." : "") +
      (excluded.length ? " Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "") +
      (mutations ? " Above the segments, each sample's " + plural(mutations.length, "called mutation") + ", coloured by protein impact as the portal colours them." : ""),
  };
}

const fmtBp = (n: number) => n.toLocaleString("en-US");
