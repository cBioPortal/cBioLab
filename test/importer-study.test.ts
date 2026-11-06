// A whole study folder through lib/importer/import-study.ts: the legacy loader's order, the files
// it leaves out and why, the generated case lists, the computed attributes and the study's
// precomputed counts; the schema modes (docs/LOCAL.md "Schema modes": legacy tables, lab_ tables,
// an update of some samples); and removing a study. ClickHouse is test/support/fake-ch.ts.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fakeCh, studyDir, type FakeCh } from "./support/fake-ch.ts";
import { deleteStudy, importStudy, rebuildDerived, removeStudy } from "../lib/importer/import-study.ts";

let ch: FakeCh | null = null;
afterEach(() => { ch?.restore(); ch = null; });

type Row = Record<string, unknown>;
const GENE_ROWS = [{ e: 7157, h: "TP53", t: "protein-coding", g: 7157 }, { e: 3845, h: "KRAS", t: "protein-coding", g: 3845 }];

/** a fake ClickHouse holding two genes, in schema mode `mode` */
function database(mode: "legacy" | "new" | "both" = "legacy"): FakeCh {
  ch = fakeCh();
  ch.answer(/AS g FROM gene\b/, GENE_ROWS);
  if (mode !== "legacy") {
    ch.answer(/name = 'cbiolab_schema'/, [{ n: 1 }]);
    ch.answer(/argMax\(mode, at\)/, [{ m: mode }]);
  }
  return ch;
}

function clinical(cols: string[], rows: string[][]): string {
  const meta = [cols, cols, cols.map(() => "STRING"), cols.map(() => "1")];
  return meta.map((m) => "#" + m.join("\t")).join("\n") + "\n" + cols.join("\t") + "\n" + rows.map((r) => r.join("\t")).join("\n") + "\n";
}
const meta = (o: Record<string, string>) => Object.entries({ cancer_study_identifier: "st", ...o }).map(([k, v]) => k + ": " + v).join("\n") + "\n";
const matrixMeta = (type: string, stable: string, file: string) =>
  meta({ genetic_alteration_type: type, datatype: "CONTINUOUS", stable_id: stable, profile_name: stable, profile_description: "d", show_profile_in_analysis_tab: "false", data_filename: file });
const MAF_HEAD = "Hugo_Symbol\tEntrez_Gene_Id\tTumor_Sample_Barcode\tVariant_Classification\tChromosome\tStart_Position\tEnd_Position\tReference_Allele\tTumor_Seq_Allele2\tHGVSp_Short\n";

