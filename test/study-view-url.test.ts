// Explore's filters in its URL (lib/study-view-url.ts): the page's own `filters` round-trips, and
// cbioportal.org's link forms (STV-URL-2) are translated, with what has no translation named.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FILTERS_PARAM, fromAttributeParams, fromStudyViewFilter, readFilters, writeFilters } from "../lib/study-view-url.ts";
import type { Clause } from "../lib/types.ts";

const p = (s: string) => new URLSearchParams(s);

describe("the page's own filters", () => {
  test("written and read back unchanged; none written as no parameter", () => {
    const all: Clause[] = [{ kind: "clinical", attribute: "SEX", op: "=", value: "Female" },
      { any: [{ kind: "clinical", attribute: "AGE", range: { gt: 50, lte: 55 } }, { kind: "clinical", attribute: "AGE", range: { gt: 70, lte: 75 } }] },
      { kind: "oql", q: "KRAS: MUT" }];
    const v = writeFilters(all)!;
    assert.match(v, /^1\./, "the compressed url-json form");
    assert.deepEqual(readFilters(p(FILTERS_PARAM + "=" + encodeURIComponent(v))), { all });
    assert.equal(writeFilters([]), null);
    assert.equal(readFilters(p("study=x")), null);
  });

  test("a value that does not decode is refused, not read as no filters", () => {
    assert.deepEqual(readFilters(p("filters=1.garbage")), { all: [], refused: ["a filters parameter that does not decode"] });
  });
});

describe("cbioportal.org links", () => {
  test("a StudyViewFilter: values of a chart as one clause, ranges as (start, end], its studies", () => {
    const f = { studyIds: ["coadread_tcga_pan_can_atlas_2018"], alterationFilter: { copyNumberAlterationEventTypes: {} },
      clinicalDataFilters: [
        { attributeId: "SEX", values: [{ value: "Female" }] },
        { attributeId: "RACE", values: [{ value: "White" }, { value: "Asian" }] },
        { attributeId: "AGE", values: [{ start: 50, end: 55 }, { start: 70, end: 75 }, { end: 35 }] },
        { attributeId: "MUTATION_COUNT", values: [{ start: 240 }] },
        { attributeId: "SAMPLE_COUNT", values: [{ start: 1, end: 1 }] },
      ] };
    assert.deepEqual(fromStudyViewFilter(f), { studies: ["coadread_tcga_pan_can_atlas_2018"], all: [
      { kind: "clinical", attribute: "SEX", op: "=", value: "Female" },
      { kind: "clinical", attribute: "RACE", values: ["White", "Asian"] },
      { any: [{ kind: "clinical", attribute: "AGE", range: { gt: 50, lte: 55 } }, { kind: "clinical", attribute: "AGE", range: { gt: 70, lte: 75 } },
        { kind: "clinical", attribute: "AGE", range: { lte: 35 } }] },
      { kind: "clinical", attribute: "MUTATION_COUNT", range: { gt: 240 } },
      { kind: "clinical", attribute: "SAMPLE_COUNT", op: "=", value: 1 },
    ] });
  });

  test("what has no translation is named: gene filters, sample lists, an NA value", () => {
    const r = fromStudyViewFilter({ studyIds: ["s"], geneFilters: [{ geneQueries: [[{ hugoGeneSymbol: "KRAS" }]] }], sampleIdentifiers: [],
      clinicalDataFilters: [{ attributeId: "SEX", values: [{ value: "NA" }, { value: "Male" }] }] });
    assert.deepEqual(r.all, [{ kind: "clinical", attribute: "SEX", op: "=", value: "Male" }]);
    assert.deepEqual(r.refused, ["the NA value of SEX", "geneFilters"], "an empty list is no filter");
  });

  test("#filterJson in the hash, URI-decoded only, and `filters=` holding JSON", () => {
    const json = JSON.stringify({ studyIds: ["s"], clinicalDataFilters: [{ attributeId: "TUMOR_TYPE", values: [{ value: "A+B" }] }] });
    const want = { studies: ["s"], all: [{ kind: "clinical", attribute: "TUMOR_TYPE", op: "=", value: "A+B" }] };
    assert.deepEqual(readFilters(p(""), "#filterJson=" + encodeURIComponent(json)), want);
    assert.deepEqual(readFilters(p("filters=" + encodeURIComponent(json))), want);
    assert.deepEqual(readFilters(p(""), "#filterJson={bad"), { all: [], refused: ["a filterJson that is not valid JSON"] });
  });

  test("filterAttributeId + filterValues: words split on commas (\\, kept), ranges for numbers, the id upper-cased", () => {
    assert.deepEqual(readFilters(p("filterAttributeId=sex&filterValues=Female")),
      { all: [{ kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] });
    assert.deepEqual(fromAttributeParams("ONCOTREE", "COAD, READ\\,X"),
      { all: [{ kind: "clinical", attribute: "ONCOTREE", values: ["COAD", "READ,X"] }] });
    assert.deepEqual(fromAttributeParams("AGE", "50-55,70-75"), { all: [{ any: [
      { kind: "clinical", attribute: "AGE", range: { gt: 50, lte: 55 } }, { kind: "clinical", attribute: "AGE", range: { gt: 70, lte: 75 } }] }] });
    assert.deepEqual(fromAttributeParams("bad id;", "x").refused, ['the clinical attribute "bad id;"']);
  });

  test("past the ranges one clause can hold, the chart is refused by name", () => {
    const values = Array.from({ length: 9 }, (_, i) => ({ start: i * 10, end: i * 10 + 5 }));
    assert.deepEqual(fromStudyViewFilter({ clinicalDataFilters: [{ attributeId: "AGE", values }] }),
      { all: [], refused: ["AGE's 9 ranges (at most 8)"] });
  });
});
