// MAF files (notes/legacy-java-importer.md §M). Every rule that decides whether a row is stored,
// and what it is stored as, is a named function here so each one can be checked on its own.
import path from "node:path";
import { ImportContext, skip, sampleId, isNormalBarcode, type FileReport } from "./context.ts";
import { openTable, type DataFile } from "./study.ts";
import { mutationKeyword } from "./mutation-keyword.ts";

const DEFAULT_FILTERED = ["silent", "intron", "3'utr", "3'flank", "5'utr", "igr"];
const TERT = 7015;

/**
 * Whether a Variant_Classification is filtered out. With no meta `variant_classification_filter`
 * the default list matches case-insensitively by prefix and 5'Flank is kept for TERT only; a
 * meta list replaces it and matches exactly.
 */
export function filteredClassification(vc: string, entrez: number, custom: Set<string> | null): boolean {
  if (custom) return custom.has(vc);
  const v = vc.toLowerCase();
  if (v.startsWith("5'flank")) return entrez !== TERT;
  return DEFAULT_FILTERED.some((p) => v.startsWith(p));
}

/** Rows dropped for their status: Wildtype/Redacted validation, None/LOH/Wildtype mutation status. */
export function filteredStatus(validation: string, status: string): string | null {
  const v = validation.toLowerCase(), s = status.toLowerCase();
  if (v === "wildtype") return "Validation_Status Wildtype";
  if (v.startsWith("redacted")) return "Validation_Status Redacted";
  if (s.startsWith("none") || s.startsWith("loh") || s.startsWith("wildtype")) return "Mutation_Status " + status;
  return null;
}

/** Chromosome as stored for mutations: `chr` dropped, X/Y as 23/24; anything else is null (row dropped). */
export function mafChromosome(raw: string): string | null {
  const c = raw.trim().toUpperCase().replace(/^CHR/, "");
  if (!c || c === "NA") return "NA";
  if (c === "X") return "23";
  if (c === "Y") return "24";
  if (c === "MT") return "MT";
  if (/^\d+$/.test(c) && Number(c) >= 1 && Number(c) <= 24) return String(Number(c));
  return null;
}

const INVALID_PROTEIN = new Set(["", "NULL", "NA", "[NOT AVAILABLE]"]);

/** HGVSp_Short, else Amino_Acid_Change, else "MUTATED"; a leading `p.` removed. */
export function proteinChange(hgvsp: string, aac: string): string {
  const pick = [hgvsp.trim(), aac.trim()].find((x) => !INVALID_PROTEIN.has(x.toUpperCase())) ?? "MUTATED";
  return pick.startsWith("p.") ? pick.slice(2) : pick;
}

/** Java's `(int) Double.parseDouble(s)`, or -1 where that throws (`TabDelimitedFileUtil.getPartInt`). */
function javaInt(s: string | undefined): number {
  const t = (s ?? "").trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[dDfF]?$/.test(t)) return -1;
  return Math.trunc(Number(t.replace(/[dDfF]$/, "")));
}

/** `ExtendedMutationUtil.annotateProteinChange`: start and end residues read from a protein change, -1 where unknown. */
export function annotateProteinChange(change: string): [number, number] {
  let pc = change.startsWith("p.") ? change.slice(2) : change;
  if (pc.includes("[")) pc = pc.slice(0, pc.indexOf("["));
  pc = pc.trim();
  let m = /^([A-Z*]+)([0-9]+)([A-Z*?]*)$/.exec(pc);
  if (m) {
    const [, ref, s, v] = m, start = Number(s);
    const single = ref === v || ref === "*" || v === "*" || start === 1 || v === "?";
    return [start, single ? start : start + ref.length - 1];
  }
  m = /^[A-Z]?([0-9]+)(_[A-Z]?([0-9]+))?(delins|ins)([A-Z]+)$/.exec(pc) ?? /^[A-Z]?([0-9]+)(_[A-Z]?([0-9]+))?(_)?splice$/.exec(pc);
  if (m) return [Number(m[1]), m[3] !== undefined ? Number(m[3]) : Number(m[1])];
  m = /^[A-Z]?([0-9]+)_[A-Z]?([0-9]+)(.+)$/.exec(pc);
  if (m) return [Number(m[1]), Number(m[2])];
  m = /^([A-Z*])([0-9]+)[A-Z]?fs.*$/.exec(pc) ?? /^([A-Z]+)?([0-9]+)((ins)|(del)|(dup))$/.exec(pc);
  if (m) return [Number(m[2]), Number(m[2])];
  return [-1, -1];
}

