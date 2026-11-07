// Generic-assay SQL (lib/generic-assay.ts): what counts as "not measured", which datatypes are
// categorical, how one entity of one study's profile is read (by its exact profile id, never a
// prefix that would also read sibling studies), how a row is tested against a cohort at the level
// the profile records, and the entity search's ordering and limits. Browser-safe builders, so the
// tests read the statements they produce.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ASSAY_MISSING_VALUES, isCategoricalAssay, ENTITY_RE, ENTITY_SEARCH_LIMIT,
  assayEntityRowsSql, assayInCohortSql, assayEntitySearchSql, assayCohortMedianSql,
  assayCohortCutsSql, assayCohortValuesSql, assayEntityCountSql
} from "../lib/generic-assay.ts";

const COHORT = "SELECT 'P1' AS pid, 'S1' AS sid";

describe("what a generic assay's values mean", () => {
  test("CATEGORICAL and BINARY are categorical in any case; every other datatype holds numbers", () => {
    for (const dt of ["CATEGORICAL", "categorical", "BINARY", "Binary"]) assert.equal(isCategoricalAssay(dt), true, dt);
    for (const dt of ["LIMIT-VALUE", "CONTINUOUS", "CATEGORICAL_EXTRA", "", "NUMERIC"]) assert.equal(isCategoricalAssay(dt), false, dt);
  });

  test("the not-called values include the empty string and the NA / NaN / null spellings", () => {
    for (const v of ["", "NA", "N/A", "NaN", "nan", "null", "NULL"]) assert.ok(ASSAY_MISSING_VALUES.includes(v), v);
    assert.equal(ASSAY_MISSING_VALUES.includes("0"), false, "a zero is a value, not a missing one");
  });

  test("an entity id takes signatures, arms, probes and phosphosites, and refuses quotes and over-long names", () => {
    for (const ok of ["SBS1", "1p", "cg00000029", "TP53_S15;S20", "mean_IC50 (uM)", "a/b:c+d-e.f"]) assert.match(ok, ENTITY_RE, ok);
    for (const bad of ["", "x'; DROP", "a\"b", "x".repeat(121), "line\nbreak"]) assert.doesNotMatch(bad, ENTITY_RE, JSON.stringify(bad));
  });
});

