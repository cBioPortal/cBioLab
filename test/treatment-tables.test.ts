// cBioPortal's treatment tables (STS-OT-6; lib/treatment-tables.ts) and the treatment clause
// (lib/cohort2.ts): the clause a selection adds (Union, the portal's default), the rows a draft
// already filters on, the sample table's order, and the leaf's refusals. Whether the clause selects
// what a row counts is checked against data by scripts/check-treatments.ts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { appliedTreatmentKeys, sampleTreatmentKey, sampleTreatmentOrder, treatmentClause } from "../lib/treatment-tables.ts";
import { compileCohortDef } from "../lib/cohort2.ts";

describe("the clause a table's checked rows add", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => "Agent" + i);
  const cases: [string, "patient" | "sample", string[], unknown][] = [
    ["nothing checked", "patient", [], { why: "no treatment is checked" }],
    ["patients treated with any checked agent", "patient", ["Fluorouracil", "Bevacizumab"],
      { clauses: [{ kind: "treatment", agents: ["Fluorouracil", "Bevacizumab"], ifHeld: true }] }],
    ["50 agents is one filter", "patient", many(50), { clauses: [{ kind: "treatment", agents: many(50), ifHeld: true }] }],
    ["51 is refused, naming the limit", "patient", many(51), { why: "one filter holds at most 50 treatments; 51 are checked" }],
    ["samples of one time are one leaf", "sample", [sampleTreatmentKey("Leucovorin", "Pre"), sampleTreatmentKey("Oxaliplatin", "Pre")],
      { clauses: [{ kind: "treatment", agents: ["Leucovorin", "Oxaliplatin"], time: "Pre", ifHeld: true }] }],
    ["Pre and Post rows are any of two leaves", "sample", [sampleTreatmentKey("Leucovorin", "Pre"), sampleTreatmentKey("Bevacizumab", "Post")],
      { clauses: [{ any: [{ kind: "treatment", agents: ["Leucovorin"], time: "Pre", ifHeld: true }, { kind: "treatment", agents: ["Bevacizumab"], time: "Post", ifHeld: true }] }] }],
    ["an agent's name may hold the separator", "sample", [sampleTreatmentKey("AGENT_A::X", "Post")],
      { clauses: [{ kind: "treatment", agents: ["AGENT_A::X"], time: "Post", ifHeld: true }] }],
    ["a treatment with no name is refused rather than sent", "patient", [""], { why: "a treatment with no name cannot be filtered on" }],
    ["51 Post rows are refused", "sample", many(51).map((a) => sampleTreatmentKey(a, "Post")), { why: "one filter holds at most 50 Post treatments; 51 are checked" }],
  ];
  for (const [name, level, keys, want] of cases) test(name, () => assert.deepEqual(treatmentClause(level, keys), want));
});

test("the applied rows: each table's own clauses, a Pre/Post pair as two rows, nothing from the other table or a mixed clause", () => {
  const def = { all: [
    { kind: "treatment", agents: ["Fluorouracil"] },
    { any: [{ kind: "treatment", agents: ["Leucovorin"], time: "Pre" }, { kind: "treatment", agents: ["Bevacizumab"], time: "Post" }] },
    { any: [{ kind: "treatment", agents: ["Cisplatin"] }, { kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] },
    { not: { kind: "treatment", agents: ["Irinotecan"] } },
  ] };
  assert.deepEqual(appliedTreatmentKeys(def, "patient"), ["Fluorouracil"]);
  assert.deepEqual(appliedTreatmentKeys(def, "sample"), ["Leucovorin::Pre", "Bevacizumab::Post"]);
  assert.deepEqual(appliedTreatmentKeys(null, "patient"), []);
});

test("the sample table keeps a treatment's Pre and Post together, by its larger count (the portal's coadread order)", () => {
  const rows = [
    { agent: "Leucovorin", time: "Pre" as const, n: 136 }, { agent: "Fluorouracil", time: "Post" as const, n: 1 },
    { agent: "Bevacizumab", time: "Post" as const, n: 1 }, { agent: "Fluorouracil", time: "Pre" as const, n: 155 },
    { agent: "Bevacizumab", time: "Pre" as const, n: 38 },
  ];
  assert.deepEqual(sampleTreatmentOrder(rows).map((r) => r.agent + " " + r.time + " " + r.n),
    ["Fluorouracil Pre 155", "Fluorouracil Post 1", "Leucovorin Pre 136", "Bevacizumab Pre 38", "Bevacizumab Post 1"]);
});

describe("the treatment clause compiled", () => {
  const ctx = { study: "coadread", db: "cbio" };
  const one = (leaf: object) => compileCohortDef({ all: [{ kind: "treatment", ...leaf }] } as never, ctx);
  test("patients, or samples by their time against the agent's first start", () => {
    assert.match(one({ agents: ["Fluorouracil"] }), /lower\(event_type\) = 'treatment' AND key = 'AGENT' AND value IN \('Fluorouracil'\)/);
    const pre = one({ agents: ["Fluorouracil"], time: "Pre" });
    assert.match(pre, /lower\(event_type\) IN \('sample acquisition','specimen'\) AND key = 'SAMPLE_ID'/);
    assert.match(pre, /min\(start_date\) AS st/);
    assert.match(pre, /WHERE sa\.t <= tx\.st/);
    assert.match(one({ agents: ["Fluorouracil"], time: "Post" }), /WHERE sa\.t > tx\.st/);
  });
  test("an agent the study never gives is refused by name, unless ifHeld", () => {
    assert.match(one({ agents: ["Fluorouracil"] }), /throwIf\(NOT has\(ts, 'Fluorouracil'\), 'treatment clause: no patient in coadread is treated with \\'Fluorouracil\\'/);
    assert.doesNotMatch(one({ agents: ["Fluorouracil"], ifHeld: true }), /throwIf/);
  });
  test("refusals: no agents, a bad time, past the limit", () => {
    assert.throws(() => one({ agents: [] }), /treatment clause needs agents\[\]/);
    assert.throws(() => one({ agents: ["X"], time: "During" }), /time is "Pre" or "Post" \(got "During"\)/);
    assert.throws(() => one({ agents: Array.from({ length: 51 }, (_, i) => "A" + i) }), /treatment clause: at most 50 values; this lists 51/);
  });
});
