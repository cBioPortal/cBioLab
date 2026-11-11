// Structural variants, copy-number segments, timelines and the gene panel matrix
// (notes/legacy-java-importer.md §V, §S, §P).
import path from "node:path";
import { ImportContext, skip, sampleId, isNormalBarcode } from "./context.ts";
import { openTable, type DataFile } from "./study.ts";

const SV_INT = ["site1_region_number", "site1_position", "site2_region_number", "site2_position", "normal_read_count", "tumor_read_count",
  "normal_variant_count", "tumor_variant_count", "normal_paired_end_read_count", "tumor_paired_end_read_count",
  "normal_split_read_count", "tumor_split_read_count", "length"];
const SV_TEXT = ["site1_ensembl_transcript_id", "site1_chromosome", "site1_region", "site1_contig", "site1_description",
  "site2_ensembl_transcript_id", "site2_chromosome", "site2_region", "site2_contig", "site2_description", "site2_effect_on_frame",
  "ncbi_build", "dna_support", "rna_support", "annotation", "breakpoint_type", "connection_type", "event_info", "class", "comments"];

/** Rows without SV_Status, or where neither site's gene resolves, are not stored (legacy V1, V3). */
export async function importStructuralVariants(ctx: ImportContext, f: DataFile, profile: number): Promise<void> {
  const r = ctx.report(path.basename(f.file), "structural variants");
  const t = await openTable(f.file);
  const h = new Map(t.header.map((x, i) => [x.toLowerCase(), i]));
  const at = (row: string[], k: string) => { const i = h.get(k); return i === undefined ? "" : (row[i] ?? "").trim(); };
  const ins = ctx.sink("structural_variant"), dIns = ctx.sink("alteration_driver_annotation");
  const seen = new Set<string>();
  const site = (row: string[], n: 1 | 2) => {
    const e = at(row, "site" + n + "_entrez_gene_id"), hugo = at(row, "site" + n + "_hugo_symbol");
    const byEntrez = /^\d+$/.test(e) ? ctx.genes.entrez(Number(e)) : null;
    return byEntrez ?? (hugo && hugo.toUpperCase() !== "NA" ? ctx.genes.nonAmbiguous(hugo) : null);
  };
  for await (const row of t.rows) {
    r.read++;
    const status = at(row, "sv_status");
    if (!status || status.toUpperCase() === "NA") { skip(r, "no SV_Status"); continue; }
    const raw = at(row, "sample_id");
    if (!raw || isNormalBarcode(raw)) { skip(r, "no sample or normal sample"); continue; }
    const g1 = site(row, 1), g2 = site(row, 2);
    if (!g1 && !g2) { skip(r, "neither gene recognised"); continue; }
    const sample = ctx.sampleFor(sampleId(raw));
    const key = [sample, g1?.entrez, at(row, "site1_chromosome"), at(row, "site1_position"), at(row, "site1_region_number"), at(row, "site1_ensembl_transcript_id"),
      g2?.entrez, at(row, "site2_chromosome"), at(row, "site2_position"), at(row, "site2_region_number"), at(row, "site2_ensembl_transcript_id"), at(row, "event_info")].join("|");
    if (seen.has(key)) { skip(r, "duplicate row"); continue; }
    seen.add(key);
    const id = ctx.id("sv");
    const out: Record<string, string | number | null> = {
      internal_id: id, genetic_profile_id: profile, sample_id: sample,
      site1_entrez_gene_id: g1?.entrez ?? null, site2_entrez_gene_id: g2?.entrez ?? null, sv_status: status, annotation_json: null
    };
    for (const k of SV_INT) { const v = at(row, k); out[k] = /^-?\d+(\.\d+)?$/.test(v) ? Math.trunc(Number(v)) : -1; }
    for (const k of SV_TEXT) out[k] = at(row, k) || "NA";
    await ins.add(out);
    const driver = at(row, "cbp_driver"), tiers = at(row, "cbp_driver_tiers");
    if ((driver && driver.toLowerCase() !== "na") || (tiers && tiers.toLowerCase() !== "na"))
      await dIns.add({ alteration_event_id: id, genetic_profile_id: profile, sample_id: sample, driver_filter: driver, driver_filter_annotation: at(row, "cbp_driver_annotation"),
        driver_tiers_filter: tiers, driver_tiers_filter_annotation: at(row, "cbp_driver_tiers_annotation") });
    ctx.profiled(sample, profile, null);
    r.stored++;
  }
  await ins.flush(); await dIns.flush();
}

/** sample internal id → [altered length, total length], for FRACTION_GENOME_ALTERED */
export type SegmentTotals = Map<number, [number, number]>;

