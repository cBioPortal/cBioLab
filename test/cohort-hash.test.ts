// A cohort's fingerprint: the same members hash the same however the definition is stored, and
// anything that changes who is in it changes the hash.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cohortHash, canonicalCohort } from "../lib/cohort-hash.ts";
import type { CohortDef } from "../lib/types.ts";

const def: CohortDef = { study: "msk_chord_2024", all: [{ kind: "clinical", attribute: "SEX", values: ["Female"] }, { kind: "oql", q: "KRAS: MUT" }] };

describe("cohortHash", () => {
  test("is SHA-256 of the canonical form, across padding boundaries and non-ASCII text", () => {
    for (const q of ["", "abc", ...[24, 25, 26, 33, 34, 89, 90, 97].map((n) => "x".repeat(n)), "é ⑂ 😀".repeat(40)]) {
      const d = { all: [{ kind: "oql", q }] } as CohortDef;
      assert.equal(cohortHash(d), createHash("sha256").update(canonicalCohort(d)).digest("hex"));
    }
  });

  test("key order, notes, provenance and splits do not change it", () => {
    const reordered = JSON.parse('{"all":[{"values":["Female"],"attribute":"SEX","kind":"clinical"},{"q":"KRAS: MUT","kind":"oql"}],"study":"msk_chord_2024"}');
    assert.equal(cohortHash(reordered), cohortHash(def));
    assert.equal(cohortHash({ ...def, notes: "why" }), cohortHash(def));
    assert.equal(cohortHash({ ...def, from: { saved: "id", name: "n", hash: "h" } }), cohortHash(def));
    assert.equal(cohortHash({ ...def, splits: { sex: { arms: [] } } }), cohortHash(def));
  });

  test("anything that changes the members changes it", () => {
    assert.notEqual(cohortHash({ ...def, study: "msk_met_2021" }), cohortHash(def));
    assert.notEqual(cohortHash({ ...def, all: [...def.all!].reverse() }), cohortHash(def));
    assert.notEqual(cohortHash({ ...def, all: [{ kind: "oql", q: "KRAS: MUT" }] }), cohortHash(def));
  });
});
