// A view is drawn over every patient of its cohorts or not at all (lib/view-coverage.ts): the rule
// the engine refuses by and the page offers by.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { cantDraw, cohortStudies, viewNeed, type StudyAccess } from "../lib/view-coverage.ts";

const LOCAL: StudyAccess = { instance: "primary", patientLevel: true, remote: false, shares: [] };
const AGG: StudyAccess = { instance: "primary (aggregate-only)", patientLevel: false, remote: false, shares: [] };
const PEER: StudyAccess = { instance: "GENIE (via MCP)", patientLevel: false, remote: true, shares: [] };
const SHARING: StudyAccess = { instance: "GENIE (via MCP)", patientLevel: false, remote: true, shares: ["timeline", "alterations"] };
const access = (m: Record<string, StudyAccess>) => (s: string) => m[s];

describe("which views a federated study lets be drawn", () => {
  test("views of counts are drawn over any participant", () => {
    for (const kind of ["compare", "survival", "clinical", "cooccurrence", "coexpression", "hotspots", "attrition", "course", "sequence"])
      assert.equal(cantDraw(kind, ["a", "p"], access({ a: AGG, p: PEER })), null, kind);
  });

  test("a view whose output is patients is not drawn over a study that does not disclose them", () => {
    for (const kind of ["oncoprint", "table", "mutations", "cox", "logistic", "riskmodel"]) {
      assert.equal(cantDraw(kind, ["l"], access({ l: LOCAL })), null, kind);
      assert.match(cantDraw(kind, ["l", "p"], access({ l: LOCAL, p: SHARING }))!, /leaving out the patients of p — GENIE \(via MCP\) is a remote peer, which shares no patient-level data/, kind);
      assert.match(cantDraw(kind, ["g"], access({ g: AGG }))!, /g — primary \(aggregate-only\) answers with aggregate counts only/, kind);
    }
  });

  test("a patient view is drawn over a peer that shares its kind, and only that kind", () => {
    assert.equal(cantDraw("timeline", ["l", "p"], access({ l: LOCAL, p: SHARING })), null);
    assert.equal(cantDraw("alterations", ["p"], access({ p: SHARING })), null);
    const timelineOnly = { ...SHARING, shares: ["timeline"] };
    assert.equal(cantDraw("timeline", ["p"], access({ p: timelineOnly })), null);
    assert.match(cantDraw("alterations", ["p"], access({ p: timelineOnly }))!, /does not share patient alterations/);
    assert.match(cantDraw("timeline", ["p"], access({ p: PEER }))!, /does not share patient timelines/);
    assert.match(cantDraw("timeline", ["g"], access({ g: AGG }))!, /aggregate counts only/);
  });

  test("the aggregates a remote peer does not serve: drawn over local participants, aggregate-only included", () => {
    for (const kind of ["genome", "pathways", "enrichment", "plot", "labs", "composition"]) {
      assert.equal(cantDraw(kind, ["l", "g"], access({ l: LOCAL, g: AGG })), null, kind);
      assert.match(cantDraw(kind, ["l", "p"], access({ l: LOCAL, p: SHARING }))!, /p — GENIE \(via MCP\) is a remote peer, which does not answer this view yet/, kind);
    }
  });

  test("every study left out is named; one whose access is unknown is not held against the view", () => {
    const r = cantDraw("oncoprint", ["p1", "u", "p2"], access({ p1: PEER, p2: PEER }))!;
    assert.match(r, /^Cannot be drawn without leaving out the patients of p1 — .*; p2 — .*\.$/);
    assert.doesNotMatch(r, /\bu\b/);
  });

  test("a cohort's studies: its list, else its study, else the document's", () => {
    assert.deepEqual(cohortStudies({ studies: ["a", "b"] }, "d"), ["a", "b"]);
    assert.deepEqual(cohortStudies({ study: "a" }, "d"), ["a"]);
    assert.deepEqual(cohortStudies({}, "d"), ["d"]);
    assert.deepEqual(cohortStudies(undefined, "d"), ["d"]);
  });

  // The rule names what each kind needs; a runner that leaves a participant out is the evidence.
  // A new view kind that excludes participants without a rule here would draw a partial cohort.
  test("every runner that leaves participants out has a rule", () => {
    for (const f of readdirSync("lib/views").filter((f) => f.endsWith(".ts") && !["shared.ts", "rows.ts", "run.ts", "index.ts"].includes(f))) {
      const kind = f.slice(0, -3), src = readFileSync("lib/views/" + f, "utf8");
      if (/\banswering\(/.test(src)) assert.equal(viewNeed(kind), "local", kind + " leaves out participants without view aggregates");
      if (/\browHolders\(/.test(src)) assert.ok(["patients", "timeline", "alterations"].includes(viewNeed(kind)!), kind + " leaves out participants that do not disclose rows");
    }
    for (const kind of ["oncoprint", "cox", "logistic", "riskmodel"]) assert.equal(viewNeed(kind), "patients", kind);
  });
});
