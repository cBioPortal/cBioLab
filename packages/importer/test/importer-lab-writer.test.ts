// The lab_ row writer (lib/importer/lab-writer.ts; docs/LOCAL.md "Schema modes"): each row the
// importer produces for cBioPortal's tables becomes its file-shaped lab_ row with the files' own
// ids, denormalized (the gene's symbol, the sample's patient and panel, whether the gene is on the
// panel, the cytoband), with the clinical grid filled with '' and rows that wait on later rows
// (driver annotations, timeline values) written at `finish`, staged and then merged in.
// ClickHouse is the stand-in of test/support/fake-ch.ts.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeCh, type FakeCh } from "./support.ts";
import { LabWriter, type LabStudyContext } from "../src/lab-writer.ts";
import type { Gene } from "../src/genes.ts";

let ch: FakeCh | null = null;
afterEach(() => { ch?.restore(); ch = null; });

const GENES: Gene[] = [
  { entrez: 7157, hugo: "TP53", type: "protein-coding", entityId: 1 },
  { entrez: 3845, hugo: "KRAS", type: "protein-coding", entityId: 2 },
  { entrez: 673, hugo: "BRAF", type: "protein-coding", entityId: 3 },
];
const PROFILES: Record<number, string> = { 1: "st_mutations", 2: "st_gistic", 3: "st_sv", 4: "st_mrna", 5: "st_ga" };

function context(over: Partial<LabStudyContext> = {}): LabStudyContext {
  return {
    studyId: "st",
    patient: (id) => "P" + id,
    sample: (id) => ({ sample: "S" + id, patient: "P" + id }),
    profile: (id) => PROFILES[id],
    panel: (id) => "PANEL" + id,
    geneOfEntity: (e) => GENES.find((g) => g.entityId === e)!,
    geneOfEntrez: (e) => GENES.find((g) => g.entrez === e) ?? null,
    referenceGenome: () => "hg19",
    sampleIds: () => ["S1"],
    patientIds: () => ["P1"],
    ...over,
  };
}

/** a writer on a fresh fake ClickHouse, answering the gene panel, cytoband and shared-CNA-event lookups */
function writer(over: Partial<LabStudyContext> = {}): LabWriter {
  ch = fakeCh();
  ch.answer(/FROM gene_panel gp/, [{ p: "PANEL7", g: ["TP53"] }]);
  ch.answer(/FROM reference_genome_gene r/, [{ e: 7157, c: "17p13.1" }, { e: 3845, c: "12p12.1" }]);
  ch.answer(/FROM cna_event WHERE cna_event_id IN/, [{ i: 99, e: 3845, a: 2 }]);
  return new LabWriter(ch.conn, context(over));
}

/** the rows staged for a lab_ table */
const staged = (table: string) => ch!.tables().filter((t) => new RegExp("^" + table + "_stage_\\d+_\\d+$").test(t)).flatMap((t) => ch!.rows(t));
const strip = (rows: Record<string, unknown>[]) => rows.map(({ version: _v, ...r }) => r);

const profile = (id: number, type: string, datatype = "MAF") =>
  ({ genetic_profile_id: id, stable_id: PROFILES[id], genetic_alteration_type: type, datatype, name: "n", description: "d", show_profile_in_analysis_tab: 1 });

