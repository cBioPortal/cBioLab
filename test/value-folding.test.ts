// Clinical attribute values fold case and whitespace — in the chart AND in the
// predicate the chart's click compiles to.
//
// THE BUG THIS EXISTS TO PREVENT is not "values look untidy". It is a cohort
// that is silently short. A facet click compiles to an equality on the value, so
// while `Female` and `FEMALE` were distinct literals, clicking `Female` in
// breast_msk_2025 selected 1,097 patients and left behind the 1,987 recorded the
// other way — 35.6% of the intended cohort, with every survival curve and gene
// frequency downstream computed on the remainder. Measured across the database:
// 788 (study, attribute, value) groups affected on the primary connection.
//
// THE DANGEROUS HALF-FIX is folding only the display. The chart would then show
// one tidy `Female` row counting 3,084 while the click still selected 1,097 —
// the same error as before, minus the evidence. So the load-bearing assertion
// here is that ONE shared SQL expression is used on both sides.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalClinicalValue, clinicalValueFoldSql, canonicalEventName } from "../lib/event-names.ts";
import { compileCohortDef } from "../lib/cohort2.ts";

describe("the folding rule itself", () => {
  test("folds case and surrounding whitespace, and nothing else", () => {
    assert.equal(canonicalClinicalValue("FEMALE"), "female");
    assert.equal(canonicalClinicalValue("Female"), "female");
    assert.equal(canonicalClinicalValue("  Lymph Node "), "lymph node");
    assert.equal(canonicalClinicalValue("FALSE"), canonicalClinicalValue("False"));
  });

  test("does NOT merge values that differ by a separator", () => {
    // The rule that would catch these is one step from deciding `Targeted
    // Therapy` and `Targeted Molecular Therapy` are the same class.
    assert.notEqual(canonicalClinicalValue("beta blocker"), canonicalClinicalValue("beta-blocker"));
    assert.notEqual(canonicalClinicalValue("xrt,nos"), canonicalClinicalValue("xrt nos"));
  });

  test("is the same rule as event names, not a second copy", () => {
    for (const s of ["Treatment", "  SAMPLE ACQUISITION ", "Lymph Node", ""])
      assert.equal(canonicalClinicalValue(s), canonicalEventName(s));
  });

  test("the SQL fold is Unicode-aware and trims both ends", () => {
    // ClickHouse `lower` is ASCII-only: with it, MÜNCHEN and münchen would fold
    // differently in SQL than in JS and the predicate would match nothing.
    const sql = clinicalValueFoldSql("attribute_value");
    assert.match(sql, /lowerUTF8/, "must use lowerUTF8, not lower");
    assert.match(sql, /trimBoth/);
    assert.equal(sql.includes("attribute_value"), true);
  });
});

describe("the chart and the predicate fold identically", () => {
  const explore = readFileSync(new URL("../lib/explore.ts", import.meta.url), "utf8");
  const cohort = readFileSync(new URL("../lib/cohort2.ts", import.meta.url), "utf8");

  test("both sides call the shared helper", () => {
    assert.match(explore, /clinicalValueFoldSql/,
      "the facet query must group by the folded value");
    assert.match(cohort, /clinicalValueFoldSql/,
      "the cohort predicate must match on the folded value");
  });

  test("no facet query counts raw distinct values", () => {
    // Cardinality decides pie-vs-list and gates the numeric sniff; counting raw
    // variants would report a fold-free cardinality for a folded chart.
    assert.equal(/uniqExact\(attribute_value\)/.test(explore), false,
      "distinct value counts must be taken over the folded value");
  });

  test("the compiled predicate folds the column AND the literal", () => {
    const sql = compileCohortDef(
      { all: [{ kind: "clinical", attribute: "GENDER", op: "=", value: "Female" }] } as never,
      { study: "breast_msk_2025", db: "x" });
    const fold = clinicalValueFoldSql("attribute_value");
    assert.ok(sql.includes(fold), "the column must be folded:\n" + sql);
    assert.ok(sql.includes(clinicalValueFoldSql("'Female'")),
      "the literal must be folded by the SAME expression, so JS and SQL cannot disagree:\n" + sql);
    assert.equal(/attribute_value = 'Female'/.test(sql), false,
      "a raw equality would select only one spelling");
  });

  test("a multi-value pick folds too", () => {
    const sql = compileCohortDef(
      { all: [{ kind: "clinical", attribute: "RACE", values: ["White", "BLACK"] }] } as never,
      { study: "breast_msk_2025", db: "x" });
    assert.ok(sql.includes(clinicalValueFoldSql("'White'")), sql);
    assert.ok(sql.includes(clinicalValueFoldSql("'BLACK'")), sql);
  });

  test("ordering comparisons are NOT folded", () => {
    // `>` on a string is a range, and folding one would change what it means.
    const sql = compileCohortDef(
      { all: [{ kind: "clinical", attribute: "STAGE", op: ">", value: "II" }] } as never,
      { study: "s", db: "x" });
    assert.match(sql, /attribute_value > 'II'/);
  });
});