/** S1–S3 of patients P1, P1, P2; mutations in S1 and S2, CNA in S1 and S3, four matrix profiles, a timeline, segments */
function fullStudy(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "meta_study.txt": "type_of_cancer: newtype\ncancer_study_identifier: st\nname: Study\ndescription: d\nreference_genome: GRCh38\n",
    "meta_cancer_type.txt": "genetic_alteration_type: CANCER_TYPE\ndatatype: CANCER_TYPE\ndata_filename: ct.txt\n",
    "ct.txt": "brca\tBreast\tHotPink\ttissue\ncoad\t\t\t\n",
    "meta_cs.txt": meta({ genetic_alteration_type: "CLINICAL", datatype: "SAMPLE_ATTRIBUTES", data_filename: "cs.txt" }),
    "cs.txt": clinical(["PATIENT_ID", "SAMPLE_ID", "GRADE"], [["P1", "S1", "1"], ["P1", "S2", "2"], ["P2", "S3", "3"]]),
    "meta_cp.txt": meta({ genetic_alteration_type: "CLINICAL", datatype: "PATIENT_ATTRIBUTES", data_filename: "cp.txt" }),
    "cp.txt": clinical(["PATIENT_ID", "SEX"], [["P1", "F"], ["P2", "M"]]),
    "meta_mut.txt": meta({ genetic_alteration_type: "MUTATION_EXTENDED", datatype: "MAF", stable_id: "mutations", profile_name: "Mutations", profile_description: "d", show_profile_in_analysis_tab: "true", data_filename: "mut.txt" }),
    "mut.txt": MAF_HEAD + "TP53\t7157\tS1\tMissense_Mutation\t17\t100\t100\tC\tT\tp.R1H\nKRAS\t3845\tS1\tMissense_Mutation\t12\t200\t200\tC\tT\tp.G12D\nTP53\t7157\tS2\tMissense_Mutation\t17\t300\t300\tC\tT\tp.R3H\n",
    "meta_cna.txt": meta({ genetic_alteration_type: "COPY_NUMBER_ALTERATION", datatype: "DISCRETE", stable_id: "gistic", profile_name: "CNA", profile_description: "d", show_profile_in_analysis_tab: "true", data_filename: "cna.txt" }),
    "cna.txt": "Hugo_Symbol\tS1\tS3\nTP53\t-2\t0\n",
    "meta_rnaseq.txt": matrixMeta("MRNA_EXPRESSION", "rna_seq_mrna", "rnaseq.txt"),
    "rnaseq.txt": "Hugo_Symbol\tS1\nTP53\t5\n",
    "meta_mrna.txt": matrixMeta("MRNA_EXPRESSION", "mrna", "mrna.txt"),
    "mrna.txt": "Hugo_Symbol\tS1\tS2\nTP53\t1\t2\n",
    "meta_rppa.txt": matrixMeta("PROTEIN_LEVEL", "rppa", "rppa.txt"),
    "rppa.txt": "Composite.Element.REF\tS3\nTP53|TP53\t0.5\n",
    "meta_ms.txt": matrixMeta("PROTEIN_LEVEL", "protein_quantification_ms_abundance", "ms.txt"),
    "ms.txt": "Composite.Element.REF\tS2\tS3\nTP53|TP53\t0.5\t1\n",
    "meta_tl.txt": meta({ genetic_alteration_type: "CLINICAL", datatype: "TIMELINE", data_filename: "tl.txt" }),
    "tl.txt": "PATIENT_ID\tSTART_DATE\tSTOP_DATE\tEVENT_TYPE\tAGENT\nP1\t10\t20\tTreatment\tX\nP2\t5\t\tSTATUS\t\n",
    "meta_seg.txt": meta({ genetic_alteration_type: "COPY_NUMBER_ALTERATION", datatype: "SEG", reference_genome_id: "hg19", description: "segs", data_filename: "seg.txt" }),
    "seg.txt": "ID\tchrom\tloc.start\tloc.end\tnum.mark\tseg.mean\nS1\t1\t1\t1000\t10\t0.5\nS1\t2\t1\t1000\t10\t0.01\n",
    "meta_ga.txt": meta({ genetic_alteration_type: "GENERIC_ASSAY", datatype: "LIMIT-VALUE", data_filename: "ga.txt" }),
    "ga.txt": "ENTITY_STABLE_ID\tS1\nX\t1\n",
    "meta_bad.txt": meta({ genetic_alteration_type: "MUTATION_EXTENDED", datatype: "MAF", stable_id: "mutations2", data_filename: "bad.txt" }),
    "bad.txt": "Foo\tBar\n1\t2\n",
    "notes.tsv": "anything\n",
    ...extra,
  };
}

const listOf = (c: FakeCh, stable: string) => {
  const l = c.rows("sample_list").find((r) => r.stable_id === stable);
  if (!l) return undefined;
  const stableOf = new Map(c.rows("sample").map((s) => [s.internal_id, s.stable_id]));
  return c.rows("sample_list_list").filter((r) => r.list_id === l.list_id).map((r) => stableOf.get(r.sample_id)).sort();
};
const counts = (c: FakeCh) => {
  const st = c.statements.find((s) => s.startsWith("ALTER TABLE cancer_study UPDATE "))!;
  return Object.fromEntries(st.replace("ALTER TABLE cancer_study UPDATE ", "").replace(/ WHERE .*$/s, "").split(", ").map((kv) => kv.split(" = ")).map(([k, v]) => [k, Number(v)]));
};