test("patients, samples and clinical rows keep the files' ids; missing cells of the grid are written as ''", async () => {
  const w = writer();
  await w.accept("cancer_study", { name: "Study", type_of_cancer_id: "brca", public: 1 });
  for (const id of [1, 2]) {
    await w.accept("patient", { internal_id: id, stable_id: "P" + id });
    await w.accept("sample", { internal_id: id, stable_id: "S" + id, patient_id: id, sample_type: "Primary Solid Tumor" });
  }
  await w.accept("clinical_attribute_meta", { attr_id: "CANCER_TYPE", display_name: "Cancer Type", datatype: "STRING", patient_attribute: 0, priority: "1" });
  await w.accept("clinical_attribute_meta", { attr_id: "AGE", display_name: "Age", datatype: "NUMBER", patient_attribute: 1, priority: "1" });
  await w.accept("clinical_sample", { internal_id: 1, attr_id: "CANCER_TYPE", attr_value: "Breast" });
  await w.accept("clinical_patient", { internal_id: 1, attr_id: "AGE", attr_value: "50" });
  await w.finish({ sample_count: 2 }, "hg19");

  assert.deepEqual(staged("lab_patient").map((r) => [r.study_id, r.patient_id, r.is_deleted]), [["st", "P1", 0], ["st", "P2", 0]]);
  assert.deepEqual(staged("lab_sample").map((r) => [r.sample_id, r.patient_id, r.sample_type]), [["S1", "P1", "Primary Solid Tumor"], ["S2", "P2", "Primary Solid Tumor"]]);
  const clinical = staged("lab_clinical").map((r) => [r.patient_id, r.sample_id, r.attr_id, r.value]);
  assert.deepEqual(clinical.sort(), [["P1", "", "AGE", "50"], ["P1", "S1", "CANCER_TYPE", "Breast"], ["P2", "", "AGE", ""], ["P2", "S2", "CANCER_TYPE", ""]]);
  const [study] = staged("lab_study");
  assert.equal(study.name, "Study");
  assert.equal(study.reference_genome, "hg19");
  assert.equal(study.sample_count, 2);
  // every row of one import carries the same version
  assert.equal(new Set(["lab_patient", "lab_sample", "lab_clinical", "lab_study"].flatMap((t) => staged(t).map((r) => r.version))).size, 1);
});

test("a mutation carries its gene, patient, panel and whether the gene is on the panel, plus its driver annotation", async () => {
  const w = writer();
  await w.accept("genetic_profile", profile(1, "MUTATION_EXTENDED"));
  await w.accept("sample_profile", { sample_id: 1, genetic_profile_id: 1, panel_id: 7 });
  await w.accept("sample_profile", { sample_id: 2, genetic_profile_id: 1, panel_id: null });
  await w.accept("mutation_event", { mutation_event_id: 10, entrez_gene_id: 7157, chr: "17", protein_change: "R175H" });
  await w.accept("mutation_event", { mutation_event_id: 11, entrez_gene_id: 3845, chr: "12", protein_change: "G12D" });
  await w.accept("mutation_event", { mutation_event_id: 12, entrez_gene_id: 3845, chr: "12", protein_change: "G13D" });
  await w.accept("mutation", { mutation_event_id: 10, genetic_profile_id: 1, sample_id: 1, entrez_gene_id: 7157, tumor_alt_count: 5 });
  await w.accept("mutation", { mutation_event_id: 12, genetic_profile_id: 1, sample_id: 1, entrez_gene_id: 3845, tumor_alt_count: 6 });
  await w.accept("mutation", { mutation_event_id: 11, genetic_profile_id: 1, sample_id: 2, entrez_gene_id: 3845, tumor_alt_count: 7 });
  await w.accept("alteration_driver_annotation", { alteration_event_id: 10, genetic_profile_id: 1, sample_id: 1, driver_filter: "Putative_Driver" });
  await w.finish({}, "hg19");

  const m = staged("lab_mutation");
  const tp53 = m.find((r) => r.hugo_gene_symbol === "TP53")!;
  assert.deepEqual([tp53.profile_id, tp53.sample_id, tp53.patient_id, tp53.panel_id, tp53.profiled, tp53.off_panel, tp53.gene_type, tp53.protein_change, tp53.chr],
    ["st_mutations", "S1", "P1", "PANEL7", 1, 0, "protein-coding", "R175H", "17"]);
  assert.deepEqual([tp53.has_driver, tp53.driver_filter, tp53.driver_tiers_filter], [1, "Putative_Driver", null]);
  // KRAS is not on PANEL7: profiled for the sample, but off its panel
  const kras1 = m.find((r) => r.sample_id === "S1" && r.hugo_gene_symbol === "KRAS")!;
  assert.deepEqual([kras1.off_panel, kras1.has_driver, kras1.driver_filter], [1, 0, null]);
  // no panel: whole exome, every gene with an Entrez id is covered
  const kras2 = m.find((r) => r.sample_id === "S2")!;
  assert.deepEqual([kras2.panel_id, kras2.off_panel, kras2.protein_change], ["", 0, "G12D"]);
  assert.deepEqual(staged("lab_sample_profile").map((r) => [r.sample_id, r.profile_id, r.alteration_type, r.panel_id]),
    [["S1", "st_mutations", "MUTATION_EXTENDED", "PANEL7"], ["S2", "st_mutations", "MUTATION_EXTENDED", ""]]);
  assert.ok(ch!.statements.some((s) => /gp\.stable_id IN \('PANEL7'\)/.test(s)), "only the panels in use are looked up");
});

