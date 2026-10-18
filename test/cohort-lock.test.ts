// Locked cohorts (lib/cohort-lock.ts): a locked cohort, and each locked split arm, is evaluated
// from its frozen set wherever it is compiled; an arm added after the lock is evaluated inside the
// frozen cohort; the sets a lock names are read for its request, and never go where ids may not.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyLocks, lockDate } from "../lib/cohort-lock.ts";
import { resolveExtends } from "../lib/cohort-extends.ts";
import { compileCohortDef } from "../lib/cohort2.ts";
import { withIdSets, idSetRefsIn, idSetTableName } from "../lib/id-sets.ts";
import { carriesPatientIds } from "../lib/federation.ts";
import { lockDriftSql } from "../lib/cohort2.ts";
import type { AnalysisDoc, CohortLock } from "../lib/types.ts";

const P = "11111111-1111-4111-8111-111111111111", S = "22222222-2222-4222-8222-222222222222", F = "33333333-3333-4333-8333-333333333333";
const lock: CohortLock = { set: P, n: 3, samples: S, nSamples: 4, at: "2026-10-18T16:30:00.000Z", dataVersion: "v1", oncokbPin: "v7.5",
  children: { "sex / Female": { set: F, n: 1 } } };
const KRAS = { kind: "oql" as const, q: "KRAS: MUT" };
const female = { kind: "clinical" as const, attribute: "SEX", values: ["Female"] };
// a document as runAnalysis has it after splits are expanded: the arms `extends` their cohort
const expanded = (): AnalysisDoc => ({ study: "s1", cohorts: {
  A: { all: [KRAS], lock },
  "A / sex / Female": { extends: "A", all: [female] },
  "A / stage / IV": { extends: "A", all: [{ kind: "clinical", attribute: "STAGE", values: ["IV"] }] },
  B: { all: [KRAS] },
} });

describe("applyLocks", () => {
  test("a locked cohort, and its locked arm, become their sets; the rest keep their definitions", () => {
    const { doc, locked } = applyLocks(expanded());
    assert.deepEqual(doc.cohorts.A.all, [{ kind: "patientList", set: P }]);
    assert.deepEqual(doc.cohorts["A / sex / Female"].all, [{ kind: "patientList", set: F }]);
    assert.equal(doc.cohorts["A / sex / Female"].extends, undefined, "a frozen arm does not inherit its cohort's clauses");
    assert.deepEqual(doc.cohorts.B.all, [KRAS]);
    assert.deepEqual(Object.keys(locked).sort(), ["A", "A / sex / Female"]);
    assert.equal(locked["A / sex / Female"].cohort, "A");
  });
  test("an arm added after the lock is evaluated inside the frozen cohort, so arms still add up to it", () => {
    const resolved = resolveExtends(applyLocks(expanded()).doc);
    assert.deepEqual(resolved.cohorts["A / stage / IV"].all, [{ kind: "patientList", set: P }, { kind: "clinical", attribute: "STAGE", values: ["IV"] }]);
  });
  test("the live document is the same cohorts without their locks: what the definitions select now", () => {
    const live = resolveExtends(applyLocks(expanded()).live);
    assert.deepEqual(live.cohorts.A.all, [KRAS]);
    assert.equal(live.cohorts.A.lock, undefined);
    assert.deepEqual(live.cohorts["A / sex / Female"].all, [KRAS, female]);
  });
  test("a document with no lock is handed back untouched", () => {
    const d: AnalysisDoc = { cohorts: { B: { all: [KRAS] } } };
    const r = applyLocks(d);
    assert.equal(r.doc, d);
    assert.equal(r.live, d);
  });
  test("a lock that names no set, no count or no moment is refused by name, not run as its definition", () => {
    assert.throws(() => applyLocks({ cohorts: { A: { all: [KRAS], lock: { ...lock, set: "nope" } } } }), /“A” is locked, but its lock names no stored set/);
    assert.throws(() => applyLocks({ cohorts: { A: { all: [KRAS], lock: { ...lock, n: -1 } } } }), /does not say how many/);
    assert.throws(() => applyLocks({ cohorts: { A: { all: [KRAS], lock: { ...lock, at: "soon" } } } }), /does not say when/);
  });
});

describe("a locked cohort compiled anywhere", () => {
  const sets = (fn: () => string) => withIdSets([{ id: P, name: "A — locked", level: "patient", count: 3, perStudy: { s1: ["P-1", "P-2", "P-3"] } }],
    new Map([["s1", "a"]]), async () => fn());
  test("compiles to its frozen set even outside runAnalysis (Explore, an oncoprint spec)", async () => {
    const sql = await sets(() => compileCohortDef({ all: [KRAS], lock }, { study: "s1", db: "db" }));
    assert.match(sql, new RegExp("IN \\(SELECT id FROM " + idSetTableName(P, "s1") + "\\)"));
    assert.doesNotMatch(sql, /KRAS/);
  });
  test("the drift query measures the frozen set against the definition, and new samples against the frozen samples", async () => {
    const sql = await withIdSets([{ id: S, name: "A — samples", level: "sample", count: 4, perStudy: { s1: ["S-1"] } }], new Map([["s1", "a"]]),
      async () => lockDriftSql("SELECT 'P-1' AS pid", "SELECT 'P-9' AS pid", "s1", "db", S));
    assert.match(sql, /AS entered/);
    assert.match(sql, /AS left/);
    assert.match(sql, new RegExp("NOT IN \\(SELECT id FROM " + idSetTableName(S, "s1") + "\\)"));
  });
});

describe("a lock's sets travel with its request, and nowhere ids may not", () => {
  test("idSetRefsIn finds the patients, samples and arm sets a lock names", () => {
    assert.deepEqual(idSetRefsIn({ cohorts: { A: { all: [KRAS], lock } } }).sort(), [P, S, F].sort());
  });
  test("carriesPatientIds counts a locked cohort as ids", () => {
    assert.equal(carriesPatientIds({ all: [KRAS], lock }), true);
    assert.equal(carriesPatientIds({ all: [KRAS] }), false);
  });
  test("a lock is named by its day", () => {
    assert.equal(lockDate(lock.at), "18 Oct 2026");
  });
});