test("a legacy import: files in the loader's order, what was left out and why, and the study row", async () => {
  const c = database();
  const steps: string[] = [];
  const r = await importStudy(c.conn, "/nonexistent", studyDir(fullStudy()), "fallback", (p) => steps.push(p.step), false, false);
  assert.equal(r.studyId, "st");
  assert.equal(r.name, "Study");
  assert.equal(r.patients, 2);
  assert.equal(r.samples, 3);
  assert.ok(steps.includes("Removing any earlier import of st"), "a legacy import replaces the study");
  assert.ok(!steps.includes("Building the derived tables"), "derive = false skips the derived tables");
  const left = Object.fromEntries(r.notImported.map((n) => [n.file, n.reason]));
  assert.match(left["ga.txt"], /GENERIC_ASSAY \/ LIMIT-VALUE is not imported yet/);
  assert.match(left["bad.txt"], /bad.txt has no Tumor_Sample_Barcode column/, "a failing data file is reported and skipped");
  assert.equal(left["notes.tsv"], "no meta file describes it and its name is not a standard one");
  const [study] = c.rows("cancer_study");
  assert.deepEqual([study.cancer_study_identifier, study.type_of_cancer_id, study.name, study.description, study.cancer_study_id], ["st", "newtype", "Study", "d", 1]);
  // the cancer type file's rows (blank name, color, parent defaulted), and the study's unknown type added with a warning
  assert.deepEqual(c.rows("type_of_cancer").map((t) => [t.type_of_cancer_id, t.name, t.dedicated_color, t.parent]),
    [["brca", "Breast", "HotPink", "tissue"], ["coad", "coad", "Gray", "tissue"], ["newtype", "newtype", "Gray", "tissue"]]);
  assert.ok(r.warnings.includes("cancer type newtype is not a known type; added as is"));
  assert.ok(c.statements.some((s) => /FROM reference_genome WHERE name = 'grch38'/.test(s)), "the reference genome is looked up lowercased");
});

test("profiles get <study>_<stable_id>; case lists _all, _sequenced, _cna and _cnaseq are generated from the data", async () => {
  const c = database();
  await importStudy(c.conn, "/nonexistent", studyDir(fullStudy()), "st", () => {}, false, false);
  const profiles = c.rows("genetic_profile").map((p) => [p.stable_id, p.genetic_alteration_type, p.datatype]);
  assert.deepEqual(profiles.find((p) => p[0] === "st_mutations"), ["st_mutations", "MUTATION_EXTENDED", "MAF"]);
  assert.deepEqual(profiles.find((p) => p[0] === "st_gistic"), ["st_gistic", "COPY_NUMBER_ALTERATION", "DISCRETE"]);
  assert.deepEqual(listOf(c, "st_all"), ["S1", "S2", "S3"]);
  assert.deepEqual(listOf(c, "st_sequenced"), ["S1", "S2"]);
  assert.deepEqual(listOf(c, "st_cna"), ["S1", "S3"]);
  assert.deepEqual(listOf(c, "st_cnaseq"), ["S1"]);
  assert.equal(listOf(c, "st_sv"), undefined, "no structural variant data: no _sv list");
  assert.equal(c.rows("sample_list").find((l) => l.stable_id === "st_cnaseq")?.category, "all_cases_with_mutation_and_cna_data");
});

test("MUTATION_COUNT, FRACTION_GENOME_ALTERED and SAMPLE_COUNT are computed, with their attribute metadata", async () => {
  const c = database();
  await importStudy(c.conn, "/nonexistent", studyDir(fullStudy()), "st", () => {}, false, false);
  const id = new Map(c.rows("sample").map((s) => [s.stable_id, s.internal_id]));
  const pid = new Map(c.rows("patient").map((s) => [s.stable_id, s.internal_id]));
  const value = (table: string, attr: string, internal: unknown) => c.rows(table).find((r) => r.attr_id === attr && r.internal_id === internal)?.attr_value;
  assert.equal(value("clinical_sample", "MUTATION_COUNT", id.get("S1")), "2");
  assert.equal(value("clinical_sample", "MUTATION_COUNT", id.get("S2")), "1");
  assert.equal(value("clinical_sample", "MUTATION_COUNT", id.get("S3")), undefined, "S3 is not profiled for mutations");
  assert.ok(value("clinical_sample", "FRACTION_GENOME_ALTERED", id.get("S1")) !== undefined);
  assert.equal(value("clinical_patient", "SAMPLE_COUNT", pid.get("P1")), "2");
  assert.equal(value("clinical_patient", "SAMPLE_COUNT", pid.get("P2")), "1");
  const metas = Object.fromEntries(c.rows("clinical_attribute_meta").map((m) => [m.attr_id, [m.datatype, m.patient_attribute, m.priority]]));
  assert.deepEqual(metas.MUTATION_COUNT, ["NUMBER", 0, "30"]);
  assert.deepEqual(metas.FRACTION_GENOME_ALTERED, ["NUMBER", 0, "20"]);
  assert.deepEqual(metas.SAMPLE_COUNT, ["STRING", 1, "1"]);
});