describe("one entity's rows", () => {
  const base = { db: "cbio", study: "brca_tcga", profileType: "mutational_signature", entity: "SBS1", inCohort: "1" };

  test("read by the study's exact profile id and the entity, never by a prefix that also matches sibling studies", () => {
    const sql = assayEntityRowsSql({ ...base, numeric: true });
    assert.match(sql, /FROM cbio\.generic_assay_data_derived/);
    assert.match(sql, /profile_stable_id = 'brca_tcga_mutational_signature'/);
    assert.match(sql, /entity_stable_id = 'SBS1'/);
    assert.doesNotMatch(sql, /LIKE|startsWith/);
  });

  test("numeric form: only finite numbers, so a limit like '>8' or NA has no row", () => {
    const sql = assayEntityRowsSql({ ...base, numeric: true });
    assert.match(sql, /AS av/);
    assert.match(sql, /IS NOT NULL/);
    assert.doesNotMatch(sql, /NOT IN \(''/, "the numeric form does not need the text missing-value list");
  });

  test("text form: the trimmed value, every not-called spelling left out", () => {
    const sql = assayEntityRowsSql({ ...base, numeric: false });
    assert.match(sql, /trimBoth\(value\) AS av/);
    for (const v of ASSAY_MISSING_VALUES) assert.ok(sql.includes("'" + v + "'"), "leaves out " + JSON.stringify(v));
  });

  test("the cohort condition is applied as given, and values are quoted, not spliced", () => {
    const sql = assayEntityRowsSql({ ...base, entity: "x' OR 1=1 --", numeric: true, inCohort: "IN_COHORT_MARK" });
    assert.ok(sql.trimEnd().endsWith("AND IN_COHORT_MARK"));
    assert.ok(sql.includes("'x\\' OR 1=1 --'"));
  });
});

describe("a row's place in a cohort", () => {
  test("a patient-level row by its patient, a sample-level row by its sample, both stripped of the study prefix", () => {
    const sql = assayInCohortSql("s1");
    assert.match(sql, /^if\(ifNull\(patient_level, 0\) = 1, /);
    assert.match(sql, /replaceOne\(patient_unique_id, 's1_', ''\) IN \(SELECT pid FROM cohort\)/);
    assert.match(sql, /replaceOne\(sample_unique_id, 's1_', ''\) IN \(SELECT sid FROM cohort\)/);
  });

  test("a named CTE and a table alias qualify every column", () => {
    const sql = assayInCohortSql("s1", "grp", "g.");
    assert.match(sql, /ifNull\(g\.patient_level, 0\)/);
    assert.match(sql, /g\.patient_unique_id.*IN \(SELECT pid FROM grp\)/);
    assert.match(sql, /g\.sample_unique_id.*IN \(SELECT sid FROM grp\)/);
  });
});

describe("entity search", () => {
  test("an empty query lists the profile's first entities, with no filter and no exact-match ordering", () => {
    const sql = assayEntitySearchSql("s1", "cbio", "methylation", "   ");
    assert.doesNotMatch(sql, /positionCaseInsensitive/);
    assert.match(sql, /ORDER BY length\(e\.entity\), e\.entity LIMIT 50$/);
    assert.match(sql, /profile_stable_id = 's1_methylation'/);
    assert.match(sql, /count\(\) OVER \(\) AS total/, "says how many match in all");
  });

  test("a query matches id, name or gene, and an exact gene (or one of a probe's genes) sorts first", () => {
    const sql = assayEntitySearchSql("s1", "cbio", "methylation", " tp53 ");
    assert.match(sql, /positionCaseInsensitive\(e\.entity, 'tp53'\) > 0/);
    assert.match(sql, /positionCaseInsensitive\(pr\.name, 'tp53'\) > 0/);
    assert.match(sql, /upper\(pr\.gene\) = 'TP53'/);
    assert.match(sql, /ORDER BY has\(splitByChar\(';', upper\(pr\.name\)\), 'TP53'\) OR upper\(pr\.gene\) = 'TP53' OR upper\(e\.entity\) = 'TP53' DESC, length/);
  });

  test("the limit defaults to ENTITY_SEARCH_LIMIT and is clamped to 1..200, whole", () => {
    const lim = (n?: number) => Number(/LIMIT (\d+)$/.exec(n === undefined ? assayEntitySearchSql("s", "d", "p", "x") : assayEntitySearchSql("s", "d", "p", "x", n))![1]);
    assert.equal(lim(), ENTITY_SEARCH_LIMIT);
    assert.equal(lim(0), 1);
    assert.equal(lim(-5), 1);
    assert.equal(lim(10.9), 10);
    assert.equal(lim(5000), 200);
  });
});

describe("a cohort's values of one entity", () => {
  const args = [COHORT, "s1", "cbio", "armlevel_cna", "1p"] as const;

  test("every cohort query restricts to the in-cohort cases of the study's own profile and entity", () => {
    for (const sql of [assayCohortMedianSql(...args), assayCohortCutsSql(...args, [0.5]), assayCohortValuesSql(...args)]) {
      assert.ok(sql.startsWith("WITH cohort AS (" + COHORT + "),"));
      assert.match(sql, /profile_type = 'armlevel_cna' AND profile_stable_id = 's1_armlevel_cna'/);
      assert.match(sql, /entity_stable_id = '1p'/);
      assert.ok(sql.includes(assayInCohortSql("s1")), "the cohort test is the shared one");
    }
  });

  test("median: the datatype, the count of numeric values and their exact median", () => {
    const sql = assayCohortMedianSql(...args);
    assert.match(sql, /any\(datatype\) AS dt/);
    assert.match(sql, /countIf\(.* IS NOT NULL\) AS n/);
    assert.match(sql, /quantileExactIf\(0\.5\)/);
  });

  test("cuts: exact quantiles at each p, the largest value and the count", () => {
    const sql = assayCohortCutsSql(...args, [0.25, 0.5, 0.75]);
    assert.match(sql, /quantilesExactIf\(0\.25, 0\.5, 0\.75\)/);
    assert.match(sql, /AS qs, max\(.*\) AS hi, countIf\(.*\) AS n FROM rows$/);
  });

  test("cuts: refused with no p, or any p outside (0, 1)", () => {
    assert.throws(() => assayCohortCutsSql(...args, []), /every p must be between 0 and 1/);
    for (const p of [0, 1, -0.1, 1.5, NaN]) assert.throws(() => assayCohortCutsSql(...args, [0.5, p]), /between 0 and 1 \(exclusive\)/, String(p));
  });

  test("categorical values: each trimmed value with its number of cases, not-called values left out", () => {
    const sql = assayCohortValuesSql(...args);
    assert.match(sql, /SELECT trimBoth\(value\) AS v, uniqExact\(id\) AS n FROM rows/);
    assert.match(sql, /GROUP BY v$/);
    for (const v of ASSAY_MISSING_VALUES) assert.ok(sql.includes("'" + v + "'"));
  });
});

test("entity count: metadata only, the study's exact profile", () => {
  const sql = assayEntityCountSql("s1", "cbio", "treatment_ic50");
  assert.equal(sql, "SELECT count() AS n FROM cbio.generic_assay_profile_entity_derived WHERE profile_stable_id = 's1_treatment_ic50'");
});
