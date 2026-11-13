// The mutation table's rows (lib/mutation-table.ts): the OncoKB call is the sample's tumour type's
// where OncoKB by tumour type holds the mutation at the pin, and the gene-level call otherwise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mutationRowSource } from "../lib/mutation-table.ts";

const part = [{ cohort: "c", study: "paad_x", cohortSql: "SELECT 'S1' AS sid" }];
const PINS = { hg19: null, hg38: null };

test("with a pin, a mutation's OncoKB call is its tumour type's, or the gene-level one where there is none", () => {
  const w = mutationRowSource(part, "db", "KRAS", "v7.7", PINS).with;
  assert.match(w, /att AS \(SELECT alteration, consequence, tumor_type, .* FROM annotation\.oncokb_tumor_type AS t WHERE oncokb_version = 'v7\.7' AND alteration_type = 'MUTATION' AND hugo_gene_symbol = 'KRAS'/s);
  assert.match(w, /LEFT JOIN att AS tt ON tt\.alteration = m\.proteinChange AND tt\.consequence = m\.consequence AND tt\.tumor_type = m\.tumorType/);
  assert.match(w, /if\(tt\.found = 1, tt\.oncogenicity, ann\.oncogenicity\) AS oncogenicity, if\(tt\.found = 1, tt\.level, ann\.level\) AS level/);
  // the driver flag follows the call the row shows
  assert.match(w, /toUInt8\(if\(tt\.found = 1, tt\.driver, ifNull\(ann\.driver, 0\)\)\) AS drv/);
  assert.match(w, /max\(t\.oncogenicity IN \('Oncogenic', 'Likely Oncogenic', 'Resistance'\)\) AS driver/);
});

test("the tumour type is the one the sync keyed: detailed type, else the study's for a sample with no cancer type, else none", () => {
  const w = mutationRowSource(part, "db", "KRAS", "v7.7", PINS).with;
  assert.match(w, /k0 AS \(SELECT replaceOne\(sample_unique_id, 'paad_x_', ''\) AS sid, countIf\(attribute_name = 'CANCER_TYPE_DETAILED'\) AS nd/);
  assert.match(w, /attribute_name IN \('CANCER_TYPE', 'CANCER_TYPE_DETAILED'\)/);
  assert.match(w, /if\(ifNull\(k\.sid, ''\) = '', \(SELECT t\.name FROM db\.cancer_study cs JOIN db\.type_of_cancer t .* WHERE cs\.cancer_study_identifier = 'paad_x'\), if\(ifNull\(k\.nd, 0\) > 0, k\.d, ''\)\) AS tumorType/s);
  assert.match(w, /FROM mt0 AS m\n/);
});

test("without a pin there is no OncoKB call and no tumour-type lookup", () => {
  const w = mutationRowSource(part, "db", "KRAS", null, PINS).with;
  assert.doesNotMatch(w, /oncokb/);
  assert.doesNotMatch(w, /mt0|k0 AS/);
  assert.match(w, /'' AS oncogenicity, '' AS level, toUInt8\(0\) AS drv/);
});
