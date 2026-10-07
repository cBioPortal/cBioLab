// The request envelopes (lib/api-schemas.ts): the routes' own parameters are checked and refused by
// name; what the envelope carries — documents, definitions, specs — passes through for the engine.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseBody, AnalysisRequest, ViewPageRequest, PatientsOfRequest, ExploreRequest, MembersRequest, OncoprintDetailRequest } from "../lib/api-schemas.ts";

const doc = { study: "s1", cohorts: { A: { all: [{ kind: "oql", q: "TP53: MUT" }] } }, views: [{ kind: "table", query: { search: "x" } }] };

describe("request envelopes", () => {
  test("a valid body passes with its contents untouched and unknown fields kept", () => {
    const b = parseBody(AnalysisRequest, { ...doc, dsl: "2.4", somethingNew: { a: 1 } });
    assert.deepEqual(b.cohorts, doc.cohorts);
    assert.deepEqual(b.views, doc.views);
    assert.deepEqual(b.somethingNew, { a: 1 });
  });
  test("defaults are filled in", () => {
    const b = parseBody(ViewPageRequest, { doc, view: 0 });
    assert.equal(b.offset, 0);
    assert.equal(b.limit, 25);
  });
  test("a wrong envelope field is refused by name, not coerced", () => {
    assert.throws(() => parseBody(ViewPageRequest, { doc, view: "x", limit: 5000 }),
      /request body: view: .*number.*; limit: .*1000/);
    assert.throws(() => parseBody(ViewPageRequest, { view: 0 }), /doc: /);
    assert.throws(() => parseBody(MembersRequest, { def: [], studies: ["s"] }), /def: def must be an object/);
    assert.throws(() => parseBody(OncoprintDetailRequest, { spec: {} }), /column: /);
  });
  test("a view must at least say what kind it is; a cohort must be an object", () => {
    assert.throws(() => parseBody(AnalysisRequest, { ...doc, views: [{ genes: ["TP53"] }] }), /views\.0: a view must be an object with a `kind`/);
    assert.throws(() => parseBody(AnalysisRequest, { ...doc, cohorts: { A: "TP53" } }), /cohorts\.A: a cohort must be an object/);
  });
  test("a route's own limits keep their messages", () => {
    assert.throws(() => parseBody(PatientsOfRequest, { samples: [] }), /non-empty array of sample ids/);
    assert.throws(() => parseBody(PatientsOfRequest, { samples: Array(50001).fill("s") }), /50,000-id ceiling/);
  });
  test("uploads are named by reference, with a version", () => {
    assert.throws(() => parseBody(ExploreRequest, { study: "s", customRefs: [{ as: "x", dataset: "d" }] }), /customRefs\.0\.version/);
    assert.ok(parseBody(ExploreRequest, { study: "s", customRefs: [{ as: "x", dataset: "d", version: 2 }] }));
  });
});
