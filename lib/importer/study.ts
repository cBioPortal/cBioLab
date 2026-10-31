// Reading a study folder: its meta files, which data file each describes, and its case lists.
// A folder without meta files is accepted when its data files have datahub's standard names
// (data_clinical_sample.txt, data_mutations.txt, ...): the meta file each would have had is
// written for it, so a set of files dropped on the import page imports without hand-written metas.
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

export type Meta = Record<string, string>;

/** `key: value` lines; the first `:` splits, values are trimmed. */
export function parseMeta(text: string): Meta {
  const m: Meta = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0 || line.startsWith("#")) continue;
    m[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return m;
}

export async function* lines(file: string): AsyncGenerator<string> {
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

export type DataKind =
  | "cancer_type" | "clinical_sample" | "clinical_patient" | "timeline" | "mutations" | "cna_discrete" | "cna_discrete_long"
  | "matrix" | "sv" | "segments" | "gene_panel_matrix" | "unsupported";

export interface DataFile {
  kind: DataKind;
  meta: Meta;
  metaFile: string | null;
  /** absolute path of the data file */
  file: string;
  /** why a file is not imported, for kind "unsupported" */
  reason?: string;
}

export interface CaseList { stableId: string; category: string; name: string; description: string; ids: string[] }

export interface StudyFolder {
  dir: string;
  study: Meta;
  files: DataFile[];
  caseLists: CaseList[];
  /** data files no meta file describes and whose name says nothing either */
  ignored: string[];
  /** gene panel definition files shipped with the study */
  panels: string[];
}

function kindOf(meta: Meta): { kind: DataKind; reason?: string } {
  const t = (meta.genetic_alteration_type || "").toUpperCase();
  const d = (meta.datatype || "").toUpperCase();
  if (t === "CANCER_TYPE") return { kind: "cancer_type" };
  if (t === "CLINICAL" && d === "SAMPLE_ATTRIBUTES") return { kind: "clinical_sample" };
  if (t === "CLINICAL" && d === "PATIENT_ATTRIBUTES") return { kind: "clinical_patient" };
  if (t === "CLINICAL" && d === "TIMELINE") return { kind: "timeline" };
  if (t === "MUTATION_EXTENDED" || t === "MUTATION_UNCALLED") return { kind: "mutations" };
  if (t === "COPY_NUMBER_ALTERATION" && d === "SEG") return { kind: "segments" };
  if (t === "COPY_NUMBER_ALTERATION" && d === "DISCRETE") return { kind: "cna_discrete" };
  if (t === "COPY_NUMBER_ALTERATION" && d === "DISCRETE_LONG") return { kind: "cna_discrete_long" };
  if (t === "STRUCTURAL_VARIANT" || (t === "FUSION")) return { kind: "sv" };
  if (t === "GENE_PANEL_MATRIX") return { kind: "gene_panel_matrix" };
  if (["COPY_NUMBER_ALTERATION", "MRNA_EXPRESSION", "PROTEIN_LEVEL", "METHYLATION", "MICRO_RNA_EXPRESSION"].includes(t)) return { kind: "matrix" };
  return { kind: "unsupported", reason: (t || "unknown type") + (d ? " / " + d : "") + " is not imported yet" };
}

// datahub's standard file names, and the meta each implies, for folders that come without metas
const INFERRED: { re: RegExp; meta: Meta }[] = [
  { re: /^data_clinical_sample\.txt$/, meta: { genetic_alteration_type: "CLINICAL", datatype: "SAMPLE_ATTRIBUTES" } },
  { re: /^data_clinical_patient\.txt$/, meta: { genetic_alteration_type: "CLINICAL", datatype: "PATIENT_ATTRIBUTES" } },
  { re: /^data_timeline.*\.txt$/, meta: { genetic_alteration_type: "CLINICAL", datatype: "TIMELINE" } },
  { re: /^data_mutations.*\.(txt|maf)$|\.maf$/, meta: { genetic_alteration_type: "MUTATION_EXTENDED", datatype: "MAF", stable_id: "mutations", profile_name: "Mutations", profile_description: "Mutation data", show_profile_in_analysis_tab: "true" } },
  { re: /^data_cna\.txt$|^data_CNA\.txt$/, meta: { genetic_alteration_type: "COPY_NUMBER_ALTERATION", datatype: "DISCRETE", stable_id: "cna", profile_name: "Putative copy-number alterations", profile_description: "Discrete copy-number calls", show_profile_in_analysis_tab: "true" } },
  { re: /^data_sv\.txt$/, meta: { genetic_alteration_type: "STRUCTURAL_VARIANT", datatype: "SV", stable_id: "structural_variants", profile_name: "Structural variants", profile_description: "Structural variant data", show_profile_in_analysis_tab: "true" } },
  { re: /\.seg$/, meta: { genetic_alteration_type: "COPY_NUMBER_ALTERATION", datatype: "SEG", reference_genome_id: "hg19", description: "Segment data" } },
  { re: /^data_gene_panel_matrix\.txt$/, meta: { genetic_alteration_type: "GENE_PANEL_MATRIX", datatype: "GENE_PANEL_MATRIX" } }
];

export async function readStudyFolder(dir: string, fallbackStudyId: string): Promise<StudyFolder> {
  const names = (await readdir(dir)).filter((n) => !n.startsWith("."));
  const metas: { file: string; meta: Meta }[] = [];
  for (const n of names.filter((x) => /^meta.*\.txt$/.test(x))) {
    metas.push({ file: path.join(dir, n), meta: parseMeta(await readFile(path.join(dir, n), "utf8")) });
  }
  const studyMeta = metas.find((m) => (m.meta.type_of_cancer && m.meta.cancer_study_identifier && !m.meta.genetic_alteration_type))?.meta;
  const study: Meta = studyMeta ? { ...studyMeta } : {
    cancer_study_identifier: fallbackStudyId, type_of_cancer: "mixed", name: fallbackStudyId,
    description: "Imported with cBioLab", add_global_case_list: "true", reference_genome: "hg19"
  };
  const files: DataFile[] = [];
  const described = new Set<string>();
  for (const { file, meta } of metas) {
    if (meta === studyMeta || !meta.genetic_alteration_type) continue;
    const df = meta.data_filename;
    if (!df) continue;
    const abs = path.join(dir, df);
    described.add(df);
    try { await stat(abs); } catch {
      files.push({ kind: "unsupported", meta, metaFile: file, file: abs, reason: "its data file " + df + " is missing" });
      continue;
    }
    const k = kindOf(meta);
    files.push({ kind: k.kind, meta, metaFile: file, file: abs, reason: k.reason });
  }
  const ignored: string[] = [];
  const panels: string[] = [];
  for (const n of names) {
    if (/^meta.*\.txt$/.test(n) || described.has(n) || n === "case_lists" || n === "LICENSE" || /\.(md|pdf|json)$/i.test(n)) continue;
    const full = path.join(dir, n);
    if ((await stat(full)).isDirectory()) continue;
    if (/^data_gene_panel_(?!matrix).*\.txt$/.test(n)) { panels.push(full); continue; }
    const inferred = INFERRED.find((x) => x.re.test(n));
    if (inferred) {
      const meta = { ...inferred.meta, data_filename: n };
      files.push({ kind: kindOf(meta).kind, meta, metaFile: null, file: full });
    } else ignored.push(n);
  }
  return { dir, study, files, caseLists: await readCaseLists(dir), ignored, panels };
}

async function readCaseLists(dir: string): Promise<CaseList[]> {
  const cl = path.join(dir, "case_lists");
  let names: string[];
  try { names = await readdir(cl); } catch { return []; }
  const out: CaseList[] = [];
  for (const n of names.filter((x) => x.endsWith(".txt"))) {
    const m = parseMeta(await readFile(path.join(cl, n), "utf8"));
    if (!m.stable_id) continue;
    out.push({
      stableId: m.stable_id, category: m.case_list_category || "other", name: m.case_list_name || m.stable_id,
      description: m.case_list_description || "", ids: (m.case_list_ids || "").split("\t").map((s) => s.trim()).filter(Boolean)
    });
  }
  return out;
}

/**
 * A tab-delimited data file: its `#` comment lines (clinical headers), its header row and a
 * generator of its rows. Blank lines are skipped.
 */
export async function openTable(file: string): Promise<{ comments: string[]; header: string[]; rows: AsyncGenerator<string[]> }> {
  const it = lines(file);
  const comments: string[] = [];
  let header: string[] | null = null;
  while (!header) {
    const n = await it.next();
    if (n.done) return { comments, header: [], rows: (async function* () { /* empty file */ })() };
    const l = n.value;
    if (!l.trim()) continue;
    if (l.startsWith("#")) { comments.push(l); continue; }
    header = l.split("\t").map((h) => h.trim());
  }
  async function* rows(): AsyncGenerator<string[]> {
    for await (const l of it) {
      if (!l.trim() || l.startsWith("#")) continue;
      yield l.split("\t");
    }
  }
  return { comments, header, rows: rows() };
}