test("a sample of the _sequenced case list counts as profiled for <study>_mutations, as the derived-table script makes it", async () => {
  const w = writer();
  await w.accept("genetic_profile", profile(1, "MUTATION_EXTENDED"));
  await w.accept("sample_list", { list_id: 5, stable_id: "st_sequenced", category: "all_cases_with_mutation_data", name: "Sequenced" });
  await w.accept("sample_list", { list_id: 6, stable_id: "st_all", category: "all_cases_in_study", name: "All" });
  await w.accept("sample_list_list", { list_id: 5, sample_id: 3 });
  await w.accept("sample_list_list", { list_id: 6, sample_id: 3 });
  await w.accept("sample_list_list", { list_id: 6, sample_id: 4 });
  await w.accept("mutation_event", { mutation_event_id: 1, entrez_gene_id: 7157 });
  await w.accept("mutation", { mutation_event_id: 1, genetic_profile_id: 1, sample_id: 3, entrez_gene_id: 7157 });
  await w.finish({}, "hg19");
  assert.deepEqual(staged("lab_sample_profile").map((r) => [r.sample_id, r.profile_id, r.panel_id]), [["S3", "st_mutations", ""]]);
  const [m] = staged("lab_mutation");
  assert.deepEqual([m.profiled, m.panel_id, m.off_panel], [1, "", 0]);
  assert.deepEqual(staged("lab_case_list").map((r) => r.list_id), ["st_sequenced", "st_all"]);
  assert.deepEqual(staged("lab_case_list_sample").map((r) => [r.list_id, r.sample_id]), [["st_sequenced", "S3"], ["st_all", "S3"], ["st_all", "S4"]]);
});

test("a mutation of a sample never profiled is written as not profiled", async () => {
  const w = writer();
  await w.accept("genetic_profile", profile(1, "MUTATION_EXTENDED"));
  await w.accept("mutation_event", { mutation_event_id: 1, entrez_gene_id: 7157 });
  await w.accept("mutation", { mutation_event_id: 1, genetic_profile_id: 1, sample_id: 9, entrez_gene_id: 7157 });
  await w.finish({}, "hg19");
  const [m] = staged("lab_mutation");
  assert.deepEqual([m.sample_id, m.profiled, m.panel_id], ["S9", 0, ""]);
});

test("copy-number events carry gene, cytoband and panel; an event an earlier study created is looked up", async () => {
  const w = writer();
  await w.accept("genetic_profile", profile(2, "COPY_NUMBER_ALTERATION", "DISCRETE"));
  await w.accept("sample_profile", { sample_id: 1, genetic_profile_id: 2, panel_id: null });
  await w.accept("cna_event", { cna_event_id: 10, entrez_gene_id: 7157, alteration: -2 });
  await w.accept("sample_cna_event", { cna_event_id: 10, sample_id: 1, genetic_profile_id: 2 });
  await w.accept("sample_cna_event", { cna_event_id: 99, sample_id: 1, genetic_profile_id: 2 });
  await w.finish({}, "GRCh37'; DROP");
  const rows = staged("lab_cna_event").map((r) => [r.sample_id, r.patient_id, r.hugo_gene_symbol, r.cytoband, r.alteration, r.profiled, r.off_panel]);
  assert.deepEqual(rows, [["S1", "P1", "TP53", "17p13.1", -2, 1, 0], ["S1", "P1", "KRAS", "12p12.1", 2, 1, 0]]);
  assert.ok(ch!.statements.some((s) => /cna_event_id IN \(99\)/.test(s)), "only the events this import did not create are asked for");
  assert.ok(ch!.statements.some((s) => /WHERE g\.name = 'hg19'/.test(s)), "the cytobands are those of the study's reference genome");
});

