// One study folder into the local database, in the legacy loader's order (cancer type, study,
// clinical samples then patients, profiles, segments, timelines, the gene panel matrix, case
// lists), followed by the computed attributes. What it writes follows the database's schema mode
// (lib/importer/lab-schema.ts): cBioPortal's tables, then cBioPortal's own derived-table SQL, so
// the tables the app reads are built by exactly the SQL that builds them for cbioportal.org; the
// file-shaped lab_ tables, which views present under the same names; or both.
import { readFile } from "node:fs/promises";
import { exec, execScript, insertAll, query, sq, type WriteConn } from "./ch-write.ts";
import { ImportContext, sampleId, type FileReport, type Profile, type Progress } from "./context.ts";
import { GeneResolver } from "./genes.ts";
import { importClinicalPatients, importClinicalSamples } from "./clinical.ts";
import { importMutations } from "./mutations.ts";
import { importDiscreteLong, importMatrix } from "./matrix.ts";
import { fractionGenomeAltered, importGenePanelMatrix, importSegments, importStructuralVariants, importTimeline, type SegmentTotals } from "./other.ts";
import { importGenePanel } from "./panels.ts";
import { derivedTablesSql, schemaMode } from "./setup.ts";
import { refreshLabStudy, removeLabStudy, writesLab, writesLegacy, type SchemaMode } from "./lab-schema.ts";
import { openTable, readStudyFolder, type DataFile, type StudyFolder } from "./study.ts";

export interface ImportResult {
  studyId: string;
  name: string;
  patients: number;
  samples: number;
  files: FileReport[];
  /** files present but not imported, with why */
  notImported: { file: string; reason: string }[];
  warnings: string[];
  seconds: number;
}

const ORDER: DataFile["kind"][] = ["clinical_sample", "clinical_patient", "mutations", "cna_discrete", "cna_discrete_long", "matrix", "sv", "segments", "timeline", "gene_panel_matrix"];

/**
 * `update`: the folder holds some samples of a study already imported (their clinical rows, their
 * lines of the data files) and replaces just those samples, leaving the rest of the study as it
 * is. Only a database in the new schema can take one (lib/importer/lab-schema.ts).
 */
