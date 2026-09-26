// `extends`: a cohort inheriting another's `all` clauses, resolved before compilation.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveExtends } from "../lib/cohort-extends.ts";
import type { AnalysisDoc, Clause } from "../lib/types.ts";

const apcMutated: Clause = { kind: "oql", q: "APC: MUT" };
const rightSided: Clause = { kind: "clinical", attribute: "PRIMARY_SITE", values: ["Right"] };
const leftSided: Clause = { kind: "clinical", attribute: "PRIMARY_SITE", values: ["Left"] };
const under50: Clause = { kind: "clinical", attribute: "AGE", op: "<", value: 50 };

function doc(cohorts: AnalysisDoc["cohorts"]): AnalysisDoc {
  return { cohorts };
}

describe("resolveExtends", () => {
  test("a cohort with no extends is untouched", () => {
    const d = doc({ base: { all: [apcMutated] } });
    const out = resolveExtends(d);
    assert.deepEqual(out.cohorts.base.all, [apcMutated]);
  });

  test("a child's own clauses are spliced AFTER the parent's", () => {
    const d = doc({
      base: { all: [apcMutated] },
      rightSided: { extends: "base", all: [rightSided] },
    });
    const out = resolveExtends(d);
    assert.deepEqual(out.cohorts.rightSided.all, [apcMutated, rightSided]);
    assert.equal(out.cohorts.rightSided.extends, undefined);
    // the parent itself is untouched
    assert.deepEqual(out.cohorts.base.all, [apcMutated]);
  });

  test("a 3-level chain (A <- B <- C) flattens all the way down", () => {
    const d = doc({
      base: { all: [apcMutated] },
      right: { extends: "base", all: [rightSided] },
      rightYoung: { extends: "right", all: [under50] },
    });
    const out = resolveExtends(d);
    assert.deepEqual(out.cohorts.rightYoung.all, [
      apcMutated, rightSided, under50,
    ]);
  });

  test("other fields (study, lineGap, notes) are always the child's own, never inherited", () => {
    const d = doc({
      base: { all: [apcMutated], study: "crc_apc_impact_2020", notes: "base note" },
      child: { extends: "base", all: [rightSided], study: "some_other_study" },
    });
    const out = resolveExtends(d);
    assert.equal(out.cohorts.child.study, "some_other_study");
    assert.equal(out.cohorts.child.notes, undefined);
  });

  test("a direct self-cycle is rejected loudly", () => {
    const d = doc({ a: { extends: "a", all: [apcMutated] } });
    assert.throws(() => resolveExtends(d), /extends a cycle/);
  });

  test("a chain cycle (A -> B -> A) is rejected loudly", () => {
    const d = doc({
      a: { extends: "b", all: [apcMutated] },
      b: { extends: "a", all: [rightSided] },
    });
    assert.throws(() => resolveExtends(d), /extends a cycle/);
  });

  test("extending an unknown cohort is rejected loudly, naming it", () => {
    const d = doc({ a: { extends: "nope", all: [apcMutated] } });
    assert.throws(() => resolveExtends(d), /extends unknown cohort "nope"/);
  });

  test("two independent children of the same parent both get the parent's clauses, without duplicating them into each other", () => {
    const d = doc({
      base: { all: [apcMutated] },
      right: { extends: "base", all: [rightSided] },
      left: { extends: "base", all: [leftSided] },
    });
    const out = resolveExtends(d);
    assert.deepEqual(out.cohorts.right.all, [apcMutated, rightSided]);
    assert.deepEqual(out.cohorts.left.all, [apcMutated, leftSided]);
  });

  test("extends is refused when either side is the v1 bare event shorthand", () => {
    const d = doc({
      base: { a: { eventType: "TREATMENT" }, rel: { type: "BEFORE", maxDays: 30 }, b: null },
      child: { extends: "base", all: [rightSided] },
    });
    assert.throws(() => resolveExtends(d), /shorthand event form/);
  });

  test("a document with no extends at all is returned as the same object (fast path)", () => {
    const d = doc({ base: { all: [apcMutated] } });
    const out = resolveExtends(d);
    assert.equal(out, d);
  });
});