test("the study's precomputed counts are written onto cancer_study, by profile type and stable id", async () => {
  const c = database();
  await importStudy(c.conn, "/nonexistent", studyDir(fullStudy()), "st", () => {}, false, false);
  assert.deepEqual(counts(c), {
    sample_count: 3, mutation_sample_count: 2, cna_sample_count: 2, structural_variant_sample_count: 0,
    rna_seq_sample_count: 1, mrna_microarray_sample_count: 2, mrna_expression_sample_count: 2,
    rppa_sample_count: 1, mass_spectrometry_sample_count: 2, treatment_patient_count: 1,
  });
});

test("an attribute a file defines is not defined again by the computed ones", async () => {
  const c = database();
  const files = fullStudy({ "cp.txt": clinical(["PATIENT_ID", "SAMPLE_COUNT"], [["P1", "9"], ["P2", "9"]]) });
  await importStudy(c.conn, "/nonexistent", studyDir(files), "st", () => {}, false, false);
  assert.equal(c.rows("clinical_attribute_meta").filter((m) => m.attr_id === "SAMPLE_COUNT").length, 1);
});

test("samples only in data files are created and reported", async () => {
  const c = database();
  const r = await importStudy(c.conn, "/nonexistent", studyDir({
    "meta_study.txt": "type_of_cancer: brca\ncancer_study_identifier: st\nname: St\ndescription: d\n",
    "meta_mrna.txt": matrixMeta("MRNA_EXPRESSION", "mrna", "mrna.txt"), "mrna.txt": "Hugo_Symbol\tX1\tX2\nTP53\t1\t2\n",
  }), "st", () => {}, false, false);
  assert.equal(r.samples, 2);
  assert.match(r.warnings.join("\n"), /2 samples appear in data files but not in a clinical sample file; .* \(e\.g\. X1, X2\)/);
});

test("a failing clinical file stops the import: clinical files define the study", async () => {
  const c = database();
  await assert.rejects(importStudy(c.conn, "/nonexistent", studyDir({
    "meta_study.txt": "type_of_cancer: brca\ncancer_study_identifier: st\nname: St\ndescription: d\n",
    "meta_cs.txt": meta({ genetic_alteration_type: "CLINICAL", datatype: "SAMPLE_ATTRIBUTES", data_filename: "cs.txt" }),
    "cs.txt": clinical(["GRADE"], [["1"]]),
  }), "st", () => {}, false, false));
});

test("a study id that is not letters, digits, _ . - is refused before anything is written", async () => {
  const c = database();
  await assert.rejects(importStudy(c.conn, "/nonexistent", studyDir({ "meta_study.txt": "type_of_cancer: brca\ncancer_study_identifier: bad id\nname: x\n" }), "st", () => {}),
    /cancer_study_identifier of letters, digits, _ \. -/);
  assert.equal(c.statements.length, 0);
});

test("an update of some samples needs a database in the new schema", async () => {
  const c = database("both");
  await assert.rejects(importStudy(c.conn, "/nonexistent", studyDir(fullStudy()), "st", () => {}, true, false),
    /needs a database in the new schema \(--schema new\); this one is both/);
});

/** a data folder already holding the derived-table script, so nothing is downloaded */
function dataDir(script: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "importer-data-"));
  mkdirSync(path.join(dir, "upstream"));
  writeFileSync(path.join(dir, "upstream", "populate_derived_tables.sql"), script);
  return dir;
}

test("with derive, a legacy import runs cBioPortal's derived-table script, statement by statement", async () => {
  const c = database();
  const steps: string[] = [];
  await importStudy(c.conn, dataDir("-- derived\nSELECT 1;\nSELECT 2;\n"), studyDir(fullStudy()), "st", (p) => steps.push(p.step), false, true);
  assert.ok(steps.includes("Building the derived tables"));
  const i = c.statements.indexOf("SELECT 1");
  assert.ok(i >= 0 && c.statements[i + 1] === "SELECT 2", "the script's statements run in order");
  assert.ok(c.statements.findIndex((s) => s.startsWith("ALTER TABLE cancer_study UPDATE")) > i, "counts are written after the derived tables");
});

