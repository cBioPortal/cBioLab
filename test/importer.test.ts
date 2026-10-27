// The importer's row rules (lib/importer/), each pinned to the legacy behaviour it copies
// (notes in the import session: legacy-java-importer.md). These decide which rows a study keeps
// and what they say, so a change here changes counts and frequencies in every view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { filteredClassification, filteredStatus, mafChromosome, proteinChange, proteinPositions, tumorAllele } from "../lib/importer/mutations.ts";
import { isMissing, survivalValue } from "../lib/importer/clinical.ts";
import { cnaEventValue } from "../lib/importer/matrix.ts";
import { fractionGenomeAltered } from "../lib/importer/other.ts";
import { isNormalBarcode, sampleId, tcgaPatient } from "../lib/importer/context.ts";
import { GeneResolver } from "../lib/importer/genes.ts";
import { parseMeta, readStudyFolder } from "../lib/importer/study.ts";

test("default classification filter: prefix, case-insensitive, 5'Flank kept for TERT only", () => {
  for (const vc of ["Silent", "silent", "Intron", "3'UTR", "3'Flank", "5'UTR", "IGR"]) assert.equal(filteredClassification(vc, 1, null), true, vc);
  for (const vc of ["Missense_Mutation", "Splice_Region", "Targeted_Region", "Nonsense_Mutation"]) assert.equal(filteredClassification(vc, 1, null), false, vc);
  assert.equal(filteredClassification("5'Flank", 7015, null), false);
  assert.equal(filteredClassification("5'Flank", 7157, null), true);
});

test("a meta variant_classification_filter replaces the default list and matches exactly", () => {
  const custom = new Set(["Silent"]);
  assert.equal(filteredClassification("Silent", 1, custom), true);
  assert.equal(filteredClassification("silent", 1, custom), false);
  assert.equal(filteredClassification("Intron", 1, custom), false);
  assert.equal(filteredClassification("5'Flank", 7157, custom), false);
});

test("status filters drop wildtype, redacted, LOH and None rows; germline stays", () => {
  assert.ok(filteredStatus("Wildtype", "Somatic"));
  assert.ok(filteredStatus("Redacted", "Somatic"));
  assert.ok(filteredStatus("", "LOH"));
  assert.ok(filteredStatus("", "Nonesuch"));
  assert.equal(filteredStatus("Valid", "Germline"), null);
  assert.equal(filteredStatus("", "Somatic"), null);
});

test("mutation chromosomes: chr prefix dropped, X/Y stored as 23/24, odd contigs refused", () => {
  assert.equal(mafChromosome("chr7"), "7");
  assert.equal(mafChromosome("X"), "23");
  assert.equal(mafChromosome("chrY"), "24");
  assert.equal(mafChromosome(""), "NA");
  assert.equal(mafChromosome("M"), null);
  assert.equal(mafChromosome("GL000220.1"), null);
});

test("protein change falls back from HGVSp_Short to Amino_Acid_Change to MUTATED", () => {
  assert.equal(proteinChange("p.G12D", ""), "G12D");
  assert.equal(proteinChange("", "p.V600E"), "V600E");
  assert.equal(proteinChange("[Not Available]", "NA"), "MUTATED");
  assert.deepEqual(proteinPositions("12/189", "G12D"), [12, 12]);
  assert.deepEqual(proteinPositions("", "E746_A750del"), [746, 750]);
  assert.deepEqual(proteinPositions("", "MUTATED"), [-1, -1]);
});

test("the tumor allele is the one that differs from the reference", () => {
  assert.equal(tumorAllele("G", "G", "A"), "A");
  assert.equal(tumorAllele("G", "T", "G"), "T");
  assert.equal(tumorAllele("-", "-", "AT"), "AT");
  assert.equal(tumorAllele("C", "", ""), "");
});

test("clinical missing values are not stored; survival statuses get their prefix", () => {
  for (const v of ["", "NA", "na", "[Not Available]", "not applicable", "Completed", "NULL", "N|A", "[Pending]"]) assert.equal(isMissing(v), true, v);
  for (const v of ["N/A", "Unknown", ".", "0"]) assert.equal(isMissing(v), false, v);
  assert.equal(survivalValue("OS_STATUS", "DECEASED"), "1:DECEASED");
  assert.equal(survivalValue("OS_STATUS", "Living"), "0:Living");
  assert.equal(survivalValue("DFS_STATUS", "Recurred/Progressed"), "1:Recurred/Progressed");
  assert.equal(survivalValue("OS_STATUS", "1:DECEASED"), "1:DECEASED");
  assert.equal(survivalValue("PFS_STATUS", "Progressed"), "Progressed");
});

test("CNA events only for exactly 2 and -2, with -1.5 counted as -2", () => {
  assert.equal(cnaEventValue("2"), 2);
  assert.equal(cnaEventValue("-2"), -2);
  assert.equal(cnaEventValue("-1.5"), -2);
  for (const v of ["1", "-1", "0", "2.0", "-2.0", "NA", ""]) assert.equal(cnaEventValue(v), null, v);
});

