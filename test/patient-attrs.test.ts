// The Patient page header's attributes (app/portal/patient-attrs.ts), as cBioPortal's patient view
// writes them: its clean, derive, ordering, brackets, commas and colours.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { clean, cleanAndDerive, derive, inlineAttributes, liftCommon } from "../app/portal/patient-attrs.ts";

describe("the patient header's attributes", () => {
  test("clean drops missing values, floors months and age, and strips the status prefix", () => {
    assert.deepEqual(clean({ SEX: "Female", RACE: "Unknown", GRADE: "[Not Available]", OS_MONTHS: "118.45", AGE: "67.9", OS_STATUS: "0:LIVING", DFS_STATUS: "1:Recurred" }),
      { SEX: "Female", OS_MONTHS: "118", AGE: "67", OS_STATUS: "LIVING", DFS_STATUS: "Recurred" });
  });
  test("derive names the sample's type from the first attribute that names one, and where it was taken", () => {
    // SAMPLE_CLASS "Tumor" names no type, so SAMPLE_TYPE decides, as on the portal
    assert.deepEqual(derive({ SAMPLE_CLASS: "Tumor", SAMPLE_TYPE: "Metastasis", METASTATIC_SITE: "Lung" }),
      { SAMPLE_CLASS: "Tumor", SAMPLE_TYPE: "Metastasis", METASTATIC_SITE: "Lung", DERIVED_NORMALIZED_CASE_TYPE: "Metastasis", DERIVED_SAMPLE_LOCATION: "Lung" });
    assert.equal(derive({ SAMPLE_TYPE: "Primary", PRIMARY_SITE: "Breast", TUMOR_SITE: "x" }).DERIVED_SAMPLE_LOCATION, "Breast");
    assert.equal(derive({ SAMPLE_TYPE: "Primary" }).DERIVED_SAMPLE_LOCATION, undefined);
    assert.equal(derive({ SAMPLE_TYPE: "cfDNA" }).DERIVED_NORMALIZED_CASE_TYPE, "cfDNA");
    assert.equal(derive({ SAMPLE_TYPE: "Local Recurrence" }).DERIVED_NORMALIZED_CASE_TYPE, "Recurrence");
    assert.deepEqual(derive({ SEX: "Male" }), { SEX: "Male" }, "nothing to derive from");
  });
  test("only configured attributes, in the portal's order; secondary ones in brackets; commas before primary ones", () => {
    const a = inlineAttributes(cleanAndDerive({ SAMPLE_TYPE: "Metastasis", METASTATIC_SITE: "Lung", CANCER_TYPE: "Non-Small Cell Lung Cancer",
      CANCER_TYPE_DETAILED: "Lung Adenocarcinoma", GENE_PANEL: "IMPACT468" }));
    assert.deepEqual(a.map((x) => x.key), ["DERIVED_NORMALIZED_CASE_TYPE", "DERIVED_SAMPLE_LOCATION", "CANCER_TYPE", "CANCER_TYPE_DETAILED"]);
    assert.deepEqual(a.map((x) => x.lead + x.text + x.trail),
      [", Metastasis ", "(Lung), ", "Non-Small Cell Lung Cancer ", "(Lung Adenocarcinoma)"]);
    assert.equal(a[0].color, "red", "a metastasis is red");
  });
  test("status colours and formats", () => {
    const a = inlineAttributes(cleanAndDerive({ GENDER: "Female", AGE: "68", OS_STATUS: "0:LIVING", OS_MONTHS: "118.45" }));
    assert.deepEqual(a.map((x) => x.text), ["Female", "68 years old", "LIVING", "(118 months)"]);
    assert.equal(a.find((x) => x.key === "OS_STATUS")!.color, "rgb(0, 128, 0)");
    assert.equal(inlineAttributes({ DFS_STATUS: "Recurred" })[0].color, "#f00", "a DFS status without its own colour takes the attribute's default");
    assert.equal(inlineAttributes({ SEX: "Female" })[0].color, "#333333");
  });
  test("a cancer type every sample shares moves to the patient; one that differs stays with each sample", () => {
    const { common, samples } = liftCommon([{ CANCER_TYPE: "Breast Cancer", CANCER_TYPE_DETAILED: "IDC", SAMPLE_TYPE: "Primary" },
      { CANCER_TYPE: "Breast Cancer", CANCER_TYPE_DETAILED: "ILC", SAMPLE_TYPE: "Metastasis" }]);
    assert.deepEqual(common, { CANCER_TYPE: "Breast Cancer" });
    assert.deepEqual(samples, [{ CANCER_TYPE_DETAILED: "IDC", SAMPLE_TYPE: "Primary" }, { CANCER_TYPE_DETAILED: "ILC", SAMPLE_TYPE: "Metastasis" }]);
  });
});