test("a sample's copy-number event that no study created is an error", async () => {
  const w = writer();
  ch!.answer(/FROM cna_event WHERE/, []);
  await w.accept("genetic_profile", profile(2, "COPY_NUMBER_ALTERATION", "DISCRETE"));
  await w.accept("sample_cna_event", { cna_event_id: 100, sample_id: 1, genetic_profile_id: 2 });
  await assert.rejects(w.finish({}, "hg19"), /lab schema: unknown CNA event 100/);
});

test("structural variants are numbered in the order of their ids, with both partners' genes", async () => {
  const w = writer();
  await w.accept("genetic_profile", profile(3, "STRUCTURAL_VARIANT", "SV"));
  await w.accept("sample_profile", { sample_id: 1, genetic_profile_id: 3, panel_id: 7 });
  await w.accept("structural_variant", { internal_id: 8, genetic_profile_id: 3, sample_id: 1, site1_entrez_gene_id: 3845, site2_entrez_gene_id: null, event_info: "b" });
  await w.accept("structural_variant", { internal_id: 2, genetic_profile_id: 3, sample_id: 1, site1_entrez_gene_id: 7157, site2_entrez_gene_id: 673, event_info: "a" });
  await w.accept("alteration_driver_annotation", { alteration_event_id: 2, genetic_profile_id: 3, sample_id: 1, driver_filter: "Putative_Passenger" });
  await w.finish({}, "hg19");
  const sv = staged("lab_structural_variant").map((r) => [r.sv_index, r.event_info, r.site1_hugo_gene_symbol, r.site2_hugo_gene_symbol, r.site1_off_panel, r.site2_off_panel, r.has_driver]);
  assert.deepEqual(sv, [[0, "a", "TP53", "BRAF", 0, 1, 1], [1, "b", "KRAS", "", 1, 1, 0]]);
});

test("timeline events are numbered per import in id order and carry their key/value data", async () => {
  const w = writer();
  await w.accept("clinical_event", { clinical_event_id: 5, patient_id: 1, event_type: "TREATMENT", start_date: 10, stop_date: 20 });
  await w.accept("clinical_event", { clinical_event_id: 3, patient_id: 2, event_type: "STATUS", start_date: 0, stop_date: null });
  await w.accept("clinical_event_data", { clinical_event_id: 5, key: "AGENT", value: "Drug" });
  await w.accept("clinical_event_data", { clinical_event_id: 404, key: "LOST", value: "x" });
  await w.finish({}, "hg19");
  assert.deepEqual(staged("lab_timeline_event").map((r) => [r.event_index, r.patient_id, r.event_type, r.data]),
    [[0, "P2", "STATUS", {}], [1, "P1", "TREATMENT", { AGENT: "Drug" }]]);
});

test("segments keep their sample's id; the segment-file row writes nothing", async () => {
  const w = writer();
  await w.accept("copy_number_seg_file", { seg_file_id: 1 });
  await w.accept("copy_number_seg", { sample_id: 2, chr: "1", start: 100, end: 200, num_probes: 4, segment_mean: -0.5 });
  await w.finish({}, "hg19");
  assert.deepEqual(strip(staged("lab_segment")), [{ study_id: "st", sample_id: "S2", chr: "1", start: 100, end: 200, num_probes: 4, segment_mean: -0.5, is_deleted: 0 }]);
});