/**
 * Protein start/end as the legacy importer stores them: each from the "start-end" part of
 * Protein_position, and only where that part is missing or unreadable, from the protein change.
 */
export function proteinPositions(pos: string, change: string): [number, number] {
  const parts = (pos || "NA").split("/")[0].split("-");
  let start = javaInt(parts[0]), end = javaInt(parts[1]);
  if (start === -1) start = annotateProteinChange(change)[0];
  if (end === -1) end = annotateProteinChange(change)[1];
  return [start, end];
}

const blank = (v: string) => !v || v.toUpperCase() === "NA";

/** `MafUtil.resolveTumorSeqAllele`: the tumor allele that differs from the reference. */
export function tumorAllele(ref: string, t1: string, t2: string): string {
  if (blank(t1) && blank(t2)) return "";
  if (blank(t1) || t1 === ref) return t2;
  if (blank(t2) || t2 === ref) return t1;
  if (t1 === "-" && /^[ACGTN]+$/i.test(t2)) return t2;
  if (t2 === "-" && /^[ACGTN]+$/i.test(t1)) return t1;
  return t1;
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || !v.trim()) return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const pos = (v: string): number => { const n = num(v); return n === null || n < 0 ? 0 : n; };

/** Java's `Float.parseFloat`, or -1 where that throws (`TabDelimitedFileUtil.getPartFloat`). */
function javaFloat(s: string): number {
  const t = s.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[dDfF]?$/.test(t)) return -1;
  return Math.fround(Number(t.replace(/[dDfF]$/, "")));
}
/** Java's `Math.round(int * float)`. */
const roundProduct = (depth: number, vaf: number) => Math.floor(Math.fround(depth * vaf) + 0.5);

/** The columns `MafUtil` reads allele counts from, each with the alternative names it accepts. */
export interface CountColumns { tAlt: string; tRef: string; nAlt: string; nRef: string; tTot: string; tVar: string; nTot: string; nVar: string; tDepth: string; tVaf: string; nDepth: string; nVaf: string }

/**
 * `ExtendedMutationUtil.getTumorAltCount` and its three siblings: the count column when it holds a
 * number, else TVarCov/TTotCov (or NVarCov/NTotCov), else depth × VAF; null when none is present.
 */
export function alleleCounts(c: CountColumns): { tumor_alt_count: number | null; tumor_ref_count: number | null; normal_alt_count: number | null; normal_ref_count: number | null } {
  const i = (v: string) => javaInt(v);
  const side = (alt: string, ref: string, tot: string, vr: string, depth: string, vaf: string) => {
    const a = i(alt), r = i(ref), t = i(tot), v = i(vr), d = i(depth), f = javaFloat(vaf);
    const fromVaf = d !== -1 && f !== -1;
    return [
      a !== -1 ? a : v !== -1 ? v : fromVaf ? roundProduct(d, f) : null,
      r !== -1 ? r : v !== -1 && t !== -1 ? t - v : fromVaf ? d - roundProduct(d, f) : null
    ];
  };
  const [ta, tr] = side(c.tAlt, c.tRef, c.tTot, c.tVar, c.tDepth, c.tVaf);
  const [na, nr] = side(c.nAlt, c.nRef, c.nTot, c.nVar, c.nDepth, c.nVaf);
  return { tumor_alt_count: ta, tumor_ref_count: tr, normal_alt_count: na, normal_ref_count: nr };
}

// `MafUtil` matches header names case-insensitively, a few under alternative names; where several
// columns match, the last one wins
const COLUMN_ALIASES: Record<string, string[]> = {
  t_ref_count: ["t_ref_count", "i_t_ref_count", "AD_Ref"], t_alt_count: ["t_alt_count", "i_t_alt_count", "AD_Alt"],
  n_ref_count: ["n_ref_count", "Norm_AD_Ref"], n_alt_count: ["n_alt_count", "Norm_AD_Alt"]
};

interface Mut { row: Record<string, string | number | null>; event: Record<string, string | number | null>; sample: number; centers: Set<string>; driver: Record<string, string> | null; rank: number }

/** Tie-break when two rows are the same mutation: validated beats germline beats anything else. */
function rank(validation: string, status: string): number {
  if (/^valid(ated)?$/i.test(validation)) return 2;
  if (/^germline$/i.test(status)) return 1;
  return 0;
}