test("fraction genome altered: 4 decimals, half up", () => {
  assert.equal(fractionGenomeAltered(100_000, 1_000_000), "0.1000");
  assert.equal(fractionGenomeAltered(1, 3), "0.3333");
  assert.equal(fractionGenomeAltered(12345, 100000000), "0.0001");
  assert.equal(fractionGenomeAltered(0, 5), "0.0000");
});

test("TCGA barcodes are cut to sample and patient ids; normal tissue is recognised", () => {
  assert.equal(sampleId("TCGA-OR-A5J1-01A-11D-A29I-10"), "TCGA-OR-A5J1-01");
  assert.equal(sampleId("TCGA-OR-A5J1"), "TCGA-OR-A5J1-01");
  assert.equal(sampleId("P-0000043-T02-IM3"), "P-0000043-T02-IM3");
  assert.equal(tcgaPatient("TCGA-OR-A5J1-01"), "TCGA-OR-A5J1");
  assert.equal(isNormalBarcode("TCGA-OR-A5J1-10A"), true);
  assert.equal(isNormalBarcode("TCGA-OR-A5J1-11"), true);
  assert.equal(isNormalBarcode("TCGA-OR-A5J1-01"), false);
});

test("gene resolution differs by file type, as the legacy importer's does", () => {
  const g = GeneResolver.fromRows(
    [{ entrez: 7157, hugo: "TP53", type: "protein-coding", entityId: 1 }, { entrez: 8085, hugo: "KMT2D", type: "protein-coding", entityId: 2 },
      { entrez: 58508, hugo: "KMT2C", type: "protein-coding", entityId: 3 }, { entrez: 1956, hugo: "EGFR", type: "protein-coding", entityId: 4 }],
    [{ entrez: 7157, alias: "P53" }, { entrez: 8085, alias: "MLL2" }, { entrez: 58508, alias: "MLL2" }, { entrez: 1956, alias: "ERBB" }]);
  // MAF: a known Entrez id wins, an unknown one drops the row, 0 falls back to the symbol
  assert.equal(g.forMaf("EGFR", "7157")?.hugo, "TP53");
  assert.equal(g.forMaf("TP53", "99999999"), null);
  assert.equal(g.forMaf("p53", "0")?.hugo, "TP53");
  assert.equal(g.forMaf("Unknown", "0"), null);
  // an ambiguous alias: the MAF path uses the disambiguation file, the matrix path drops the row
  assert.equal(g.forMaf("MLL2", "")?.entrez, 8085);
  assert.equal(g.forMatrix("MLL2", ""), null);
  // matrix: an unknown numeric Entrez falls back to the symbol; `|` truncates; `///` drops
  assert.equal(g.forMatrix("EGFR", "12345678")?.entrez, 1956);
  assert.equal(g.forMatrix("EGFR|1956", "")?.entrez, 1956);
  assert.equal(g.forMatrix("EGFR///TP53", "1956"), null);
});

test("a folder of standard-named files without meta files is read as a study", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cbiolab-import-"));
  await writeFile(path.join(dir, "data_clinical_sample.txt"), "PATIENT_ID\tSAMPLE_ID\nP1\tS1\n");
  await writeFile(path.join(dir, "data_mutations.txt"), "Hugo_Symbol\tTumor_Sample_Barcode\nTP53\tS1\n");
  await writeFile(path.join(dir, "notes.docx"), "x");
  const s = await readStudyFolder(dir, "my_study");
  assert.equal(s.study.cancer_study_identifier, "my_study");
  assert.deepEqual(s.files.map((f) => f.kind).sort(), ["clinical_sample", "mutations"]);
  assert.deepEqual(s.ignored, ["notes.docx"]);
});

test("meta files name their data files; case lists are read from case_lists/", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cbiolab-import-"));
  await writeFile(path.join(dir, "meta_study.txt"), "type_of_cancer: acc\ncancer_study_identifier: acc_test\nname: ACC test\n");
  await writeFile(path.join(dir, "meta_cna.txt"), "cancer_study_identifier: acc_test\ngenetic_alteration_type: COPY_NUMBER_ALTERATION\ndatatype: DISCRETE\nstable_id: gistic\ndata_filename: cna.txt\n");
  await writeFile(path.join(dir, "cna.txt"), "Hugo_Symbol\tS1\nTP53\t-2\n");
  await writeFile(path.join(dir, "meta_gistic.txt"), "genetic_alteration_type: GISTIC_GENES_AMP\ndatatype: Q-VALUE\ndata_filename: gistic.txt\n");
  await writeFile(path.join(dir, "gistic.txt"), "x\n");
  await mkdir(path.join(dir, "case_lists"));
  await writeFile(path.join(dir, "case_lists", "cases_all.txt"), "stable_id: acc_test_all\ncase_list_name: All\ncase_list_ids: S1\tS2\n");
  const s = await readStudyFolder(dir, "ignored");
  assert.equal(s.study.cancer_study_identifier, "acc_test");
  assert.deepEqual(s.files.map((f) => f.kind).sort(), ["cna_discrete", "unsupported"]);
  assert.deepEqual(s.caseLists[0].ids, ["S1", "S2"]);
  assert.equal(parseMeta("a: b: c\n#x: y").a, "b: c");
});