export async function importStudy(conn: WriteConn, dataDir: string, dir: string, fallbackStudyId: string, progress: Progress, update = false): Promise<ImportResult> {
  const t0 = Date.now();
  const folder = await readStudyFolder(dir, fallbackStudyId);
  const studyId = folder.study.cancer_study_identifier;
  if (!studyId || !/^[A-Za-z0-9_.-]+$/.test(studyId)) throw new Error("meta_study.txt needs a cancer_study_identifier of letters, digits, _ . -");
  progress({ step: "Reading genes" });
  const genes = await GeneResolver.load(conn);
  const mode = await schemaMode(conn);
  const ctx = new ImportContext(conn, genes, studyId, progress, mode);
  if (update && mode !== "new") throw new Error("Updating some samples of a study needs a database in the new schema (--schema new); this one is " + mode + ".");
  if (ctx.lab && update) ctx.lab.scope = "samples";

  // the lab_ tables replace only what changed, when the import is merged in (lib/importer/lab-writer.ts)
  if (writesLegacy(mode)) {
    progress({ step: "Removing any earlier import of " + studyId });
    await removeStudy(conn, studyId, "legacy");
  }
  for (const p of folder.panels) {
    const r = await importGenePanel(conn, genes, await readFile(p, "utf8"));
    if (r.warning) ctx.warnings.push(r.warning);
  }
  await ctx.loadIds();
  await importCancerTypes(ctx, folder);
  await createStudy(ctx, folder);

  const seenAttrs = new Set<string>();
  const segTotals: SegmentTotals = new Map();
  const notImported = folder.files.filter((f) => f.kind === "unsupported").map((f) => ({ file: f.meta.data_filename || f.file, reason: f.reason || "" }));
  for (const n of folder.ignored) notImported.push({ file: n, reason: "no meta file describes it and its name is not a standard one" });
  for (const kind of ORDER) {
    for (const f of folder.files.filter((x) => x.kind === kind)) {
      progress({ step: "Importing", file: f.meta.data_filename || f.file });
      try { await importFile(ctx, f, kind, seenAttrs, segTotals); }
      catch (e) {
        // clinical files define the study; anything else that fails is reported and skipped
        if (kind === "clinical_sample" || kind === "clinical_patient") throw e;
        notImported.push({ file: f.meta.data_filename || f.file, reason: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  progress({ step: "Writing patients, samples and case lists" });
  await writePatientsAndSamples(ctx);
  await ctx.insertAll("sample_profile", [...ctx.sampleProfile.values()].map((x) => ({ sample_id: x.sample, genetic_profile_id: x.profile, panel_id: x.panel })));
  await writeCaseLists(ctx, folder);
  progress({ step: "Computing mutation counts, fraction genome altered and samples per patient" });
  await computedAttributes(ctx, segTotals, seenAttrs);
  const counts = studyCounts(ctx);
  if (writesLegacy(mode)) {
    progress({ step: "Building the derived tables" });
    await execScript(conn, await derivedTablesSql(dataDir), { param_optimize_backoff_secs: "0" });
    await exec(conn, "ALTER TABLE cancer_study UPDATE " + Object.entries(counts).map(([k, v]) => k + " = " + v).join(", ") +
      " WHERE cancer_study_id = " + ctx.cancerStudyId, { mutations_sync: "2" });
  }
  if (ctx.lab) {
    progress({ step: "Writing the lab_ tables" });
    await ctx.lab.finish(counts, ctx.referenceGenome);
    if (update) await refreshLabStudy(conn, studyId, [...ctx.patients.keys()]);
  }
  if (ctx.implicitSamples.length)
    ctx.warnings.push(ctx.implicitSamples.length + " samples appear in data files but not in a clinical sample file; they were created with a patient of the same id (e.g. " + ctx.implicitSamples.slice(0, 3).join(", ") + ")");
  return {
    studyId, name: folder.study.name || studyId, patients: ctx.patients.size, samples: ctx.samples.size,
    files: ctx.reports, notImported, warnings: ctx.warnings, seconds: Math.round((Date.now() - t0) / 100) / 10
  };
}

async function importFile(ctx: ImportContext, f: DataFile, kind: DataFile["kind"], seenAttrs: Set<string>, segTotals: SegmentTotals): Promise<void> {
  if (kind === "clinical_sample") await importClinicalSamples(ctx, f, seenAttrs);
  else if (kind === "clinical_patient") await importClinicalPatients(ctx, f, seenAttrs);
  else if (kind === "segments") await importSegments(ctx, f, segTotals);
  else if (kind === "timeline") await importTimeline(ctx, f);
  else if (kind === "gene_panel_matrix") await importGenePanelMatrix(ctx, f);
  else {
    const profile = await createProfile(ctx, f);
    if (kind === "mutations") await importMutations(ctx, f, profile.id);
    else if (kind === "cna_discrete") await importMatrix(ctx, f, profile.id, profile.showInAnalysisTab);
    else if (kind === "cna_discrete_long") await importDiscreteLong(ctx, f, profile.id);
    else if (kind === "matrix") await importMatrix(ctx, f, profile.id, false);
    else if (kind === "sv") await importStructuralVariants(ctx, f, profile.id);
  }
}

async function importCancerTypes(ctx: ImportContext, folder: StudyFolder): Promise<void> {
  const existing = new Set((await query<{ i: string }>(ctx.conn, "SELECT type_of_cancer_id AS i FROM type_of_cancer")).map((x) => x.i));
  const rows: Record<string, string>[] = [];
  for (const f of folder.files.filter((x) => x.kind === "cancer_type")) {
    const t = await openTable(f.file);
    // the cancer type file has no header row: id, name, color, parent
    for (const row of [t.header, ...(await collect(t.rows))]) {
      const [id, name, color, parent] = row.map((x) => (x ?? "").trim());
      if (id && !existing.has(id)) { existing.add(id); rows.push({ type_of_cancer_id: id, name: name || id, dedicated_color: color || "Gray", short_name: id, parent: parent || "tissue" }); }
    }
  }
  const toc = folder.study.type_of_cancer || "mixed";
  if (!existing.has(toc)) { rows.push({ type_of_cancer_id: toc, name: toc, dedicated_color: "Gray", short_name: toc, parent: "tissue" }); ctx.warnings.push("cancer type " + toc + " is not a known type; added as is"); }
  await insertAll(ctx.conn, "type_of_cancer", rows);
}

async function collect<T>(g: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of g) out.push(x);
  return out;
}

async function createStudy(ctx: ImportContext, folder: StudyFolder): Promise<void> {
  const s = folder.study;
  const genome = (s.reference_genome || "hg19").toLowerCase();
  const rg = await query<{ i: number }>(ctx.conn, "SELECT reference_genome_id AS i FROM reference_genome WHERE name = " + sq(genome));
  ctx.referenceGenomeId = Number(rg[0]?.i ?? 1);
  ctx.referenceGenome = genome;
  const next = writesLegacy(ctx.mode) ? await query<{ m: number }>(ctx.conn, "SELECT max(cancer_study_id) AS m FROM cancer_study") : [];
  ctx.cancerStudyId = Number(next[0]?.m ?? 0) + 1;
  await ctx.insertAll("cancer_study", [{
    cancer_study_id: ctx.cancerStudyId, cancer_study_identifier: ctx.studyId, type_of_cancer_id: s.type_of_cancer || "mixed",
    name: s.name || ctx.studyId, description: s.description || "", public: 1, pmid: s.pmid || null, citation: s.citation || null,
    groups: s.groups || null, status: 0, import_date: new Date().toISOString().replace("T", " ").replace("Z", ""), reference_genome_id: ctx.referenceGenomeId
  }]);
}

async function createProfile(ctx: ImportContext, f: DataFile): Promise<Profile> {
  const m = f.meta;
  const suffix = m.stable_id || (f.kind === "mutations" ? "mutations" : f.kind === "sv" ? "structural_variants" : "profile");
  const type = (m.genetic_alteration_type || "").toUpperCase() === "FUSION" ? "STRUCTURAL_VARIANT" : (m.genetic_alteration_type || "").toUpperCase();
  const datatype = (m.datatype || "").toUpperCase() === "DISCRETE_LONG" ? "DISCRETE" : (m.datatype || "").toUpperCase();
  const p: Profile = { id: ctx.id("profile"), stableId: ctx.studyId + "_" + suffix, type, datatype, showInAnalysisTab: (m.show_profile_in_analysis_tab || "true").toLowerCase() !== "false" };
  await ctx.insertAll("genetic_profile", [{
    genetic_profile_id: p.id, stable_id: p.stableId, cancer_study_id: ctx.cancerStudyId, genetic_alteration_type: type,
    generic_assay_type: null, datatype, name: m.profile_name || suffix, description: m.profile_description || null,
    show_profile_in_analysis_tab: p.showInAnalysisTab ? 1 : 0,
    pivot_threshold: m.pivot_threshold_value ? Number(m.pivot_threshold_value) : null, sort_order: m.value_sort_order || null, patient_level: null
  }]);
  ctx.profiles.push(p);
  return p;
}

async function writePatientsAndSamples(ctx: ImportContext): Promise<void> {
  await ctx.insertAll("patient", [...ctx.patients].map(([stable, id]) => ({ internal_id: id, stable_id: stable, cancer_study_id: ctx.cancerStudyId })));
  await ctx.insertAll("sample", [...ctx.samples].map(([stable, s]) => ({
    internal_id: s.id, stable_id: stable, sample_type: ctx.sampleTypes.get(s.id) ?? "Primary Solid Tumor", patient_id: s.patient
  })));
}

const CATEGORY: Record<string, string> = {
  all: "all_cases_in_study", sequenced: "all_cases_with_mutation_data", cna: "all_cases_with_cna_data",
  cnaseq: "all_cases_with_mutation_and_cna_data", sv: "all_cases_with_sv_data"
};

/**
 * The study's case lists. A listed id that is a patient adds all its samples; an unknown id is
 * dropped. `_all`, `_sequenced`, `_cna`, `_cnaseq` and `_sv` are generated from the data when the
 * study does not supply them (cBioPortal generates only `_all`).
 */
async function writeCaseLists(ctx: ImportContext, folder: StudyFolder): Promise<void> {
  const byPatient = new Map<number, number[]>();
  for (const s of ctx.samples.values()) byPatient.set(s.patient, [...(byPatient.get(s.patient) ?? []), s.id]);
  const lists = folder.caseLists.map((c) => {
    const ids: number[] = [];
    for (const raw of c.ids) {
      const s = ctx.samples.get(sampleId(raw));
      if (s) ids.push(s.id);
      else { const p = ctx.patients.get(raw); if (p !== undefined) ids.push(...(byPatient.get(p) ?? [])); }
    }
    return { stableId: c.stableId, category: c.category, name: c.name, description: c.description, ids: [...new Set(ids)] };
  });
  const has = (suffix: string) => lists.some((l) => l.stableId === ctx.studyId + "_" + suffix);
  const profiledBy = (type: string, datatype?: string) => {
    const profiles = new Set(ctx.profiles.filter((p) => p.type === type && (!datatype || p.datatype === datatype)).map((p) => p.id));
    return new Set([...ctx.sampleProfile.values()].filter((x) => profiles.has(x.profile)).map((x) => x.sample));
  };
  const add = (suffix: string, name: string, ids: Set<number>) => {
    if (has(suffix) || !ids.size) return;
    lists.push({ stableId: ctx.studyId + "_" + suffix, category: CATEGORY[suffix], name, description: name + " (generated by cBioLab)", ids: [...ids] });
  };
  add("all", "All samples", new Set([...ctx.samples.values()].map((s) => s.id)));
  const seq = profiledBy("MUTATION_EXTENDED"), cna = profiledBy("COPY_NUMBER_ALTERATION", "DISCRETE");
  add("sequenced", "Samples with mutation data", seq);
  add("cna", "Samples with copy-number data", cna);
  add("cnaseq", "Samples with mutation and copy-number data", new Set([...seq].filter((s) => cna.has(s))));
  add("sv", "Samples with structural variant data", profiledBy("STRUCTURAL_VARIANT"));
  const rows = lists.map((l) => ({ ...l, listId: ctx.id("sampleList") }));
  await ctx.insertAll("sample_list", rows.map((l) => ({ list_id: l.listId, stable_id: l.stableId, category: l.category, cancer_study_id: ctx.cancerStudyId, name: l.name, description: l.description })));
  await ctx.insertAll("sample_list_list", rows.flatMap((l) => l.ids.map((s) => ({ list_id: l.listId, sample_id: s }))));
}

/** MUTATION_COUNT, FRACTION_GENOME_ALTERED and SAMPLE_COUNT, which cBioPortal computes rather than reads. */
async function computedAttributes(ctx: ImportContext, segs: SegmentTotals, seen: Set<string>): Promise<void> {
  const meta: Record<string, string | number>[] = [];
  const addMeta = (id: string, name: string, datatype: string, patient: number, priority: string) => {
    if (!seen.has(id)) meta.push({ attr_id: id, display_name: name, description: name, datatype, patient_attribute: patient, priority, cancer_study_id: ctx.cancerStudyId });
  };
  const mutProfiles = new Set(ctx.profiles.filter((p) => p.type === "MUTATION_EXTENDED").map((p) => p.id));
  if (mutProfiles.size) {
    // one count per profiled sample, 0 when nothing was found; distinct loci, germline excluded
    const profiled = new Set([...ctx.sampleProfile.values()].filter((x) => mutProfiles.has(x.profile)).map((x) => x.sample));
    await ctx.insertAll("clinical_sample", [...profiled].map((s) => ({ internal_id: s, attr_id: "MUTATION_COUNT", attr_value: String(ctx.mutationLoci.get(s)?.size ?? 0) })));
    addMeta("MUTATION_COUNT", "Mutation Count", "NUMBER", 0, "30");
  }
  if (segs.size) {
    await ctx.insertAll("clinical_sample", [...segs].filter(([, [, total]]) => total > 0)
      .map(([sample, [alt, total]]) => ({ internal_id: sample, attr_id: "FRACTION_GENOME_ALTERED", attr_value: fractionGenomeAltered(alt, total) })));
    addMeta("FRACTION_GENOME_ALTERED", "Fraction Genome Altered", "NUMBER", 0, "20");
  }
  const perPatient = new Map<number, number>();
  for (const s of ctx.samples.values()) perPatient.set(s.patient, (perPatient.get(s.patient) ?? 0) + 1);
  await ctx.insertAll("clinical_patient", [...perPatient].map(([p, n]) => ({ internal_id: p, attr_id: "SAMPLE_COUNT", attr_value: String(n) })));
  addMeta("SAMPLE_COUNT", "Number of Samples Per Patient", "STRING", 1, "1");
  await ctx.insertAll("clinical_attribute_meta", meta);
}

/** The per-study counts the public warehouse precomputes on cancer_study (lib/datasets.ts reads them). */
function studyCounts(ctx: ImportContext): Record<string, number> {
  const by = (pred: (p: Profile) => boolean) => {
    const ids = new Set(ctx.profiles.filter(pred).map((p) => p.id));
    return new Set([...ctx.sampleProfile.values()].filter((x) => ids.has(x.profile)).map((x) => x.sample)).size;
  };
  const mrna = (p: Profile) => p.type === "MRNA_EXPRESSION";
  return {
    sample_count: ctx.samples.size,
    mutation_sample_count: by((p) => p.type === "MUTATION_EXTENDED"),
    cna_sample_count: by((p) => p.type === "COPY_NUMBER_ALTERATION" && p.datatype === "DISCRETE"),
    structural_variant_sample_count: by((p) => p.type === "STRUCTURAL_VARIANT"),
    rna_seq_sample_count: by((p) => mrna(p) && p.stableId.includes("rna_seq")),
    mrna_microarray_sample_count: by((p) => mrna(p) && !p.stableId.includes("rna_seq") && p.stableId.includes("mrna")),
    mrna_expression_sample_count: by(mrna),
    rppa_sample_count: by((p) => p.type === "PROTEIN_LEVEL" && !p.stableId.includes("ms_abundance")),
    mass_spectrometry_sample_count: by((p) => p.type === "PROTEIN_LEVEL" && p.stableId.includes("ms_abundance")),
    treatment_patient_count: ctx.treatedPatients.size
  };
}

/** Deletes every row of a study, from the lab_ tables and from cBioPortal's base tables (the derived ones are rebuilt after). */
export async function removeStudy(conn: WriteConn, studyId: string, mode: SchemaMode): Promise<boolean> {
  const fromLab = writesLab(mode) ? await removeLabStudy(conn, studyId) : false;
  if (!writesLegacy(mode)) return fromLab;
  const cs = await query<{ i: number }>(conn, "SELECT cancer_study_id AS i FROM cancer_study WHERE cancer_study_identifier = " + sq(studyId));
  if (!cs.length) return fromLab;
  const id = Number(cs[0].i);
  const patients = "(SELECT internal_id FROM patient WHERE cancer_study_id = " + id + ")";
  const samples = "(SELECT internal_id FROM sample WHERE patient_id IN " + patients + ")";
  const profiles = "(SELECT genetic_profile_id FROM genetic_profile WHERE cancer_study_id = " + id + ")";
  const lists = "(SELECT list_id FROM sample_list WHERE cancer_study_id = " + id + ")";
  const events = "(SELECT clinical_event_id FROM clinical_event WHERE patient_id IN " + patients + ")";
  const statements = [
    "DELETE FROM mutation_event WHERE mutation_event_id IN (SELECT mutation_event_id FROM mutation WHERE genetic_profile_id IN " + profiles + ")",
    "DELETE FROM mutation WHERE genetic_profile_id IN " + profiles,
    "DELETE FROM alteration_driver_annotation WHERE genetic_profile_id IN " + profiles,
    "DELETE FROM sample_cna_event WHERE genetic_profile_id IN " + profiles,
    "DELETE FROM genetic_alteration WHERE genetic_profile_id IN " + profiles,
    "DELETE FROM genetic_profile_samples WHERE genetic_profile_id IN " + profiles,
    "DELETE FROM sample_profile WHERE genetic_profile_id IN " + profiles,
    "DELETE FROM structural_variant WHERE genetic_profile_id IN " + profiles,
    "DELETE FROM clinical_sample WHERE internal_id IN " + samples,
    "DELETE FROM clinical_patient WHERE internal_id IN " + patients,
    "DELETE FROM clinical_event_data WHERE clinical_event_id IN " + events,
    "DELETE FROM clinical_event WHERE patient_id IN " + patients,
    "DELETE FROM sample_list_list WHERE list_id IN " + lists,
    "DELETE FROM sample_list WHERE cancer_study_id = " + id,
    "DELETE FROM copy_number_seg WHERE cancer_study_id = " + id,
    "DELETE FROM copy_number_seg_file WHERE cancer_study_id = " + id,
    "DELETE FROM clinical_attribute_meta WHERE cancer_study_id = " + id,
    "DELETE FROM genetic_profile WHERE cancer_study_id = " + id,
    "DELETE FROM sample WHERE patient_id IN " + patients,
    "DELETE FROM patient WHERE cancer_study_id = " + id,
    "DELETE FROM cancer_study WHERE cancer_study_id = " + id
  ];
  for (const st of statements) await exec(conn, st);
  return true;
}

/** Removes a study and rebuilds the derived tables without it. */
export async function deleteStudy(conn: WriteConn, dataDir: string, studyId: string): Promise<boolean> {
  const mode = await schemaMode(conn);
  const removed = await removeStudy(conn, studyId, mode);
  if (removed && writesLegacy(mode)) await execScript(conn, await derivedTablesSql(dataDir), { param_optimize_backoff_secs: "0" });
  return removed;
}