export async function importMutations(ctx: ImportContext, f: DataFile, profile: number): Promise<void> {
  const r = ctx.report(path.basename(f.file), "mutations");
  const t = await openTable(f.file);
  const h = new Map<string, number>();
  t.header.forEach((x, i) => {
    const k = x.trim().toLowerCase();
    h.set(k, i);
    for (const [name, names] of Object.entries(COLUMN_ALIASES)) if (names.some((n) => n.toLowerCase() === k)) h.set(name, i);
  });
  const get = (row: string[], name: string) => { const i = h.get(name.toLowerCase()); return i === undefined ? "" : (row[i] ?? "").trim(); };
  if (!h.has("tumor_sample_barcode")) throw new Error(path.basename(f.file) + " has no Tumor_Sample_Barcode column");
  const custom = f.meta.variant_classification_filter
    ? new Set(f.meta.variant_classification_filter.split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const panel = panelOf(ctx, f, r);

  // `#sequenced_samples:` lines list samples profiled even when nothing was found in them
  for (const c of t.comments) {
    const m = /^#\s*sequenced_samples:\s*(.*)$/i.exec(c);
    if (m) for (const s of m[1].split(/\s+/).filter(Boolean)) ctx.profiled(ctx.sampleFor(sampleId(s)), profile, panel);
  }

  const muts = new Map<string, Mut>();
  for await (const row of t.rows) {
    r.read++;
    const barcode = get(row, "Tumor_Sample_Barcode");
    if (!barcode) { skip(r, "no Tumor_Sample_Barcode"); continue; }
    if (isNormalBarcode(barcode)) { skip(r, "normal-tissue sample"); continue; }
    const status = get(row, "Mutation_Status"), validation = get(row, "Validation_Status");
    const why = filteredStatus(validation, status);
    if (why) { skip(r, why); continue; }
    const hugo = get(row, "Hugo_Symbol");
    if (hugo === "Unknown" && (!get(row, "Entrez_Gene_Id") || get(row, "Entrez_Gene_Id") === "0")) { skip(r, "gene Unknown (intergenic)"); continue; }
    const gene = ctx.genes.forMaf(hugo, get(row, "Entrez_Gene_Id"));
    if (!gene) { skip(r, "gene not recognised"); continue; }
    const vc = get(row, "Variant_Classification");
    if (filteredClassification(vc, gene.entrez, custom)) { skip(r, "filtered classification (" + vc + ")"); continue; }
    if (vc.toUpperCase() === "RNA") { skip(r, "RNA"); continue; }
    const chr = mafChromosome(get(row, "Chromosome"));
    if (chr === null) { skip(r, "unsupported chromosome"); continue; }
    const ref = get(row, "Reference_Allele") || "NA";
    const start = pos(get(row, "Start_Position"));
    const end = ref === "-" ? start + 1 : pos(get(row, "End_Position"));
    let change = proteinChange(get(row, "HGVSp_Short"), get(row, "Amino_Acid_Change"));
    if (vc.toLowerCase().startsWith("5'flank")) change = "Promoter";
    const allele = tumorAllele(ref, get(row, "Tumor_Seq_Allele1"), get(row, "Tumor_Seq_Allele2"));
    const [pStart, pEnd] = proteinPositions(get(row, "Protein_position"), change);
    const sample = ctx.sampleFor(sampleId(barcode));
    const eventKey = [gene.entrez, chr, start, end, change, allele, vc].join("|").toLowerCase();
    const key = eventKey + "|" + sample;
    const center = get(row, "Center") || "NA";
    const rk = rank(validation, status);
    const prior = muts.get(key);
    if (prior) {
      prior.centers.add(center);
      skip(r, "duplicate of another row (merged)");
      if (rk <= prior.rank) continue;
    }
    const driverFilter = get(row, "cbp_driver"), tiers = get(row, "cbp_driver_tiers");
    const hasDriver = (driverFilter && driverFilter.toLowerCase() !== "na") || (tiers && tiers.toLowerCase() !== "na");
    const na = (v: string) => v || "NA";
    muts.set(key, {
      sample, rank: rk, centers: prior?.centers ?? new Set([center]),
      driver: hasDriver ? {
        driver_filter: driverFilter.toLowerCase() === "na" ? "" : driverFilter, driver_filter_annotation: get(row, "cbp_driver_annotation"),
        driver_tiers_filter: tiers.toLowerCase() === "na" ? "" : tiers, driver_tiers_filter_annotation: get(row, "cbp_driver_tiers_annotation")
      } : null,
      event: {
        entrez_gene_id: gene.entrez, chr, start_position: start, end_position: end, reference_allele: ref, tumor_seq_allele: allele,
        protein_change: change, mutation_type: vc, ncbi_build: na(get(row, "NCBI_Build")), strand: na(get(row, "Strand")),
        variant_type: na(get(row, "Variant_Type")), db_snp_rs: na(get(row, "dbSNP_RS")), db_snp_val_status: na(get(row, "dbSNP_Val_Status")),
        refseq_mrna_id: na(get(row, "RefSeq")), codon_change: na(get(row, "Codons")), uniprot_accession: na(get(row, "SWISSPROT")),
        protein_pos_start: pStart, protein_pos_end: pEnd, canonical_transcript: 1, keyword: mutationKeyword(gene.hugo, change, vc)
      },
      row: {
        genetic_profile_id: profile, sample_id: sample, entrez_gene_id: gene.entrez,
        sequencer: na(get(row, "Sequencer")), mutation_status: na(status), validation_status: na(validation),
        tumor_seq_allele1: na(get(row, "Tumor_Seq_Allele1")), tumor_seq_allele2: na(get(row, "Tumor_Seq_Allele2")),
        matched_norm_sample_barcode: na(get(row, "Matched_Norm_Sample_Barcode")),
        match_norm_seq_allele1: na(get(row, "Match_Norm_Seq_Allele1")), match_norm_seq_allele2: na(get(row, "Match_Norm_Seq_Allele2")),
        tumor_validation_allele1: na(get(row, "Tumor_Validation_Allele1")), tumor_validation_allele2: na(get(row, "Tumor_Validation_Allele2")),
        match_norm_validation_allele1: na(get(row, "Match_Norm_Validation_Allele1")), match_norm_validation_allele2: na(get(row, "Match_Norm_Validation_Allele2")),
        verification_status: na(get(row, "Verification_Status")), sequencing_phase: na(get(row, "Sequencing_Phase")),
        sequence_source: na(get(row, "Sequence_Source")), validation_method: na(get(row, "Validation_Method")),
        score: na(get(row, "Score")), bam_file: na(get(row, "BAM_File")),
        ...alleleCounts({
          tAlt: get(row, "t_alt_count"), tRef: get(row, "t_ref_count"), nAlt: get(row, "n_alt_count"), nRef: get(row, "n_ref_count"),
          tTot: get(row, "TTotCov"), tVar: get(row, "TVarCov"), nTot: get(row, "NTotCov"), nVar: get(row, "NVarCov"),
          tDepth: get(row, "tumor_depth"), tVaf: get(row, "tumor_vaf"), nDepth: get(row, "normal_depth"), nVaf: get(row, "normal_vaf")
        }),
        amino_acid_change: null, annotation_json: null
      }
    });
  }
  await write(ctx, muts, profile, panel, r);
}

async function write(ctx: ImportContext, muts: Map<string, Mut>, profile: number, panel: number | null, r: FileReport): Promise<void> {
  const events = new Map<string, number>();
  const evIns = ctx.sink("mutation_event"), mIns = ctx.sink("mutation"), dIns = ctx.sink("alteration_driver_annotation");
  for (const [key, m] of muts) {
    const eventKey = key.slice(0, key.lastIndexOf("|"));
    let ev = events.get(eventKey);
    if (ev === undefined) {
      ev = ctx.id("mutationEvent");
      events.set(eventKey, ev);
      await evIns.add({ mutation_event_id: ev, ...m.event });
    }
    const centers = [...m.centers].sort();
    const center = (centers.length > 1 ? centers.filter((c) => c !== "NA") : centers).join(";");
    await mIns.add({ mutation_event_id: ev, center, ...m.row });
    if (String(m.row.mutation_status).toUpperCase() !== "GERMLINE") {
      const e = m.event, loci = ctx.mutationLoci.get(m.sample) ?? new Set<string>();
      loci.add([e.chr, e.start_position, e.end_position, e.reference_allele, e.tumor_seq_allele].join("|"));
      ctx.mutationLoci.set(m.sample, loci);
    }
    if (m.driver) await dIns.add({ alteration_event_id: ev, genetic_profile_id: profile, sample_id: m.sample, ...m.driver });
    ctx.profiled(m.sample, profile, panel);
    r.stored++;
  }
  await evIns.flush(); await mIns.flush(); await dIns.flush();
}

/** The meta file's `gene_panel`, as an internal id; null means whole exome/genome. */
export function panelOf(ctx: ImportContext, f: DataFile, r: FileReport): number | null {
  const p = f.meta.gene_panel;
  if (!p) return null;
  const id = ctx.panels.get(p);
  if (id === undefined) { r.notes.push("gene panel " + p + " is not defined; samples are treated as whole-exome"); return null; }
  return id;
}
