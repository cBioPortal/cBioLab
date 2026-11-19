// The Patient header's TMB-H / MSI-H (PAT-STM-9), lib/biomarkers.ts, from the portal's rules
// (cbioportal-frontend: StoreUtils.ts getSampleClinicalDataMapByThreshold / ByKeywords /
// getSampleBiomarkerClinicalData / getSampleTumorTypeMap / tumorTypeResolver; SampleSummaryList.tsx
// getOncoKbOtherBiomarkerAnnotationComponent; constants.ts TMB_H_THRESHOLD). Ids are the case table's.
// The read's SQL runs against the fixture in scripts/check-oncokb-tumor-type.ts (R*).
import { test } from "node:test";
import assert from "node:assert/strict";
import { OTHER_BIOMARKERS, biomarkerCallText, biomarkerCallsSql, biomarkerTumorType, sampleBiomarkers, studyCancerTypeSql, type BiomarkerCall } from "../lib/biomarkers.ts";
import { OTHER_BIOMARKERS as SYNCED } from "../packages/annotation-sync/src/sources/oncokb-tumor-type.ts";

test("the header reads the gene the sync files the biomarkers under", () => assert.equal(OTHER_BIOMARKERS, SYNCED));

const cases: [string, Record<string, string>, string[]][] = [
  ["B1 CVR_TMB_SCORE above 10", { CVR_TMB_SCORE: "12" }, ["TMB-H"]],
  ["B2 TMB_NONSYNONYMOUS at 10 (inclusive)", { TMB_NONSYNONYMOUS: "10" }, ["TMB-H"]],
  ["B3 the preferred one below, the other above: qualifies", { CVR_TMB_SCORE: "9.9", TMB_NONSYNONYMOUS: "15" }, ["TMB-H"]],
  ["B4 below", { CVR_TMB_SCORE: "9.99" }, []],
  ["B5 not a number", { TMB_NONSYNONYMOUS: "high" }, []],
  ["B5 not finite", { TMB_NONSYNONYMOUS: "Infinity" }, []],
  ["B6 MSI_TYPE Instable with an MSI_SCORE", { MSI_TYPE: "Instable", MSI_SCORE: "3" }, ["MSI-H"]],
  ["B6b the score's value is not checked (legacy quirk: MSI_H_THRESHOLD unused)", { MSI_TYPE: "Instable", MSI_SCORE: "n/a" }, ["MSI-H"]],
  ["B6c Instable without an MSI_SCORE: asked, never shown", { MSI_TYPE: "Instable" }, []],
  ["B7 Stable", { MSI_TYPE: "Stable", MSI_SCORE: "40" }, []],
  ["B7 the keyword is exact", { MSI_TYPE: "instable", MSI_SCORE: "40" }, []],
  ["B8 both, MSI-H first", { MSI_TYPE: "Instable", MSI_SCORE: "40", CVR_TMB_SCORE: "50" }, ["MSI-H", "TMB-H"]],
  ["B9 none", {}, []],
];
for (const [name, attrs, want] of cases) test(name, () => assert.deepEqual(sampleBiomarkers(attrs), want));

const LUAD = "Lung Adenocarcinoma", LUSC = "Lung Squamous Cell Carcinoma", NSCLC = "Non-Small Cell Lung Cancer";
test("T1 no sample names a cancer type: null, the study's", () =>
  assert.equal(biomarkerTumorType([{ id: "S1", attrs: { SAMPLE_TYPE: "Primary" } }]), null));
test("T2 CANCER_TYPE alone is the tumour type", () => assert.equal(biomarkerTumorType([{ id: "S1", attrs: { CANCER_TYPE: NSCLC } }]), NSCLC));
test("T3 the first detailed type among the samples, by id, for every one of them", () => {
  const two = [{ id: "S2", attrs: { CANCER_TYPE_DETAILED: LUSC } }, { id: "S1", attrs: { CANCER_TYPE_DETAILED: LUAD } }];
  assert.equal(biomarkerTumorType(two), LUAD);
  assert.equal(biomarkerTumorType(two.slice(0, 1)), LUSC, "a sample view: that sample's own");
});
test("T4 a detailed type on any sample wins over a CANCER_TYPE on an earlier one", () =>
  assert.equal(biomarkerTumorType([{ id: "S1", attrs: { CANCER_TYPE: NSCLC } }, { id: "S2", attrs: { CANCER_TYPE_DETAILED: LUSC } }]), LUSC));

const call = (c: Partial<BiomarkerCall>): BiomarkerCall =>
  ({ alteration: "TMB-H", tumorType: LUAD, oncogenicity: "Unknown", sensitive: "", resistance: "", diagnostic: "", prognostic: "", summary: "", ...c });
test("C1 the sensitive level, Unknown left out", () => assert.equal(biomarkerCallText(call({ sensitive: "LEVEL_1" })), "Level 1"));
test("C2 no sensitive level: the resistance one", () => assert.equal(biomarkerCallText(call({ resistance: "LEVEL_R1" })), "Level R1"));
test("C3 an oncogenicity and a level", () => assert.equal(biomarkerCallText(call({ oncogenicity: "Oncogenic", sensitive: "LEVEL_3A" })), "Oncogenic · Level 3A"));
test("C4 Unknown and no level: nothing beside the name", () => assert.equal(biomarkerCallText(call({})), ""));

test("the read quotes the pin, the tumour type and the biomarkers with sq(), and asks none for an empty list", () => {
  const sql = biomarkerCallsSql("v'1", "O'Type", ["TMB-H"]);
  assert.ok(sql.includes("oncokb_version = 'v\\'1'") && sql.includes("tumor_type = 'O\\'Type'") && sql.includes("alteration IN ('TMB-H')"));
  assert.ok(biomarkerCallsSql("v1", "", []).includes("alteration IN ('')"));
  assert.ok(studyCancerTypeSql("db", "o'b").includes("cancer_study_identifier = 'o\\'b'"));
});