test("a new-schema import writes the lab_ tables, merges them, and touches no legacy table", async () => {
  const c = database("new");
  const steps: string[] = [];
  await importStudy(c.conn, dataDir("SELECT 'derived';\n"), studyDir(fullStudy()), "st", (p) => steps.push(p.step), false, true);
  assert.ok(!steps.includes("Removing any earlier import of st"), "the lab_ tables replace only what changed");
  assert.ok(!steps.includes("Building the derived tables"));
  assert.ok(steps.includes("Writing the lab_ tables") && steps.includes("Merging the study's new rows into its partitions"));
  assert.ok(c.statements.some((s) => /name LIKE 'lab\\_%\\_stage\\_%'/.test(s)), "stale staging tables are looked for first");
  assert.ok(!c.statements.some((s) => s.startsWith("ALTER TABLE cancer_study UPDATE")));
  assert.ok(!c.statements.includes("SELECT 'derived'"));
  assert.ok(!c.tables().includes("cancer_study") && !c.tables().includes("sample"), "no legacy table gets rows");
  const staged = (t: string) => c.tables().filter((x) => x.startsWith(t + "_stage_")).flatMap((x) => c.rows(x));
  assert.deepEqual(staged("lab_sample").map((s) => s.sample_id).sort(), ["S1", "S2", "S3"]);
  const [study] = staged("lab_study");
  assert.deepEqual([study.study_id, study.reference_genome, study.sample_count, study.mutation_sample_count], ["st", "grch38", 3, 2]);
  assert.ok(c.statements.some((s) => /FROM system\.parts/.test(s) && /partition = 'st'/.test(s)), "the study's partitions are compacted");
});