test("matrix values are one row per gene, in the profile's sample order, expanded to cells on the server", async () => {
  const w = writer();
  await w.accept("genetic_profile", profile(4, "MRNA_EXPRESSION", "Z-SCORE"));
  await w.accept("genetic_profile_samples", { genetic_profile_id: 4, ordered_sample_list: "2,1," });
  await w.accept("genetic_alteration", { genetic_profile_id: 4, genetic_entity_id: 1, values: "1.5,-0.3," });
  await w.accept("genetic_alteration", { genetic_profile_id: 4, genetic_entity_id: 2, values: "NA,2" });
  await w.finish({}, "hg19");
  const rows = ch!.tables().filter((t) => t.startsWith("lab_profile_value_stage_")).flatMap((t) => ch!.rows(t));
  assert.deepEqual(rows.map((r) => [r.profile_id, r.hugo_gene_symbol, r.entrez_gene_id, r.samples, r.values]),
    [["st_mrna", "TP53", 7157, ["S2", "S1"], ["1.5", "-0.3"]], ["st_mrna", "KRAS", 3845, ["S2", "S1"], ["NA", "2"]]]);
  assert.ok(ch!.statements.some((s) => /ARRAY JOIN samples AS s, values AS v/.test(s)));
});

test("rows the lab_ schema cannot hold are refused loudly", async () => {
  const w = writer();
  await assert.rejects(w.accept("genetic_alteration", { genetic_profile_id: 4, genetic_entity_id: 1, values: "1" }), /lab schema: data for profile 4 before the profile/);
  await w.accept("genetic_profile", profile(5, "GENERIC_ASSAY", "LIMIT-VALUE"));
  await assert.rejects(w.accept("genetic_alteration", { genetic_profile_id: 5, genetic_entity_id: 1, values: "1" }),
    /GENERIC_ASSAY profile st_ga has matrix values, which lab_profile_value does not hold/);
  await assert.rejects(w.accept("mutsig", { x: 1 }), /lab schema: no translation for rows of mutsig/);
});

test("finish merges the staged rows into the lab_ tables and drops every staging table", async () => {
  const w = writer();
  await w.accept("patient", { internal_id: 1, stable_id: "P1" });
  await w.finish({}, "hg19");
  const stages = ch!.statements.filter((s) => /^CREATE TABLE lab_\w+_stage_/.test(s)).length;
  assert.equal(stages, ch!.statements.filter((s) => /^DROP TABLE IF EXISTS lab_\w+_stage_/.test(s)).length - stages,
    "each staging table is dropped once before it is made and once after the merge");
  // the lab_ tables are empty in the fake, so the staged rows go in whole
  assert.ok(ch!.statements.some((s) => /^INSERT INTO lab_patient SELECT \* FROM lab_patient_stage_/.test(s)));
});

test("an update (scope 'samples') replaces only its samples' rows, and only in the tables it supplied data for", async () => {
  const w = writer({ sampleIds: () => ["S1"], patientIds: () => ["P1"] });
  ch!.answer(/SELECT count\(\) AS n FROM lab_\w+ WHERE study_id = 'st'$/m, [{ n: 5 }]);
  w.scope = "samples";
  await w.accept("genetic_profile", profile(1, "MUTATION_EXTENDED"));
  await w.accept("sample", { internal_id: 1, stable_id: "S1", patient_id: 1, sample_type: "Primary" });
  await w.finish({}, "hg19");
  const deletes = (t: string) => ch!.statements.find((s) => new RegExp("^INSERT INTO " + t + " \\(").test(s) && /, 1 FROM/.test(s))!;
  assert.match(deletes("lab_sample"), /patient_id IN \('P1'\), sample_id IN \('S1'\)\)/);
  // a mutation profile comes from a mutation file: the sample's mutations in that profile are replaced (none left means none)
  assert.match(deletes("lab_mutation"), /sample_id IN \('S1'\)\) AND profile_id IN \('st_mutations'\) AND/);
  assert.match(deletes("lab_segment"), /AND 0 AND/, "no segment file: nothing replaced");
  // study-level rows are only added where the study lacks their key, never marked deleted
  assert.ok(ch!.statements.some((s) => /^INSERT INTO lab_profile SELECT \* FROM lab_profile_stage_\S+ WHERE tuple\(study_id, profile_id\) NOT IN/.test(s)));
  assert.ok(!ch!.statements.some((s) => /^INSERT INTO lab_profile \(/.test(s)));
});
