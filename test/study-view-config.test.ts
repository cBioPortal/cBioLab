// The Study View's default charts (lib/study-view-config.ts), as cbioportal.org picks them
// (STS-LY-7, STS-LY-8): its priority table replaces a database priority left at 1, the first 20
// with a priority above 0 in priority then name order, less the charts with a single value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chartPriority, chartOrder, defaultChartKeys, shouldShowChart, DEFAULT_CLINICAL_CHARTS } from "../lib/study-view-config.ts";

test("the portal's table replaces a priority of exactly 1, and only that", () => {
  assert.equal(chartPriority("SEX", 1), 9);
  assert.equal(chartPriority("CANCER_TYPE", 1), 3000);
  assert.equal(chartPriority("PATH_T_STAGE", 1), 1, "no entry: the default stays");
  assert.equal(chartPriority("SEX", 0), 0, "a curator's 0 hides it");
  assert.equal(chartPriority("SEX", 50), 50, "any other database priority wins");
});

test("charts are ordered by priority, then display name", () => {
  const xs = [{ attribute: "B", displayName: "Zeta", priority: 9 }, { attribute: "A", displayName: "Alpha", priority: 1 },
    { attribute: "C", displayName: "Beta", priority: 9 }];
  assert.deepEqual(xs.sort(chartOrder).map((x) => x.attribute), ["C", "B", "A"]);
});

test("a chart of one value is hidden unless the page is filtered or holds one sample", () => {
  assert.equal(shouldShowChart(1, false, 594), false);
  assert.equal(shouldShowChart(2, false, 594), true);
  assert.equal(shouldShowChart(1, true, 594), true);
  assert.equal(shouldShowChart(1, false, 1), true);
});

test("coadread: the first 20 by priority, then the three one-value charts dropped, as cbioportal.org shows them", () => {
  // name, priority after the table, distinct values (NA counted as one)
  const rows: [string, string, number, number][] = [
    ["CANCER_TYPE", "Cancer Type", 3000, 1], ["CANCER_TYPE_DETAILED", "Cancer Type Detailed", 2000, 3],
    ["SAMPLE_COUNT", "Number of Samples Per Patient", 40, 1], ["MUTATION_COUNT", "Mutation Count", 30, 229],
    ["FRACTION_GENOME_ALTERED", "Fraction Genome Altered", 20, 528], ["AGE", "Diagnosis Age", 9, 60],
    ["MSI_SCORE_MANTIS", "MSI MANTIS Score", 9, 463], ["MSI_SENSOR_SCORE", "MSIsensor Score", 9, 219],
    ["OS_STATUS", "Overall Survival Status", 9, 3], ["SAMPLE_TYPE", "Sample Type", 9, 1], ["SEX", "Sex", 9, 3],
    ["ETHNICITY", "Ethnicity Category", 8, 3], ["RACE", "Race Category", 8, 5], ["SUBTYPE", "Subtype", 8, 9],
    ["TUMOR_TYPE", "Tumor Type", 8, 5], ["PATH_M_STAGE", "American Joint Committee on Cancer Metastasis Stage Code", 1, 6],
    ["AJCC_STAGING_EDITION", "American Joint Committee on Cancer Publication Version Type", 1, 5],
    ["PATH_T_STAGE", "American Joint Committee on Cancer Tumor Stage Code", 1, 8], ["ANEUPLOIDY_SCORE", "Aneuploidy Score", 1, 33],
    ["DAYS_TO_BIRTH", "Birth from Initial Pathologic Diagnosis Date", 1, 549],
    ["WEIGHT", "Weight", 1, 186], ["DAYS_TO_INITIAL_PATHOLOGIC_DIAGNOSIS", "Days to Sample Collection", 1, 1], ["HIDDEN", "Aaa", 0, 5],
  ];
  const attrs = rows.reverse().map(([attribute, displayName, priority, values]) => ({ key: "x|" + attribute, attribute, displayName, priority, values }));
  const keys = defaultChartKeys(attrs, { filtered: false, totalSamples: 594 }).map((k) => k.slice(2));
  assert.equal(keys.length, 17);
  assert.ok(!keys.includes("CANCER_TYPE") && !keys.includes("SAMPLE_COUNT") && !keys.includes("SAMPLE_TYPE"));
  assert.ok(!keys.includes("WEIGHT"), "21st by priority and name");
  assert.ok(!keys.includes("HIDDEN"), "priority 0");
  assert.deepEqual(keys.slice(0, 4), ["CANCER_TYPE_DETAILED", "MUTATION_COUNT", "FRACTION_GENOME_ALTERED", "AGE"]);
  assert.ok(["SEX", "RACE", "ETHNICITY", "SUBTYPE", "PATH_T_STAGE", "ANEUPLOIDY_SCORE", "DAYS_TO_BIRTH"].every((k) => keys.includes(k)));
  assert.equal(defaultChartKeys(attrs, { filtered: true, totalSamples: 594 }).length, DEFAULT_CLINICAL_CHARTS, "filtered: every one of the 20");
});