test("an update in the new schema merges only its samples and recomputes the study's counts and SAMPLE_COUNT", async () => {
  const c = database("new");
  c.answer(/SELECT count\(\) AS n FROM lab_\w+ WHERE study_id = 'st'$/m, [{ n: 10 }]);
  await importStudy(c.conn, "/nonexistent", studyDir({
    "meta_study.txt": "type_of_cancer: brca\ncancer_study_identifier: st\nname: St\ndescription: d\n",
    "meta_cs.txt": meta({ genetic_alteration_type: "CLINICAL", datatype: "SAMPLE_ATTRIBUTES", data_filename: "cs.txt" }),
    "cs.txt": clinical(["PATIENT_ID", "SAMPLE_ID", "GRADE"], [["P9", "S9", "1"]]),
  }), "st", () => {}, true, false);
  const deletion = c.statements.find((s) => /^INSERT INTO lab_sample \(/.test(s) && /, 1 FROM lab_sample FINAL/.test(s))!;
  assert.match(deletion, /sample_id IN \('S9'\)/);
  assert.ok(c.statements.some((s) => /^INSERT INTO lab_study \(/.test(s) && /toUInt32\(\(SELECT count\(\) FROM lab_sample FINAL WHERE study_id = 'st'\)\) AS sample_count/.test(s)));
  assert.ok(c.statements.some((s) => /'SAMPLE_COUNT'/.test(s) && /patient_id IN \('P9'\)/.test(s)));
});

test("removing a legacy study deletes its rows table by table, the study row last", async () => {
  const c = database();
  c.answer(/SELECT cancer_study_id AS i FROM cancer_study WHERE cancer_study_identifier = 'st'/, [{ i: 4 }]);
  assert.equal(await removeStudy(c.conn, "st", "legacy"), true);
  const deletes = c.statements.filter((s) => s.startsWith("DELETE FROM "));
  assert.equal(deletes.length, 21);
  assert.equal(deletes.at(-1), "DELETE FROM cancer_study WHERE cancer_study_id = 4");
  assert.ok(deletes.indexOf(deletes.find((s) => s.startsWith("DELETE FROM mutation_event"))!) < deletes.indexOf(deletes.find((s) => s.startsWith("DELETE FROM mutation "))!),
    "events are found through their mutations, so they go first");
  assert.ok(!c.statements.some((s) => /DROP PARTITION/.test(s)), "legacy mode has no lab_ tables");
});

test("removing a study that is not there removes nothing", async () => {
  const c = database();
  assert.equal(await removeStudy(c.conn, "nope", "legacy"), false);
  assert.ok(!c.statements.some((s) => s.startsWith("DELETE")));
});

test("in the new schema a study is removed by dropping its partitions; deleting it drops its review copy too", async () => {
  const c = database("new");
  c.answer(/FROM lab_study WHERE study_id = 'st'$/m, [{ n: 1 }]);
  c.answer(/SELECT name AS t FROM system\.tables/, [{ t: "lab_sample" }, { t: "lab_review" }, { t: "lab_sample_previous" }]);
  assert.equal(await deleteStudy(c.conn, "/nonexistent", "st"), true);
  const drops = c.statements.filter((s) => /DROP PARTITION/.test(s));
  assert.deepEqual(drops, [
    "ALTER TABLE lab_sample DROP PARTITION 'st'", "ALTER TABLE lab_review DROP PARTITION 'st'", "ALTER TABLE lab_sample_previous DROP PARTITION 'st'",
    "ALTER TABLE lab_sample DROP PARTITION 'st__review'", "ALTER TABLE lab_review DROP PARTITION 'st__review'", "ALTER TABLE lab_sample_previous DROP PARTITION 'st__review'",
  ]);
  assert.ok(!c.statements.some((s) => s.startsWith("DELETE")));
});

test("deleting a legacy study rebuilds the derived tables; nothing removed, nothing rebuilt", async () => {
  const c = database();
  assert.equal(await deleteStudy(c.conn, dataDir("SELECT 'rebuilt';\n"), "nope"), false);
  assert.ok(!c.statements.includes("SELECT 'rebuilt'"));
  c.answer(/cancer_study_identifier = 'st'/, [{ i: 1 }]);
  assert.equal(await deleteStudy(c.conn, dataDir("SELECT 'rebuilt';\n"), "st"), true);
  assert.ok(c.statements.includes("SELECT 'rebuilt'"));
});

test("the derived tables are not rebuilt in the new schema, which has views instead", async () => {
  const c = database("new");
  await rebuildDerived(c.conn, dataDir("SELECT 'rebuilt';\n"));
  assert.ok(!c.statements.includes("SELECT 'rebuilt'"));
});

// both schema modes write legacy rows and lab_ rows from one import
test("the 'both' schema writes the legacy tables and stages the lab_ tables from the same import", async () => {
  const c = database("both");
  await importStudy(c.conn, "/nonexistent", studyDir(fullStudy()), "st", () => {}, false, false);
  assert.equal(c.rows("sample").length, 3);
  const staged: Row[] = c.tables().filter((x) => x.startsWith("lab_sample_stage_")).flatMap((x) => c.rows(x));
  assert.equal(staged.length, 3);
  assert.ok(c.statements.some((s) => s.startsWith("ALTER TABLE cancer_study UPDATE")));
});

test("a study's case list naming a patient takes all its samples; a shipped panel's problem is a warning; SV data gets an _sv list", async () => {
  const c = database();
  c.answer(/AS s, internal_id AS i FROM gene_panel/, () => c.rows("gene_panel").map((p) => ({ s: p.stable_id, i: p.internal_id })));
  const sv = "Sample_Id\tSV_Status\tSite1_Hugo_Symbol\tSite1_Entrez_Gene_Id\tSite2_Hugo_Symbol\tSite2_Entrez_Gene_Id\tEvent_Info\n" +
    "S3\tSOMATIC\tTP53\t7157\tKRAS\t3845\tfusion\n";
  const r = await importStudy(c.conn, "/nonexistent", studyDir(fullStudy({
    "meta_sv.txt": meta({ genetic_alteration_type: "STRUCTURAL_VARIANT", datatype: "SV", stable_id: "structural_variants", profile_name: "SV", profile_description: "d", show_profile_in_analysis_tab: "true", data_filename: "sv.txt" }),
    "sv.txt": sv,
    "data_gene_panel_small.txt": "stable_id: SMALL\ndescription: d\ngene_list: TP53\tNOTAGENE\n",
    "case_lists/cases_mine.txt": "cancer_study_identifier: st\nstable_id: st_mine\ncase_list_name: Mine\ncase_list_description: m\ncase_list_category: other\ncase_list_ids: P1\tS3\tNOBODY\n",
  })), "st", () => {}, false, false);
  assert.deepEqual(listOf(c, "st_mine"), ["S1", "S2", "S3"]);
  assert.deepEqual(listOf(c, "st_sv"), ["S3"]);
  assert.equal(counts(c).structural_variant_sample_count, 1);
  // a shipped panel listing an unknown gene is not imported, and the import says so
  assert.ok(!c.rows("gene_panel").some((p) => p.stable_id === "SMALL"));
  assert.ok(r.warnings.includes("panel SMALL not imported: unknown genes NOTAGENE"));
});