export async function importSegments(ctx: ImportContext, f: DataFile, totals: SegmentTotals): Promise<void> {
  const r = ctx.report(path.basename(f.file), "copy-number segments");
  const t = await openTable(f.file);
  await ctx.insertAll("copy_number_seg_file", [{ seg_file_id: ctx.id("segFile"), cancer_study_id: ctx.cancerStudyId,
    reference_genome_id: f.meta.reference_genome_id || "hg19", description: f.meta.description || "", filename: path.basename(f.file) }]);
  const ins = ctx.sink("copy_number_seg");
  for await (const row of t.rows) {
    r.read++;
    const [raw, chrom, s, e, probes, mean] = row.map((x) => (x ?? "").trim());
    if (!raw || isNormalBarcode(raw)) { skip(r, "no sample or normal sample"); continue; }
    const c = chrom.toUpperCase();
    if (!(c === "X" || c === "Y" || (/^\d+$/.test(c) && Number(c) <= 24))) { skip(r, "unsupported chromosome " + chrom); continue; }
    const start = Math.trunc(Number(s)), end = Math.trunc(Number(e)), m = Number(mean);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(m)) { skip(r, "unreadable number"); continue; }
    if (start >= end) { skip(r, "start not before end"); continue; }
    const sample = ctx.sampleFor(sampleId(raw));
    await ins.add({ seg_id: ctx.id("seg"), cancer_study_id: ctx.cancerStudyId, sample_id: sample, chr: chrom, start, end,
      num_probes: Math.trunc(Number(probes)) || 0, segment_mean: m });
    const tot = totals.get(sample) ?? [0, 0];
    tot[1] += end - start;
    if (Math.abs(m) >= 0.2) tot[0] += end - start;
    totals.set(sample, tot);
    r.stored++;
  }
  await ins.flush();
}

/** FGA as the legacy calculator writes it: altered ÷ total length, 4 decimals, half-up. */
export function fractionGenomeAltered(altered: number, total: number): string {
  const x = Math.round((altered / total) * 1e4 + 1e-9) / 1e4;
  return x.toFixed(4);
}

export async function importTimeline(ctx: ImportContext, f: DataFile): Promise<void> {
  const r = ctx.report(path.basename(f.file), "timeline");
  const t = await openTable(f.file);
  const up = t.header.map((x) => x.toUpperCase());
  const iP = up.indexOf("PATIENT_ID"), iS = up.indexOf("START_DATE"), iE = up.indexOf("STOP_DATE"), iT = up.indexOf("EVENT_TYPE");
  if (iP < 0 || iS < 0 || iT < 0) throw new Error(path.basename(f.file) + " needs PATIENT_ID, START_DATE and EVENT_TYPE columns");
  const ev = ctx.sink("clinical_event"), data = ctx.sink("clinical_event_data");
  for await (const row of t.rows) {
    r.read++;
    const pid = (row[iP] ?? "").trim();
    const start = Number((row[iS] ?? "").trim());
    if (!pid || !Number.isFinite(start) || !(row[iS] ?? "").trim()) { skip(r, "no patient or start date"); continue; }
    if (!ctx.patients.has(pid)) { skip(r, "patient not in the clinical files"); continue; }
    const stopText = iE >= 0 ? (row[iE] ?? "").trim() : "";
    const id = ctx.id("clinicalEvent");
    if ((row[iT] ?? "").trim().toUpperCase() === "TREATMENT") ctx.treatedPatients.add(ctx.patients.get(pid)!);
    await ev.add({ clinical_event_id: id, patient_id: ctx.patients.get(pid)!, start_date: Math.trunc(start),
      stop_date: stopText && Number.isFinite(Number(stopText)) ? Math.trunc(Number(stopText)) : null, event_type: (row[iT] ?? "").trim() });
    for (let i = 0; i < t.header.length; i++) {
      if (i === iP || i === iS || i === iE || i === iT) continue;
      const v = (row[i] ?? "").trim();
      if (!v || v.toUpperCase() === "NA") continue;
      await data.add({ clinical_event_id: id, key: t.header[i], value: v });
    }
    r.stored++;
  }
  await ev.flush(); await data.flush();
}

/**
 * The gene panel matrix: one column per profile (by stable id, study prefix optional). A panel id
 * sets that sample's panel for the profile and marks it profiled; WXS/WGS means whole
 * exome/genome; NA leaves the sample as the data files left it.
 */
export async function importGenePanelMatrix(ctx: ImportContext, f: DataFile): Promise<void> {
  const r = ctx.report(path.basename(f.file), "gene panel matrix");
  const t = await openTable(f.file);
  const iS = t.header.findIndex((x) => x.toUpperCase() === "SAMPLE_ID");
  if (iS < 0) throw new Error(path.basename(f.file) + " has no SAMPLE_ID column");
  const cols = t.header.map((name, i) => ({ i, profile: i === iS ? undefined : ctx.profileByStableSuffix(name) }));
  for (const c of cols) if (c.i !== iS && !c.profile) r.notes.push("column " + t.header[c.i] + " names no profile in this study; ignored");
  const unknownPanels = new Set<string>();
  for await (const row of t.rows) {
    r.read++;
    const raw = (row[iS] ?? "").trim();
    if (!raw) continue;
    const sample = ctx.sampleFor(sampleId(raw));
    for (const c of cols) {
      if (!c.profile) continue;
      const v = (row[c.i] ?? "").trim();
      if (!v || v === "NA") continue;
      if (v === "WXS" || v === "WGS" || v === "WXS/WGS") { ctx.profiled(sample, c.profile.id, null); continue; }
      const panel = ctx.panels.get(v);
      if (panel === undefined) { unknownPanels.add(v); continue; }
      ctx.profiled(sample, c.profile.id, panel);
    }
    r.stored++;
  }
  if (unknownPanels.size) r.notes.push("unknown gene panels, those cells ignored: " + [...unknownPanels].join(", "));
}
