// ============================================================================
// THE PATIENT-DATA BOUNDARY — executable enforcement.
//
// Rule (see docs/DATA-BOUNDARY.md): patient-level data must never leave the
// database that holds it, except to an instance explicitly entitled to
// patient-level access. Aggregate-only participants — a local instance flagged
// as such, or any remote peer reached over MCP — may answer with counts and
// nothing else, in either direction:
//
//   OUT: no query sent to them may embed patient identifiers.
//   IN:  no response from them may contain patient identifiers.
//
// These tests fail if that is ever weakened. Most need no database; the ones
// that do are skipped when CLICKHOUSE_URL is absent, so the boundary is
// checked even on a machine with no credentials.
//
// Run: npm test
// ============================================================================
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";

import {
  carriesPatientIds, plotBinsSql, plotBoxSql, plotCountSql, plotCoverageSql, plotHighlightCountSql, plotMomentsSql, plotStatsSql, plotTableSql, plotViolinSql,
  geneCountsSql, survivalCountsSql, survivalEndpointsSql, anchoredSurvivalSql, pairCountsSql,
  clinicalCountsSql, clinicalMomentsSql, clinicalHistogramSql, attributeQuantileSql, momentPairsSql, variantCountsSql, geneMutationTotalsSql, profileMomentsSql,
  lollipopChangesSql, lollipopTypesSql, lollipopTotalsSql, cohortSampleCountSql,
  timelineSpanSql, eventCourseSql, sequenceSql, sequenceKeysSql, coxRowsSql, logisticRowsSql,
  AggregateResolver, PatientLevelResolver, isPatientLevel
} from "../lib/federation.ts";
import * as federation from "../lib/federation.ts";
import { axisSelect, highlightCohortSql, plotPointsSql, plotScatterPointsSql, plotRankedPointsSql } from "../lib/plot.ts";
import { clinicalRowSource } from "../lib/clinical-table.ts";
import { mutationRowSource } from "../lib/mutation-table.ts";
import { alterationPatientRowSource, alterationSource, patientSamplesSource } from "../lib/patient-alterations.ts";
import { pageSql } from "../lib/table-query.ts";
import { RemoteAggregateResolver, RemotePatientResolver, RemoteTimelineResolver, peerPatientKinds, remoteStudies, remoteCatalog } from "../lib/federation-remote.ts";
import { parseRules, allowedKinds } from "../lib/disclosure.ts";
import { asLoopbackPeer, isLoopbackRequest, loopbackHeaders, loopbackUrl, LOOPBACK_HEADER } from "../lib/loopback-peer.ts";
import type { Instance } from "../lib/federation.ts";
import { PRIMARY, chQuery, connById, directConnections, assertNotLoopbackDirect } from "../lib/ch.ts";

const AGG: Instance = { id: "peer", mode: "aggregate-only", label: "test peer", conn: PRIMARY };
const PL: Instance = { id: "a", mode: "patient-level", label: "test primary", conn: PRIMARY };

/** Column-ish tokens that would denote an individual patient or sample. */
const IDENTIFIER_COLUMNS = ["patient_unique_id", "sample_unique_id", "stable_id", "patient_id", "pid"];

/**
 * Extract the OUTER select list of a query — what the caller actually receives.
 * Inner subqueries may legitimately select ids (a cohort subquery computes the
 * membership the aggregates are taken over); only what crosses the wire matters.
 */
function outerProjection(sql: string): string[] {
  // Depth-aware: CTEs and subqueries live inside parentheses, so only a SELECT
  // at depth 0 is what the caller actually receives. Text is preserved (not
  // flattened) so aggregate calls remain recognisable.
  let depth = 0, selectAt = -1, fromAt = -1;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0) {
      if (selectAt < 0 && /select/i.test(sql.slice(i, i + 6)) && !/\w/.test(sql[i - 1] || " ")) { selectAt = i + 6; }
      else if (selectAt >= 0 && fromAt < 0 && /from/i.test(sql.slice(i, i + 4)) && !/\w/.test(sql[i - 1] || " ")) { fromAt = i; break; }
    }
  }
  if (selectAt < 0 || fromAt < 0) throw new Error("no top-level SELECT..FROM in: " + sql.slice(0, 120));
  // split the projection on depth-0 commas
  const list = sql.slice(selectAt, fromAt);
  const out: string[] = [];
  let buf = "", d = 0;
  for (const ch of list) {
    if (ch === "(") d++;
    else if (ch === ")") d--;
    if (ch === "," && d === 0) { out.push(buf.trim()); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

/** Every projected item must be an aggregate or a non-identifying grouping key. */
function assertAggregateOnly(sql: string, what: string) {
  for (const item of outerProjection(sql)) {
    const isAggregate = /\b(count|uniqExact|uniqExactIf|countIf|sum|sumIf|avg|min|max|any|anyIf|argMin|argMax|median|quantile)\s*\(/i.test(item);
    if (isAggregate) continue;
    const alias = item.split(/\s+as\s+/i).pop()!.trim().replace(/[`"]/g, "");
    const expr = item.split(/\s+as\s+/i)[0].toLowerCase();
    const namesAnId = IDENTIFIER_COLUMNS.some((c) => expr.includes(c)) || IDENTIFIER_COLUMNS.includes(alias);
    assert.equal(namesAnId, false,
      what + " projects a patient identifier across the boundary: " + item);
  }
}

// ---------------------------------------------------------------------------
describe("carriesPatientIds: detects identifiers anywhere in a definition", () => {
  test("sampleList leaf in all[]", () => {
    assert.equal(carriesPatientIds({ all: [{ kind: "sampleList", ids: ["s:S-1"] }] }), true);
  });
  test("patientList leaf in all[]", () => {
    assert.equal(carriesPatientIds({ all: [{ kind: "patientList", ids: ["s:P-1"] }] }), true);
  });
  test("patientList leaf nested in any[]", () => {
    assert.equal(carriesPatientIds({ all: [{ any: [{ kind: "oql", q: "TP53: MUT" }, { kind: "patientList", ids: ["s:P-1"] }] }] }), true);
  });
  test("patientList leaf nested in not", () => {
    assert.equal(carriesPatientIds({ all: [{ not: { kind: "patientList", ids: ["s:P-1"] } }] }), true);
  });
  // the compiler takes a clause, not just a leaf, under `not`: {not:{not:L}} is exactly L
  test("patientList leaf under a double not", () => {
    assert.equal(carriesPatientIds({ all: [{ not: { not: { kind: "patientList", ids: ["s:P-1"] } } } as any] }), true);
  });
  test("sampleList leaf in an any[] under not", () => {
    assert.equal(carriesPatientIds({ all: [{ not: { any: [{ kind: "oql", q: "TP53: MUT" }, { kind: "sampleList", ids: ["s:S-1"] }] } } as any] }), true);
  });
  test("ids nested at any depth", () => {
    assert.equal(carriesPatientIds({ all: [{ not: { not: { not: { any: [{ kind: "patientList", ids: ["s:P-1"] }] } } } } as any] }), true);
  });
  test("ordinary clauses do not trip it", () => {
    assert.equal(carriesPatientIds({ all: [{ kind: "oql", q: "TP53: MUT" }, { kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] }), false);
    assert.equal(carriesPatientIds(null), false);
    assert.equal(carriesPatientIds({ all: [{ kind: "patientList", ids: [] }] }), false); // empty list carries nothing
  });
});

// ---------------------------------------------------------------------------
describe("aggregate-only resolvers cannot expose patient-level data", () => {
  const agg = new AggregateResolver("s", {}, AGG);
  const pl = new PatientLevelResolver("s", {}, PL);

  test("structurally has no members() — the guarantee is a missing method, not a flag", () => {
    assert.equal(typeof (agg as unknown as { members?: unknown }).members, "undefined");
    assert.equal(typeof (pl as unknown as { members?: unknown }).members, "function");
  });

  test("the per-patient rows behind a waterfall are the same kind of missing method", () => {
    assert.equal(typeof (agg as unknown as { viewRows?: unknown }).viewRows, "undefined");
    assert.equal(typeof (pl as unknown as { viewRows?: unknown }).viewRows, "function");
    // and a remote peer answers neither the per-patient rows nor the new aggregates
    const remote = RemoteAggregateResolver.prototype as unknown as { viewRows?: unknown; viewAggregate?: unknown };
    assert.equal(typeof remote.viewRows, "undefined");
    assert.equal(typeof remote.viewAggregate, "undefined");
  });

  test("isPatientLevel discriminates correctly", () => {
    assert.equal(isPatientLevel(agg), false);
    assert.equal(isPatientLevel(pl), true);
  });

  test("refuses to compile SQL embedding patient ids", () => {
    assert.throws(() => agg.cohortSql({ all: [{ kind: "patientList", ids: ["s:P-0000123"] }] }),
      /explicit sample or patient list/i);
  });

  test("still compiles ordinary definitions", () => {
    const sql = agg.cohortSql({ all: [{ kind: "oql", q: "TP53: MUT" }] });
    assert.match(sql, /SELECT/i);
    assert.equal(sql.includes("P-0000123"), false);
  });

  test("a patient-level instance may use an explicit list (that is its entitlement)", () => {
    const sql = pl.cohortSql({ all: [{ kind: "patientList", ids: ["s:P-0000123"] }] });
    assert.match(sql, /P-0000123/);
  });
});

// ---------------------------------------------------------------------------
describe("remote peers: nothing identifying leaves before the network is touched", () => {
  test("every method refuses an id-carrying definition without calling fetch", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; throw new Error("network must not be reached"); }) as typeof fetch;
    try {
      const r = new RemoteAggregateResolver("s", "http://peer.invalid/api/mcp", AGG);
      const def = { all: [{ kind: "patientList" as const, ids: ["s:P-0000123"] }] };
      await assert.rejects(() => r.count(def), /explicit sample or patient list/i);
      await assert.rejects(() => r.geneCounts(def, ["TP53"]), /explicit sample or patient list/i);
      await assert.rejects(() => r.survivalCounts(def), /explicit sample or patient list/i);
      await assert.rejects(() => r.pairCounts(def, [["TP53", "KRAS"]]), /explicit sample or patient list/i);
      await assert.rejects(() => r.attributeStats(def, ["SEX"]), /explicit sample or patient list/i);
      await assert.rejects(() => r.pairMoments(def, [["ERBB2", "GRB7"]], "p"), /explicit sample or patient list/i);
      await assert.rejects(() => r.variantCounts(def, ["KRAS"]), /explicit sample or patient list/i);
      await assert.rejects(() => r.profileMoments(def, ["ERBB2"], "p"), /explicit sample or patient list/i);
      assert.equal(calls, 0, "the guard must run before any request is made");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a table view's rows are the entitlement, and live only where it lives", () => {
    // the row sources return patient and sample ids, so they sit outside the aggregate builders
    for (const name of ["clinicalRowSource", "mutationRowSource", "pageSql", "rankSql", "alterationPatientRowSource", "alterationSource",
      "patientMutationsSource", "patientCnaSource", "patientSvSource", "patientSamplesSource"])
      assert.equal(name in (federation as Record<string, unknown>), false, name + " returns ids and must not sit among the aggregate builders");
    const part = [{ cohort: "c", study: "x", cohortSql: "SELECT '' AS pid" }];
    assert.match(pageSql(clinicalRowSource(part, "db", "sample", [{ id: "AGE", name: "Age", per: "patient", numeric: true }]), {}, [], 10, 0), /AS patient, replaceOne\(u\.suid/);
    assert.match(pageSql(mutationRowSource(part, "db", "KRAS", "v7.5"), {}, [], 10, 0), /m\.sid AS sid/);
    // the alterations view's list and its three tables name one patient and their samples
    assert.match(pageSql(alterationPatientRowSource(part.map((p) => ({ ...p, source: "s" })), "db"), {}, [], 10, 0), /c\.pid AS patient/);
    for (const t of ["mutations", "cna", "sv"] as const)
      assert.match(pageSql(alterationSource(t, part[0], "P-1", "db", "v7.5", []), {}, [], 10, 0), /'P-1' AS patient/);
    assert.match(pageSql(patientSamplesSource(part[0], "P-1", "db"), {}, [], 10, 0), /s\.id AS sid/);
    for (const m of ["rowsPage", "rowsCounts", "rowsValues", "rowsRank"]) {
      for (const R of [AggregateResolver, RemoteAggregateResolver])
        assert.equal(typeof (R.prototype as unknown as Record<string, unknown>)[m], "undefined", R.name + " must not be able to run a table view's " + m);
      assert.equal(typeof (PatientLevelResolver.prototype as unknown as Record<string, unknown>)[m], "function");
    }
  });

  test("a box plot's points are the entitlement, and live only where it lives", () => {
    // The one plot query that returns case ids. It must not be reachable through the aggregate
    // contract, so it is deliberately absent from lib/federation.ts's exports — the sweep above
    // is for builders any participant may run, and this is not one of them.
    assert.equal("plotPointsSql" in (federation as Record<string, unknown>), false,
      "plotPointsSql returns case ids and must not sit among the aggregate builders");
    // it does exist, in the module that owns plot SQL, and it does return an id
    assert.match(plotPointsSql("SELECT 1 AS id, 1 AS v", "SELECT 1 AS id, 'g' AS v", "SELECT '' AS pid"), /vs\.id AS id/);
    // and the aggregate-only participants have no method that could call it
    assert.equal(typeof (AggregateResolver.prototype as unknown as Record<string, unknown>).plotPoints, "undefined",
      "AggregateResolver must not be able to return the points behind a box");
    assert.equal(typeof (PatientLevelResolver.prototype as unknown as Record<string, unknown>).plotPoints, "function",
      "the entitled participant is the one that answers with points");
    // a scatter's own points (every case, or its sparse-cell outliers) are the same entitlement
    for (const R of [AggregateResolver, RemoteAggregateResolver])
      assert.equal(typeof (R.prototype as unknown as Record<string, unknown>).plotScatterPoints, "undefined",
        R.name + " must not be able to return a scatter's points");
    assert.equal(typeof (PatientLevelResolver.prototype as unknown as Record<string, unknown>).plotScatterPoints, "function");
    assert.match(plotScatterPointsSql("SELECT 1 AS id, 1 AS v", "SELECT 1 AS id, 2 AS v", "SELECT '' AS pid", 10,
      { grid: [4, 4], extent: { x0: 0, x1: 1, y0: 0, y1: 1 }, cellMax: 2 }), /xs\.id AS id/);
    // a ranked layer (extremes, or furthest from the fit) names its cases: the same entitlement
    for (const R of [AggregateResolver, RemoteAggregateResolver])
      assert.equal(typeof (R.prototype as unknown as Record<string, unknown>).plotRankedPoints, "undefined",
        R.name + " must not be able to return a ranked layer's points");
    assert.equal(typeof (PatientLevelResolver.prototype as unknown as Record<string, unknown>).plotRankedPoints, "function");
    assert.equal("plotRankedPointsSql" in (federation as Record<string, unknown>), false,
      "plotRankedPointsSql returns case ids and must not sit among the aggregate builders");
    assert.match(plotRankedPointsSql("SELECT 1 AS id, 1 AS v", "SELECT 1 AS id, 2 AS v", "SELECT '' AS pid", "scatter", true, { by: "y", n: 5 }), /xs\.id AS id/);
  });

  test("a highlight's points are the entitlement too; its aggregates are anyone's", () => {
    // a scatter's points carry case ids, so their builder sits beside plotPointsSql, not among the aggregates
    assert.equal("plotScatterPointsSql" in (federation as Record<string, unknown>), false,
      "plotScatterPointsSql returns case ids and must not sit among the aggregate builders");
    assert.match(plotScatterPointsSql("SELECT 1 AS id, 1 AS v", "SELECT 1 AS id, 2 AS v", "SELECT '' AS pid"), /xs\.id AS id/);
    for (const R of [AggregateResolver, RemoteAggregateResolver])
      assert.equal(typeof (R.prototype as unknown as Record<string, unknown>).plotHighlightPoints, "undefined",
        R.name + " must not be able to return a highlight's points");
    assert.equal(typeof (PatientLevelResolver.prototype as unknown as Record<string, unknown>).plotHighlightPoints, "function");
    // the aggregate fallback is answerable by an aggregate-only participant, which is the point of it
    for (const m of ["plotHighlightCount", "plotHighlightBins", "plotHighlightBoxRows"])
      assert.equal(typeof (AggregateResolver.prototype as unknown as Record<string, unknown>)[m], "function", "AggregateResolver answers " + m);
  });

  test("a patient's timeline is the entitlement, and lives only where it lives", () => {
    // the timeline's queries name one patient and return their record, so they sit outside the aggregate builders
    for (const name of ["patientEventsSql", "patientSamplesSql", "timelinePatientRowSource"])
      assert.equal(name in (federation as Record<string, unknown>), false, name + " reads a patient's record and must not sit among the aggregate builders");
    for (const R of [AggregateResolver, RemoteAggregateResolver])
      assert.equal(typeof (R.prototype as unknown as Record<string, unknown>).patientTimeline, "undefined", R.name + " must not be able to return a patient's timeline");
    assert.equal(typeof (PatientLevelResolver.prototype as unknown as Record<string, unknown>).patientTimeline, "function");
  });

  test("remote resolver has no members() either", () => {
    const r = new RemoteAggregateResolver("s", "http://peer.invalid/api/mcp", AGG);
    assert.equal(typeof (r as unknown as { members?: unknown }).members, "undefined");
  });
});

// ---------------------------------------------------------------------------
describe("federation SQL returns aggregates, never identifiers", () => {
  const cohortSql = "SELECT DISTINCT replaceOne(patient_unique_id, 'x_', '') AS pid FROM db.sample_derived";

  /**
   * Every aggregate SQL builder, with arguments that exercise it. Naming a
   * builder here is not optional: the coverage test below fails if any
   * `*Sql` export from lib/federation.ts is absent, so a new aggregate cannot
   * reach a peer without someone deciding what it may project. Several cases
   * may share one builder — the suffix after ':' is free-form.
   */
  // the axis subqueries the plot builders wrap, built the way the resolver builds them
  const axisCtx = { study: "x", db: "db", unit: "sample" as const, cohortSql };
  const numAxis = axisSelect({ source: "clinical", attribute: "MUTATION_COUNT" }, axisCtx, "num");
  const numAxis2 = axisSelect({ source: "molecular", profileType: "rna_seq_mrna", gene: "TP53" }, axisCtx, "num");
  const catAxis = axisSelect({ source: "clinical", attribute: "CANCER_TYPE" }, axisCtx, "cat");
  const catAxis2 = axisSelect({ source: "alteration", gene: "TP53", by: "mutationType" }, axisCtx, "cat");
  const catAxisGeneSet = axisSelect({ source: "alteration", genes: ["TP53", "KRAS", "APC"], by: "mutated" }, axisCtx, "cat");
  const catAxisOql = axisSelect({ source: "alteration", oql: "KRAS: G12C; STK11: DRIVER; ERBB2: EXP>2" }, { ...axisCtx, oncokbPin: "v7.4", profiles: ["rna_seq_v2_mrna_median_Zscores"] }, "cat");

  const LAB = { eventType: "Lab_Test", testKey: "TEST", test: "PSA", resultKey: "RESULT" };
  const LAB_ANCHOR = { eventType: "Treatment", key: "SUBTYPE", value: "Hormone", occurrence: "FIRST" as const };
  const LAB_OPTS = { baselineDays: 90, fromDays: -84, toDays: 364, binDays: 28 };
  const ACQ = { anchor: { eventType: "Treatment", key: "SUBTYPE", value: "Hormone" }, sampleEvents: ["Sample acquisition", "Sequencing"], sampleKey: "SAMPLE_ID", preWindowDays: null, minGapDays: 30 };
  const CTD = { attribute: "SAMPLE_CLASS", plasma: ["cfDNA", "ctDNA"], tissue: ["Tumor"], plasmaPanels: [] as string[], withinDays: null as number | null, sampleEvents: ["Sequencing"], sampleKey: "SAMPLE_ID" };
  const BUILDERS: Record<string, () => string> = {
    // Plots: an axis selects (id, value) per case, but every builder here groups the id away.
  // If one ever projected a case id, this suite is what would stop it reaching a peer.
  "plotCountSql": () => plotCountSql(numAxis, catAxis, cohortSql, false),
  "plotCountSql:numeric": () => plotCountSql(numAxis, numAxis2, cohortSql, true),
  "plotStatsSql": () => plotStatsSql(numAxis, numAxis2, cohortSql),
  "plotBinsSql": () => plotBinsSql(numAxis, numAxis2, cohortSql),
  "plotBinsSql:sharedExtent": () => plotBinsSql(numAxis, numAxis2, cohortSql, undefined, { x0: 0, x1: 10, y0: 0, y1: 10 }),
  "plotMomentsSql": () => plotMomentsSql(numAxis, numAxis2, cohortSql),
  "plotBoxSql": () => plotBoxSql(numAxis, catAxis, cohortSql),
  "plotTableSql": () => plotTableSql(catAxis, catAxis2, cohortSql),
  // A gene-SET alteration axis (item 2b) is still just a WHERE ... IN (...) — never a
  // per-gene identifier — so it must pass the same aggregate-only check as a single gene.
  "plotTableSql:gene-set": () => plotTableSql(catAxis, catAxisGeneSet, cohortSql),
  // an OQL axis carries a query's matched cases inside it, and still groups every id away
  "plotTableSql:oql": () => plotTableSql(catAxis, catAxisOql, cohortSql),
  "plotBoxSql:oql": () => plotBoxSql(numAxis, catAxisOql, cohortSql),
  "plotViolinSql": () => plotViolinSql(numAxis, catAxis, cohortSql),
  "plotCoverageSql": () => plotCoverageSql(numAxis, catAxis, axisCtx),
  "plotCoverageSql:patient": () => plotCoverageSql(numAxis, catAxis, { ...axisCtx, unit: "patient" as const }),
  "plotHighlightCountSql": () => plotHighlightCountSql(cohortSql, cohortSql),
  // a highlight's aggregates are the plot's own builders over the narrowed cohort
  "plotBinsSql:highlight": () => plotBinsSql(numAxis, numAxis2, highlightCohortSql(cohortSql, cohortSql), undefined, { x0: 0, x1: 10, y0: 0, y1: 10 }),
  "plotBoxSql:highlight": () => plotBoxSql(numAxis, catAxis, highlightCohortSql(cohortSql, cohortSql)),
  "geneCountsSql": () => geneCountsSql(cohortSql, ["TP53", "KRAS"], "x", "v7.4", "db"),
    "geneCountsSql:no-annotation-pin": () => geneCountsSql(cohortSql, ["TP53"], "x", null, "db"),
    "survivalCountsSql": () => survivalCountsSql(cohortSql, "x", "db"),
    "survivalCountsSql:PFS": () => survivalCountsSql(cohortSql, "x", "db", "PFS"),
    // A custom monthsAttribute/statusAttribute override (item: non-standard endpoint naming)
    // still projects only aggregates — same query shape, just different literal column names.
    "survivalCountsSql:customColumns": () => survivalCountsSql(cohortSql, "x", "db", "CUSTOM", { months: "PFS_MONTHS_FIRST_LINE_TX", status: "PROGRESSION_STATUS" }),
    "survivalEndpointsSql": () => survivalEndpointsSql("x", "db"),
    "anchoredSurvivalSql": () => anchoredSurvivalSql(cohortSql, "x", "db", "OS", { eventType: "Treatment", key: "SUBTYPE", value: "Chemo", occurrence: "FIRST" }),
    "anchoredSurvivalSql:customColumns": () => anchoredSurvivalSql(cohortSql, "x", "db", "CUSTOM", { eventType: "Treatment" }, { months: "IO_PFS_MONTHS", status: "IO_PFS_STATUS" }),
    "pairCountsSql": () => pairCountsSql(cohortSql, [["TP53", "KRAS"], ["EGFR", "ALK"]], "x", "db"),
    "clinicalCountsSql": () => clinicalCountsSql(cohortSql, ["SEX", "CANCER_TYPE"], "x", "db"),
    "clinicalMomentsSql": () => clinicalMomentsSql(cohortSql, ["CURRENT_AGE_DEID"], "x", "db"),
    "clinicalHistogramSql": () => clinicalHistogramSql(cohortSql, ["CURRENT_AGE_DEID"], "x", "db"),
    "attributeQuantileSql": () => attributeQuantileSql(cohortSql, "TMB_NONSYNONYMOUS", "patient", 0.8, "x", "db"),
    "momentPairsSql": () => momentPairsSql(cohortSql, [["ERBB2", "GRB7"]], "rna_seq_v2_mrna_median_Zscores", "x", "db"),
    "variantCountsSql": () => variantCountsSql(cohortSql, ["KRAS", "BRAF"], "x", 1, "db"),
    "variantCountsSql:suppressed": () => variantCountsSql(cohortSql, ["KRAS"], "x", 5, "db"),
    "geneMutationTotalsSql": () => geneMutationTotalsSql(cohortSql, ["KRAS"], "x", "db"),
    "lollipopChangesSql": () => lollipopChangesSql(cohortSql, ["KRAS", "BRAF"], "x", 1, "v7.5", "db"),
    "lollipopChangesSql:suppressed-unannotated": () => lollipopChangesSql(cohortSql, ["KRAS"], "x", 5, null, "db"),
    "lollipopTypesSql": () => lollipopTypesSql(cohortSql, ["KRAS"], "x", 3, "v7.5", "db"),
    "lollipopTotalsSql": () => lollipopTotalsSql(cohortSql, ["KRAS"], "x", "db"),
    "cohortSampleCountSql": () => cohortSampleCountSql(cohortSql, "x", "db"),
    "profileMomentsSql": () => profileMomentsSql(cohortSql, ["ERBB2"], "rna_seq_v2_mrna_median_Zscores", "x", "db"),
    "timelineSpanSql": () => timelineSpanSql(cohortSql, "x", "db"),
    // A course aligned on an event, and one aligned on the study's own day 0 —
    // structurally different SQL (the anchor CTE differs), so cover both.
    "eventCourseSql": () => eventCourseSql(cohortSql, "x", "db", {
      anchor: { eventType: "Treatment", key: "SUBTYPE", value: "Chemo", occurrence: "FIRST" },
      eventTypes: ["treatment", "surgery"], binMonths: 3, from: -4, to: 20 }),
    "eventCourseSql:day0": () => eventCourseSql(cohortSql, "x", "db", {
      anchor: null, eventTypes: ["treatment"], binMonths: 1, from: 0, to: 12 }),
    "sequenceSql": () => sequenceSql(cohortSql, "x", "db", {
      eventType: "Treatment", labelKey: "SUBTYPE", exclude: ["Prior Medications to MSK"],
      lineGap: 90, maxSteps: 3 }),
    "sequenceKeysSql": () => sequenceKeysSql(cohortSql, "x", "db", "Treatment"),
    // Cox rows are per-patient (unlike every other builder above), but still project no
    // identifier: `os.pid` only ever appears in a JOIN ON clause, never in the outer SELECT.
    "coxRowsSql": () => coxRowsSql(cohortSql, "x", "db", "OS", [{ label: "c0", sel: catAxis }, { label: "c1", sel: numAxis }]),
    "coxRowsSql:customColumns": () => coxRowsSql(cohortSql, "x", "db", "CUSTOM", [{ label: "c0", sel: catAxis }], { months: "PFS_MONTHS_FIRST_LINE_TX", status: "PROGRESSION_STATUS" }),
    // Same shape as coxRowsSql: the outcome is just another axis-selected CTE, joined the same
    // way — no identifier ever reaches the outer SELECT here either.
    "logisticRowsSql": () => logisticRowsSql(cohortSql, { label: "y0", sel: catAxis }, [{ label: "c0", sel: numAxis }]),
    // lib/federation-views.ts, re-exported through lib/federation.ts: the genome view's bins group
    // the sample id away inside `binned`; only (chrom, bin) and counts cross.
    "genomeBinsSql": () => federation.genomeBinsSql(cohortSql, "x", "db", { binBp: 2e6, threshold: 0.2, includeX: false }),
    "genomeBinsSql:withX": () => federation.genomeBinsSql(cohortSql, "x", "db", { binBp: 1e6, threshold: 0.3, includeX: true }),
    "genomeCoverageSql": () => federation.genomeCoverageSql(cohortSql, "x", "db"),
    "studyGenomeSql": () => federation.studyGenomeSql("x", "db"),
    // pathways: `per` holds (set, patient) rows, but the outer SELECT only counts them per set
    "geneSetCountsSql": () => federation.geneSetCountsSql(cohortSql, [{ name: "RTK-RAS", genes: ["KRAS", "NRAS"] }, { name: "TP53", genes: ["TP53"] }], "x", "v7.5", "db"),
    "geneSetCountsSql:no-annotation-pin": () => federation.geneSetCountsSql(cohortSql, [{ name: "set", genes: ["APC"] }], "x", null, "db"),
    // diffexpr: `vals` is per (patient, gene); only per-gene totals leave
    "profileMomentsAllSql": () => federation.profileMomentsAllSql(cohortSql, "x", "db", "rna_seq_v2_mrna_median_Zscores", false),
    "profileMomentsAllSql:log2": () => federation.profileMomentsAllSql(cohortSql, "x", "db", "rna_seq_v2_mrna", true),
    // gene-set membership is reference data, not patient data — no cohort at all
    "genesetMembersSql": () => federation.genesetMembersSql(["HALLMARK_E2F_TARGETS"], null, "db"),
    "genesetMembersSql:prefix": () => federation.genesetMembersSql([], "HALLMARK_", "db"),
    // paired: `ps`/`per` hold samples and patients; the outer SELECT counts them per gene
    "pairedCountsSql": () => federation.pairedCountsSql(cohortSql, "x", "db", ["TP53", "ESR1"], { attribute: "SAMPLE_TYPE", a: ["Primary"], b: ["Metastasis"] }, "v7.5", "driver"),
    "pairedCountsSql:any": () => federation.pairedCountsSql(cohortSql, "x", "db", ["TP53"], { attribute: "SAMPLE_TYPE", a: ["Primary"], b: ["Metastasis", "Recurrence"] }, null, "any"),
    "pairedCountsSql:scan": () => federation.pairedCountsSql(cohortSql, "x", "db", null, { attribute: "IMPACT_PRE_POST", a: ["PRE-TX"], b: ["POST-TX"] }, "v7.5", "driver"),
    "pairedCountsSql:scan:any": () => federation.pairedCountsSql(cohortSql, "x", "db", null, { attribute: "SAMPLE_TYPE", a: ["Primary"], b: ["Metastasis"] }, null, "any"),
    "pairedPatientsSql": () => federation.pairedPatientsSql(cohortSql, "x", "db", { attribute: "SAMPLE_TYPE", a: ["Primary"], b: ["Metastasis"] }),
    // acquired: `pick`/`ps` hold each patient's before and after sample; the outer SELECTs count them per gene or along the funnel
    "acquiredCountsSql": () => federation.acquiredCountsSql(cohortSql, "x", "db", ["TP53", "ESR1"], ACQ, "v7.5", "driver"),
    "acquiredCountsSql:scan-any": () => federation.acquiredCountsSql(cohortSql, "x", "db", null, { ...ACQ, preWindowDays: 365 }, null, "any"),
    "acquiredFunnelSql": () => federation.acquiredFunnelSql(cohortSql, "x", "db", ACQ),
    // ctdna: `classed`/`sides`/`ps` hold samples by kind; the outer SELECTs count them per gene, along the funnel, or per (detected, months, dead)
    "ctdnaCountsSql": () => federation.ctdnaCountsSql(cohortSql, "x", "db", ["EGFR"], CTD, "v7.5", "driver"),
    "ctdnaCountsSql:dated-panels": () => federation.ctdnaCountsSql(cohortSql, "x", "db", null, { ...CTD, plasmaPanels: ["ACCESS129"], withinDays: 90 }, null, "any"),
    "ctdnaFunnelSql": () => federation.ctdnaFunnelSql(cohortSql, "x", "db", CTD, "v7.5", "driver"),
    // exclusivity: `sp`/`altc`/`per` hold samples; the outer SELECTs count them per (panel signature, stratum, burden, mask) or per gene
    "exclusivityGroupsSql": () => federation.exclusivityGroupsSql(cohortSql, "x", "db", ["KRAS", "EGFR"], "CANCER_TYPE", "v7.5", "driver"),
    "exclusivityGroupsSql:any": () => federation.exclusivityGroupsSql(cohortSql, "x", "db", ["KRAS", "EGFR", "TP53"], null, null, "any"),
    "exclusivityColumnsSql": () => federation.exclusivityColumnsSql(cohortSql, "x", "db", null, null, "any"),
    "exclusivityCoverageSql": () => federation.exclusivityCoverageSql(cohortSql, "x", "db"),
    // instability: `parts`/`arms`/`calls`/`per` hold samples' segments and calls; the outer SELECTs are histograms and per-arm counts
    "instabilityScoresSql": () => federation.instabilityScoresSql(cohortSql, "x", "db", { threshold: 0.2, armShare: 0.5, includeX: false }),
    "instabilityArmsSql": () => federation.instabilityArmsSql(cohortSql, "x", "db", { threshold: 0.3, armShare: 0.8, includeX: true }),
    "ctdnaSurvivalSql": () => federation.ctdnaSurvivalSql(cohortSql, "x", "db", { ...CTD, withinDays: 30 }, null, "any"),
    "sampleAttributeValuesSql": () => federation.sampleAttributeValuesSql(cohortSql, "x", "db", "SAMPLE_TYPE"),
    // clonality: `calls` is per (gene, sample); only per-gene counts and CCF bins leave
    "clonalityGenesSql": () => federation.clonalityGenesSql(cohortSql, "x", "db", ["TP53"], "v7.5", "driver", true),
    "clonalityGenesSql:any-noqc": () => federation.clonalityGenesSql(cohortSql, "x", "db", ["TP53", "KRAS"], null, "any", false),
    "facetsSummarySql": () => federation.facetsSummarySql(cohortSql, "x", "db", true),
    "facetsHistogramSql": () => federation.facetsHistogramSql(cohortSql, "x", "db", false),
    "ascnStudiesSql": () => federation.ascnStudiesSql("x", "db"),
    // incidence: `per`/`cls` are per patient; the outer SELECT groups them into (kind, entry, t, cause) tallies
    "incidenceCountsSql": () => federation.incidenceCountsSql(cohortSql, "x", "db", { eventType: "Diagnosis", attrs: [{ key: "TUMOR_SITE", value: "CNS/Brain" }] }, null),
    "incidenceCountsSql:anchored": () => federation.incidenceCountsSql(cohortSql, "x", "db", { eventType: "Status" }, { eventType: "Treatment", key: "SUBTYPE", value: "Chemo", occurrence: "FIRST" }),
    // txendpoints: `per`/`cls` are per patient; the outer SELECT groups them into (kind, entry, t, ev) tallies
    "txEndpointCountsSql:ttnt": () => federation.txEndpointCountsSql(cohortSql, "x", "db", { endpoint: "ttnt", anchor: { eventType: "Treatment", key: "SUBTYPE", value: "Immuno" }, lines: { gap: 90 } }),
    "txEndpointCountsSql:tot": () => federation.txEndpointCountsSql(cohortSql, "x", "db", { endpoint: "tot", anchor: { eventType: "Treatment", key: "AGENT", value: "PEMBROLIZUMAB", occurrence: "LAST" }, lines: { gap: 60, classes: "all" }, ongoingDays: 30 }),
    "txEndpointCountsSql:rwpfs": () => federation.txEndpointCountsSql(cohortSql, "x", "db", { endpoint: "rwpfs", anchor: { eventType: "Treatment" }, lines: { gap: 90 },
      progression: { eventType: "Diagnosis", key: "PROGRESSION", values: ["Y", "Yes"], probabilityKey: "NLP_PROGRESSION_PROBABILITY", minProbability: 0.8 } }),
    "txEndpointCountsSql:os": () => federation.txEndpointCountsSql(cohortSql, "x", "db", { endpoint: "os", anchor: { eventType: "Treatment", key: "SUBTYPE", value: "Immuno" }, lines: { gap: 90 } }),
    // multistate: `per`/`cls` are per patient; the outer SELECT groups them into (prevalent, tp, te, dead, flags) tallies
    "multistateCountsSql": () => federation.multistateCountsSql(cohortSql, "x", "db", { eventType: "Diagnosis", key: "PROGRESSION", values: ["Y", "Yes"], probabilityKey: "NLP_PROGRESSION_PROBABILITY", minProbability: 0.8 }),
    // labs: per-patient % changes stay inside; the course and best-response queries return histograms
    "labCourseSql": () => federation.labCourseSql(cohortSql, "x", "db", LAB, LAB_ANCHOR, LAB_OPTS),
    "labBestSql": () => federation.labBestSql(cohortSql, "x", "db", LAB, LAB_ANCHOR, LAB_OPTS, 50),
    // one row per patient — its best % change — but no identifier; run only by PatientLevelResolver.viewRows
    "labWaterfallSql": () => federation.labWaterfallSql(cohortSql, "x", "db", LAB, LAB_ANCHOR, LAB_OPTS, 5000),
    // run only by PatientLevelResolver.viewRows: one row per patient, values only
    "riskmodelRowsSql": () => federation.riskmodelRowsSql(cohortSql, "x", "db", { endpoint: "OS", strata: "CANCER_TYPE", driverPin: "v7",
      covariates: ["AGE", "STAGE"], anchor: { eventType: "Treatment", key: "SUBTYPE", value: "Immuno" } }),
    // run only by PatientLevelResolver.viewRows: one row per patient, panels, genes and covariate values only
    "adjustedRowsSql": () => federation.adjustedRowsSql(cohortSql, "x", "db", { covariates: ["MSI_TYPE", "TMB_NONSYNONYMOUS"], driverPin: "v7.5" }),
    "adjustedRowsSql:no-covariates": () => federation.adjustedRowsSql(cohortSql, "x", "db", { covariates: [] }),
    // actionability: per-sample and per-patient levels stay in CTEs; patients are counted per level
    "actionLevelsSql": () => federation.actionLevelsSql(cohortSql, "x", "db", "v7.5", "CANCER_TYPE"),
    "actionLevelsSql:ungrouped": () => federation.actionLevelsSql(cohortSql, "x", "db", "v7.5", null),
    "actionConcordanceSql": () => federation.actionConcordanceSql(cohortSql, "x", "db", "v7.5", { attribute: "SAMPLE_TYPE", a: ["Primary"], b: ["Metastasis"] }),
    "actionStoreTypesSql": () => federation.actionStoreTypesSql("x", "db", "v7.5"),
    // drivernegative: per-patient groups stay in CTEs; patients are counted per group and gene
    "dnegGroupsSql": () => federation.dnegGroupsSql(cohortSql, "x", "db", "v7.5", ["EGFR", "KRAS", "ALK"]),
    "dnegAlteredSql": () => federation.dnegAlteredSql(cohortSql, "x", "db", "v7.5", ["EGFR", "KRAS"], "mutation", false),
    "dnegAlteredSql:sv-drivers": () => federation.dnegAlteredSql(cohortSql, "x", "db", "v7.5", ["EGFR"], "sv", true),
    "dnegProfiledSql": () => federation.dnegProfiledSql(cohortSql, "x", "db", "v7.5", ["EGFR", "KRAS"], "mutation"),
    "riskmodelPanelGenesSql": () => federation.riskmodelPanelGenesSql("x", "db"),
    // run only by PatientLevelResolver.viewRows: one row of values per patient, no identifier
    "cutpointRowsSql": () => federation.cutpointRowsSql(cohortSql, "x", "db", { attribute: "TMB_NONSYNONYMOUS", months: "OS_MONTHS", status: "OS_STATUS" }),
    // run only by PatientLevelResolver.viewRows: one row of genotype, LOH, endpoint and covariate values per patient, no identifier
    "hlaRowsSql": () => federation.hlaRowsSql(cohortSql, "x", "db", { loci: ["A", "B", "C"].map((l) => ({ first: ["HLA-" + l + "1"], second: ["HLA-" + l + "2"], pair: ["HLA_" + l] })),
      fields: 2, lohAttributes: ["HLA_A1_LOH"], lohValues: ["Loss"], months: "OS_MONTHS", status: "OS_STATUS", covariates: ["TMB_SCORE", "CANCER_TYPE"] }),
    "hlaAttributesSql": () => federation.hlaAttributesSql(cohortSql, "x", "db"),
    "cutpointRowsSql:stratified": () => federation.cutpointRowsSql(cohortSql, "x", "db", { attribute: "TMB_NONSYNONYMOUS", months: "OS_MONTHS", status: "OS_STATUS", stratum: "CANCER_TYPE" }),
    "labTestsSql": () => federation.labTestsSql(cohortSql, "x", "db", "Lab_Test", "TEST"),
    // cancertypes: `alt`/`per`/`covered` hold samples; the outer SELECT counts them per group
    "cancerTypesSql": () => federation.cancerTypesSql(cohortSql, "x", "db", ["KRAS", "NRAS"], "CANCER_TYPE", "v7.5", "driver"),
    "cancerTypesSql:by-study-any": () => federation.cancerTypesSql(cohortSql, "x", "db", ["KRAS"], null, null, "any"),
    "cancerTypeSamplesSql": () => federation.cancerTypeSamplesSql(cohortSql, "x", "db", "CANCER_TYPE"),
    "cancerTypeSamplesSql:by-study": () => federation.cancerTypeSamplesSql(cohortSql, "x", "db", null),
    // overlap: per-patient membership bits stay inside; one count per bitmask leaves
    "overlapCountsSql": () => federation.overlapCountsSql([cohortSql, cohortSql, cohortSql], "x", "db"),
    // enrichment: per-gene sample counts, and panel-level sample counts joined to genes
    "enrichAlteredSql": () => federation.enrichAlteredSql(cohortSql, "x", "db", "mutation", "v7.5", true),
    "enrichAlteredSql:cna-any": () => federation.enrichAlteredSql(cohortSql, "x", "db", "cna", null, false),
    "enrichPanelProfiledSql": () => federation.enrichPanelProfiledSql(cohortSql, "x", "db", "amp"),
    "enrichWesSql": () => federation.enrichWesSql(cohortSql, "x", "db", "sv"),
    // assays: per-entity moments or value counts; the rows CTE holds values, never ids, and stays inside
    "assayMomentsSql": () => federation.assayMomentsSql(cohortSql, "x", "db", "mutational_signatures_contribution_v2"),
    "assayValueCountsSql": () => federation.assayValueCountsSql(cohortSql, "x", "db", "armlevel_cna"),
    "assayProfileSql": () => federation.assayProfileSql("x", "db", "armlevel_cna"),
    "assayEntityNamesSql": () => federation.assayEntityNamesSql("x", "db", "armlevel_cna"),
    // composition: each case's vector is built and summed in CTEs; one row of sums (and two counts) leaves
    "compositionMomentsSql": () => federation.compositionMomentsSql(cohortSql, "x", "db",
      { kind: "genericAssay", profileType: "cell_type_relative_counts", parts: ["T_cell", "B_cell", "Fibroblast"], unit: "sample", normalize: true }),
    "compositionMomentsSql:clinical": () => federation.compositionMomentsSql(cohortSql, "x", "db",
      { kind: "clinical", parts: ["custom:sc-states/CD8_EX", "custom:sc-states/CD8_NAIVE"], unit: "patient", normalize: false }),
    "compositionEntitiesSql": () => federation.compositionEntitiesSql("x", "db", "cell_type_relative_counts"),
    // correlates: per-patient values and their ranks stay in CTEs; twelve sums per gene leave
    "geneCytobandsSql": () => federation.geneCytobandsSql(["KRAS", "APC"], "x", "db"),
    "correlatesMomentsSql": () => federation.correlatesMomentsSql(cohortSql, "x", "db", "ESR1", "rna_seq_v2_mrna", "rppa")
  };

  test("every exported *Sql builder is covered by this suite", () => {
    const exported = Object.entries(federation as Record<string, unknown>)
      .filter(([n, v]) => /Sql$/.test(n) && typeof v === "function").map(([n]) => n);
    assert.ok(exported.length >= 2, "expected to find the federation SQL builders; did the file move?");
    const covered = new Set(Object.keys(BUILDERS).map((k) => k.split(":")[0]));
    const missing = exported.filter((n) => !covered.has(n));
    assert.deepEqual(missing, [],
      "these aggregate SQL builders have no boundary test — add a case to BUILDERS: " + missing.join(", "));
  });

  for (const [name, build] of Object.entries(BUILDERS)) {
    test(name + " projects only aggregates", () => {
      const sql = build();
      // An identifier may appear ONLY inside an aggregate call — uniqExact(pid)
      // yields a number, which is the entire point. What must never happen is an
      // identifier surviving as a value: that is what assertAggregateOnly checks.
      assertAggregateOnly(sql, name);
      // ...and no returned FIELD may be identifier-named, whatever it holds,
      // since the field name is what a caller binds to.
      for (const item of outerProjection(sql)) {
        const alias = item.split(/\s+as\s+/i).pop()!.trim().replace(/[`"]/g, "");
        assert.equal(IDENTIFIER_COLUMNS.includes(alias.toLowerCase()), false,
          name + " returns a field named '" + alias + "'");
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Source tripwire: the explore engine builds its SQL inline, so guard the text.
describe("explore engine issues aggregate-only queries", () => {
  const src = readFileSync(new URL("../lib/explore.ts", import.meta.url), "utf8");

  test("no explore query projects a raw identifier column", () => {
    // every SELECT ... FROM in the source, ignoring the cohort subquery it embeds
    const selects = [...src.matchAll(/"SELECT ([\s\S]*?)FROM/g)].map((m) => m[1]);
    assert.ok(selects.length >= 5, "expected to find the explore queries; did the file move?");
    for (const projection of selects) {
      const bare = /\b(patient_unique_id|sample_unique_id|p\.stable_id|ce\.patient_id)\b/.exec(projection);
      if (!bare) continue;
      // permitted only inside an aggregate
      const wrapped = new RegExp("(uniqExact|count|any|min|max|argMin|argMax)\\s*\\([^)]*" + bare[1].replace(".", "\\."), "i").test(projection);
      assert.ok(wrapped, "explore projects a bare identifier: SELECT " + projection.slice(0, 90));
    }
  });

  test("the returned shape carries counts, never lists of identifiers", () => {
    const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");
    const m = /export interface ExploreResult \{([\s\S]*?)\n\}/.exec(types);
    assert.ok(m, "ExploreResult interface not found");
    // A count named `patients` is fine — a LIST of them is not. Flag any field
    // whose name suggests identities and whose type is a string array.
    for (const line of m![1].split("\n")) {
      const f = /^\s*(\w+)\??\s*:\s*(.+?);?\s*$/.exec(line);
      if (!f) continue;
      const [, name, type] = f;
      const identityish = /^(ids|patients|samples|members|columns|patientIds|sampleIds)$/i.test(name);
      const isList = /string\s*\[\]|Array<\s*string/.test(type);
      assert.equal(identityish && isList, false,
        "ExploreResult." + name + " looks like a list of identifiers: " + line.trim());
    }
  });
});

// ---------------------------------------------------------------------------
// Custom data (lib/custom-data.ts) is patient-level: uploaded rows travel only with statements
// sent to a connection the request boundary entitled to them.
// ---------------------------------------------------------------------------
describe("boundary: uploaded custom data", () => {
  test("rows are refused by any connection the request did not entitle", async () => {
    const { withCustomData, clinicalTable, customExternalsFor } = await import("../lib/custom-data.ts");
    const datasets = [{ id: "d", name: "d", level: "patient" as const, columns: [{ name: "X", datatype: "STRING" as const }],
      rows: [{ study: "s1", patient: "P-1", values: ["y"] }] }];
    await withCustomData({ datasets, allowedConns: new Set(["a"]), allowedDbs: new Set(["db1"]) }, async () => {
      const sql = "SELECT 1 FROM " + clinicalTable("db1", "all");
      assert.equal(customExternalsFor(sql, "a").length, 1);
      for (const other of ["b", "peer"]) assert.throws(() => customExternalsFor(sql, other), /cannot be sent/);
      // a database of another connection never even names the table
      assert.ok(!clinicalTable("db2", "all").includes("_custom_"));
    });
  });
  test("a remote or aggregate-only study cannot be given custom data", async () => {
    const src = readFileSync(new URL("../lib/custom-data-server.ts", import.meta.url), "utf8");
    assert.match(src, /peerForStudy\(study\)\)\s*\n\s*throw/);
    assert.match(src, /inst\.mode !== "patient-level"\)\s*\n\s*throw/);
  });
});

// A study the routing map does not hold — unknown, or restricted and so deliberately left out —
// must be refused, never looked for on the default connection. With no ClickHouse configured the
// map is empty, so every study is unrouted here.
describe("unrouted studies are refused, not sent to the default connection", { skip: !!process.env.CLICKHOUSE_URL && "needs an empty routing map" }, () => {
  test("routeStudy refuses an unknown study", async () => {
    await assert.rejects(federation.routeStudy("no_such_study"), /unknown study 'no_such_study'/);
  });
  test("routeStudy names a restricted study as restricted", async () => {
    federation.restrictedStudies.add("genie_private");
    try {
      await assert.rejects(federation.routeStudy("genie_private"), /consortium\/private-access/);
    } finally { federation.restrictedStudies.delete("genie_private"); }
  });
  test("instanceForStudy and patientLevelConn refuse it too", async () => {
    await assert.rejects(federation.instanceForStudy("no_such_study"), /unknown study/);
    await assert.rejects(federation.patientLevelConn("no_such_study"), /unknown study/);
  });
  test("the oncoprint's columns and one column's detail refuse it before any query", async () => {
    const { buildContract } = await import("../lib/oncoprint.ts");
    const { columnDetail } = await import("../lib/oncoprint-detail.ts");
    await assert.rejects(buildContract({ study: "no_such_study", genes: ["TP53"] } as any), /unknown study/);
    await assert.rejects(columnDetail({ study: "no_such_study", genes: ["TP53"] } as any, "P-1"), /unknown study/);
  });
});

// The peer's own MCP tools refuse an id-carrying definition themselves: a caller that is not
// this codebase's RemoteAggregateResolver has checked nothing.
describe("a peer's federation tools refuse explicit id lists on their own", () => {
  const handlers = new Map<string, (args: any) => Promise<any>>();
  // registerTool is captured; whatever else registerTools calls (tool, resource…) is a no-op
  const fake = new Proxy({}, {
    get: (_t, prop) => prop === "registerTool"
      ? (name: string, _def: unknown, h: (args: any) => Promise<any>) => { handlers.set(name, h); }
      : () => undefined
  });
  const nested = { all: [{ not: { not: { kind: "patientList", ids: ["s:P-1"] } } }] };
  test("federated_aggregates", async () => {
    const { registerTools } = await import("../mcp/tools.ts");
    registerTools(fake);
    const r = await handlers.get("federated_aggregates")!({ study: "s", cohort: nested, attributes: ["AGE"] });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /REJECTED: cohort contains an explicit sample or patient list/);
  });
  test("federated_facets", async () => {
    const { registerTools } = await import("../mcp/tools.ts");
    registerTools(fake);
    const r = await handlers.get("federated_facets")!({ study: "s", draft: nested });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /explicit sample or patient list/);
  });
});

// ---------------------------------------------------------------------------
// The opt-in patient-level federation mode (docs/DATA-BOUNDARY.md): a peer both sides' rules allow
// may answer the views of the kinds they name — and nothing else.
describe("patient-level federation is opt-in, on both sides, per study and kind", () => {
  const withEnv = async (env: Record<string, string | undefined>, fn: () => Promise<void> | void) => {
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(env)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
    try { await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
  };
  const PEERS = "s1=http://peer.invalid/api/mcp,s2=http://peer.invalid/api/mcp";
  const PATIENT_METHODS = ["members", "rowsPage", "rowsCounts", "rowsValues", "rowsRank", "plotPoints", "plotScatterPoints", "plotRankedPoints", "plotHighlightPoints", "coxRows", "logisticRows", "viewRows", "viewAggregate"];

  test("the rules: a study (or *) and the kinds allowed for it; a bare study is the timeline alone; an unknown kind is refused", () => {
    const r = parseRules("s1:timeline+alterations, s2 *:alterations", "X");
    assert.deepEqual([...allowedKinds(r, "s1")].sort(), ["alterations", "timeline"]);
    assert.deepEqual([...allowedKinds(r, "s2")].sort(), ["alterations", "timeline"], "s2's own rule and the * rule together");
    assert.deepEqual([...allowedKinds(r, "s3")], ["alterations"]);
    assert.deepEqual([...allowedKinds(parseRules("s1", "X"), "s1")], ["timeline"]);
    assert.deepEqual([...allowedKinds(parseRules("s1:*", "X"), "s1")].sort(), ["alterations", "timeline"]);
    assert.equal(allowedKinds(parseRules("", "X"), "s1").size, 0);
    assert.throws(() => parseRules("s1:timline", "PEER_MCP_PATIENT_LEVEL"), /PEER_MCP_PATIENT_LEVEL: unknown kind 'timline'/);
    assert.throws(() => parseRules("s1:", "X"), /names no kind/);
    assert.throws(() => parseRules("bad'study:timeline", "X"), /does not name a study/);
  });

  test("the coordinator accepts from a peer only the studies and kinds PEER_MCP_PATIENT_LEVEL names", async () => {
    await withEnv({ PEER_MCP: PEERS, PEER_MCP_PATIENT_LEVEL: undefined }, async () => {
      assert.equal(peerPatientKinds("s1").size, 0);
      const r = await federation.resolverFor("s1", {});
      assert.equal(r instanceof RemotePatientResolver, false, "no setting: the peer is aggregate-only");
      assert.equal(federation.hasPatientTimeline(r), false);
      assert.equal(federation.peerRowsFor(r, "timeline"), null);
    });
    await withEnv({ PEER_MCP: PEERS, PEER_MCP_PATIENT_LEVEL: "s1" }, async () => {
      const r = await federation.resolverFor("s1", {});
      assert.ok(r instanceof RemoteTimelineResolver);
      assert.ok(federation.peerRowsFor(r, "timeline"));
      assert.equal(federation.peerRowsFor(r, "alterations"), null, "a bare study is the timeline alone");
      assert.equal((await federation.resolverFor("s2", {})) instanceof RemotePatientResolver, false, "only the named study");
    });
    await withEnv({ PEER_MCP: PEERS, PEER_MCP_PATIENT_LEVEL: "s1:alterations" }, async () => {
      const r = await federation.resolverFor("s1", {});
      assert.ok(r instanceof RemotePatientResolver);
      assert.equal(r instanceof RemoteTimelineResolver, false, "no timelines accepted: no patientTimeline()");
      assert.equal(federation.hasPatientTimeline(r), false);
      assert.ok(federation.peerRowsFor(r, "alterations"));
      assert.equal(federation.peerRowsFor(r, "timeline"), null);
    });
  });

  test("a peer has the patient-row method and, with timelines, patientTimeline — none of the other patient-level ones", () => {
    for (const r of [new RemoteTimelineResolver("s", "http://peer.invalid/api/mcp", AGG, ["timeline", "alterations"]),
      new RemotePatientResolver("s", "http://peer.invalid/api/mcp", AGG, ["alterations"])]) {
      assert.equal(typeof r.patientRows, "function");
      for (const m of PATIENT_METHODS)
        assert.equal(typeof (r as unknown as Record<string, unknown>)[m], "undefined", "a peer must not have " + m);
      // and it is not patient-level for any other view
      assert.equal(federation.isPatientLevel(r), false);
    }
    assert.equal(typeof (RemotePatientResolver.prototype as unknown as Record<string, unknown>).patientTimeline, "undefined");
    // the plain remote resolver is unchanged
    for (const m of ["patientTimeline", "patientRows"])
      assert.equal(typeof (RemoteAggregateResolver.prototype as unknown as Record<string, unknown>)[m], "undefined");
  });

  test("a table of a kind not accepted, and an explicit id list in a cohort, are refused before the network is touched", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; throw new Error("network must not be reached"); }) as typeof fetch;
    try {
      const timelineOnly = new RemoteTimelineResolver("s", "http://peer.invalid/api/mcp", AGG, ["timeline"]);
      for (const table of ["alterations", "alterations:samples", "alterations:mutations", "alterations:cna", "alterations:sv"] as const)
        await assert.rejects(() => timelineOnly.patientRows({ table, parts: [{ cohort: "c", def: {} }], query: {}, defaults: [], mode: "counts", subject: { patient: "P-1" } }),
          /does not accept patient alterations/);
      const alterationsOnly = new RemoteTimelineResolver("s", "http://peer.invalid/api/mcp", AGG, ["alterations"]);
      await assert.rejects(() => alterationsOnly.patientTimeline("P-1"), /does not accept patient timelines/);
      await assert.rejects(() => alterationsOnly.patientRows({ table: "timeline", parts: [{ cohort: "c", def: {} }], query: {}, defaults: [], mode: "counts" }), /does not accept patient timelines/);
      const r = new RemoteTimelineResolver("s", "http://peer.invalid/api/mcp", AGG, ["timeline", "alterations"]);
      const def = { all: [{ kind: "patientList" as const, ids: ["s:P-0000123"] }] };
      for (const table of ["timeline", "alterations"] as const)
        await assert.rejects(() => r.patientRows({ table, parts: [{ cohort: "c", def }], query: {}, defaults: ["patient"], mode: "counts" }), /explicit sample or patient list/i);
      await assert.rejects(() => r.count(def), /explicit sample or patient list/i);
      assert.equal(calls, 0);
    } finally { globalThis.fetch = original; }
  });

  test("a peer that does not say which table it answered is believed only for the timeline's list", async () => {
    const original = globalThis.fetch;
    // a peer on an older build: whatever is asked, the timeline's list, naming no table
    globalThis.fetch = (async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 2,
      result: { structuredContent: { rows: [{ cohort: "c", study: "s", patient: "P-1" }] } } }), { headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const r = new RemoteTimelineResolver("s", "http://peer.invalid/api/mcp", AGG, ["timeline", "alterations"]);
      const ask = (table: "timeline" | "alterations" | "alterations:mutations") =>
        r.patientRows({ table, parts: [{ cohort: "c", def: {} }], query: {}, defaults: [], mode: "page", subject: table === "alterations:mutations" ? { patient: "P-1" } : undefined });
      assert.equal((await ask("timeline")).rows!.length, 1);
      for (const t of ["alterations", "alterations:mutations"] as const)
        await assert.rejects(() => ask(t), /answered with timeline rows when asked for alterations[\s\S]*update that instance/);
    } finally { globalThis.fetch = original; }
  });

  test("the patient views ask a peer only through the kind they belong to", () => {
    const read = (f: string) => readFileSync(new URL("../lib/views/" + f, import.meta.url), "utf8");
    assert.match(read("timeline.ts"), /rowHolders\(ctx, "timeline"\)/);
    assert.match(read("alterations.ts"), /rowHolders\(ctx, "alterations"\)/);
    assert.doesNotMatch(read("timeline.ts"), /peerRowsFor\(\w+, "alterations"\)/);
    assert.doesNotMatch(read("alterations.ts"), /peerRowsFor\(\w+, "timeline"\)|patientTimeline/);
    // every other view's rows stay with local patient-level participants
    for (const f of ["table.ts", "mutations.ts"]) assert.doesNotMatch(read(f), /peerRowsFor|rowHolders\(ctx, "/);
  });

  test("the simulated peer: only this process's own calls are answered as the peer, and one never makes another", async () => {
    await withEnv({ LOOPBACK_PEER: undefined, LOOPBACK_PEER_URL: undefined, PORT: "4999" }, () => {
      assert.deepEqual(loopbackHeaders("http://127.0.0.1:4999/api/mcp"), {}, "no simulated peer: no token is sent");
    });
    await withEnv({ LOOPBACK_PEER: "b", LOOPBACK_PEER_URL: undefined, PORT: undefined }, () => {
      assert.throws(() => loopbackUrl(), /set PORT .* or LOOPBACK_PEER_URL/, "its own address must be known, not guessed");
    });
    await withEnv({ LOOPBACK_PEER: "b", LOOPBACK_PEER_URL: undefined, PORT: "4999" }, () => {
      const own = loopbackUrl();
      assert.equal(own, "http://127.0.0.1:4999/api/mcp");
      const h = loopbackHeaders(own);
      assert.ok(h[LOOPBACK_HEADER], "a call to itself carries the token");
      assert.deepEqual(loopbackHeaders("http://peer.invalid/api/mcp"), {}, "a real peer is never sent the token");
      const req = (v?: string) => new Request(own, { method: "POST", headers: v ? { [LOOPBACK_HEADER]: v } : {} });
      assert.equal(isLoopbackRequest(req(h[LOOPBACK_HEADER])), true);
      assert.equal(isLoopbackRequest(req("guess")), false, "a forged header is an ordinary call");
      assert.equal(isLoopbackRequest(req()), false);
      assert.throws(() => asLoopbackPeer(() => loopbackHeaders(own)), /cannot call itself/, "answering as the peer, it never calls itself again");
    });
    await withEnv({ LOOPBACK_PEER: undefined }, () => {
      assert.equal(isLoopbackRequest(new Request("http://x/api/mcp", { headers: { [LOOPBACK_HEADER]: "anything" } })), false, "no simulated peer: the header means nothing");
    });
    // several processes serving one deployment (Vercel) share LOOPBACK_PEER_TOKEN, so a call back that
    // lands on another instance is still recognised — and only a call carrying exactly that token
    const shared = "s".repeat(40);
    await withEnv({ LOOPBACK_PEER: "b", LOOPBACK_PEER_URL: "https://app.invalid/api/mcp", LOOPBACK_PEER_TOKEN: shared }, () => {
      assert.deepEqual(loopbackHeaders("https://app.invalid/api/mcp"), { [LOOPBACK_HEADER]: shared });
      const req = (v: string) => new Request("https://app.invalid/api/mcp", { method: "POST", headers: { [LOOPBACK_HEADER]: v } });
      assert.equal(isLoopbackRequest(req(shared)), true, "another instance's call, carrying the shared token");
      assert.equal(isLoopbackRequest(req(shared.slice(1))), false);
      assert.equal(isLoopbackRequest(req("t".repeat(40))), false);
    });
    await withEnv({ LOOPBACK_PEER: "b", LOOPBACK_PEER_URL: "https://app.invalid/api/mcp", LOOPBACK_PEER_TOKEN: "short" }, () => {
      assert.throws(() => loopbackHeaders("https://app.invalid/api/mcp"), /at least 32 characters/, "a guessable token is refused, not used");
    });
  });

  // The simulated peer's database is reached only over MCP: every ClickHouse request passes one
  // check, which refuses its connection — and its database named on any other, since the two may
  // share a server and a login — unless the request is the peer answering.
  test("the simulated peer's database is never queried directly, only while answering as the peer", async () => {
    const env = { LOOPBACK_PEER: "b", CLICKHOUSE2_URL: "http://127.0.0.1:9", CLICKHOUSE2_USER: "u", CLICKHOUSE2_PASSWORD: "p",
      CLICKHOUSE2_DB: "peer_db", CLICKHOUSE2_LABEL: "PEER" };
    await withEnv(env, async () => {
      const b = connById("b")!;
      await assert.rejects(chQuery("SELECT 1", b), /PEER database is reached only over MCP/);
      for (const sql of ["SELECT count() FROM peer_db.patient", "SELECT count() FROM `peer_db`.patient", "SELECT 1\nFROM x JOIN peer_db.sample s USING (id)"])
        await assert.rejects(chQuery(sql, PRIMARY), /reached only over MCP/, "named on another connection: " + sql);
      assert.doesNotThrow(() => assertNotLoopbackDirect("SELECT count() FROM other_peer_db.patient", PRIMARY), "another database whose name ends the same");
      assert.deepEqual(directConnections().map((c) => c.id), [PRIMARY.id]);
      // answering as the peer, it is that peer's own database
      asLoopbackPeer(() => {
        assert.doesNotThrow(() => assertNotLoopbackDirect("SELECT 1", b));
        assert.deepEqual(directConnections().map((c) => c.id), [PRIMARY.id, "b"]);
      });
    });
    await withEnv({ ...env, LOOPBACK_PEER: undefined }, () => {
      assert.doesNotThrow(() => assertNotLoopbackDirect("SELECT 1", connById("b")!), "no simulated peer: a second database is an ordinary one");
    });
  });

  test("lib/ch.ts is the only way to ClickHouse, so the check above sees every query", () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = d + "/" + f; if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx|mjs|js)$/.test(f)) files.push(p); } };
    for (const d of ["app", "lib", "mcp"]) walk(d);
    // no query runs without a connection's password, so a module that reads one, or the settings, talks to ClickHouse itself
    const reach = files.filter((f) => f !== "lib/ch.ts" && /CLICKHOUSE2?_(URL|USER|PASSWORD)|\.password\b/.test(readFileSync(f, "utf8")));
    assert.deepEqual(reach, [], "these reach ClickHouse's address or credentials themselves");
  });

  // A coordinator that holds none of a peer's databases learns its studies and their catalogs
  // over MCP too, and a peer answers only for studies it holds itself.
  test("a federation tool refuses a study PEER_MCP routes to a peer, instead of relaying it or reading its own database", async () => {
    const { registerTools } = await import("../mcp/tools.ts");
    const t = new Map<string, (a: any) => Promise<any>>();
    registerTools({ registerTool: (n: string, _c: unknown, h: (a: any) => Promise<any>) => t.set(n, h), tool: () => {} });
    await withEnv({ PEER_MCP: PEERS }, async () => {
      for (const [name, args] of [["federated_aggregates", { study: "s1", cohort: {} }], ["federated_facets", { study: "s1" }], ["federated_catalog", { study: "s1" }]] as const) {
        const r = await t.get(name)!(args);
        assert.equal(r.isError, true, name);
        assert.match(r.content[0].text, /REJECTED: study 's1' is not held by this instance/, name);
      }
    });
  });

  test("the study list keeps from each peer only the studies PEER_MCP routes to it; a peer that does not answer is reported", async () => {
    const realFetch = globalThis.fetch;
    const rpc = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result }), { headers: { "content-type": "application/json" } });
    const row = (id: string) => ({ id, name: id, cancerType: "", patients: 1, samples: 1, timelinePatients: 0, caps: {}, oncokb: false, instance: "a", instanceLabel: "theirs" });
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      if (String(url).includes("down.invalid")) throw new Error("connection refused");
      const body = JSON.parse(String(init.body));
      if (body.method !== "tools/call") return rpc({});
      if (body.params.name === "federated_studies") return rpc({ structuredContent: { studies: [row("s1"), row("s2"), row("unasked")] } });
      return rpc({ structuredContent: { study: "other" } });
    }) as typeof fetch;
    try {
      await withEnv({ PEER_MCP: "s1=http://peer.invalid/api/mcp,s3=http://down.invalid/api/mcp", PEER_LABEL: "GENIE" }, async () => {
        const { rows, failed } = await remoteStudies();
        assert.deepEqual(rows.map((r) => r.id), ["s1"], "s2 is routed nowhere and 'unasked' was never configured");
        assert.equal(rows[0].instance, "peer");
        assert.equal(rows[0].instanceLabel, "GENIE");
        assert.deepEqual(failed, ["http://down.invalid/api/mcp"]);
        await assert.rejects(remoteCatalog("s1", "http://peer.invalid/api/mcp"), /peer answered the catalog of 'other' for 's1'/);
      });
    } finally { globalThis.fetch = realFetch; }
  });

  test("a peer registers the disclosing tools only when MCP_DISCLOSE_PATIENTS is set, and answers only the kinds it allows", async () => {
    const { registerTools } = await import("../mcp/tools.ts");
    const tools = () => {
      const out = new Map<string, (a: any) => Promise<any>>();
      const fake = { registerTool: (n: string, _c: unknown, h: (a: any) => Promise<any>) => out.set(n, h), tool: (n: string) => out.set(n, async () => null),
        registerResource: () => {}, resource: () => {}, registerPrompt: () => {}, prompt: () => {} };
      registerTools(fake);
      return out;
    };
    await withEnv({ MCP_DISCLOSE_PATIENTS: undefined }, async () => {
      const n = [...tools().keys()];
      assert.ok(n.includes("federated_aggregates"));
      assert.equal(n.some((x) => /federated_patient/.test(x)), false, "no opt-in, no tool");
    });
    await withEnv({ MCP_DISCLOSE_PATIENTS: "rms_msk_2026" }, async () => {
      const t = tools();
      assert.ok(t.has("federated_patient_rows") && t.has("federated_patient_timeline"));
      // a bare study discloses timelines alone: an alterations table of it is refused, as is another study
      const ask = (study: string, table: string) => t.get("federated_patient_rows")!({ study, table, parts: [{ cohort: "c", cohortDef: {} }], source: "x",
        defaults: [], mode: "counts", subject: { patient: "P-1" } });
      for (const table of ["alterations", "alterations:samples", "alterations:mutations", "alterations:cna", "alterations:sv"]) {
        const r = await ask("rms_msk_2026", table);
        assert.equal(r.isError, true);
        assert.match(r.content[0].text, /not a study this instance discloses patient alterations of/);
      }
      const other = await ask("msk_chord_2024", "timeline");
      assert.match(other.content[0].text, /not a study this instance discloses patient timelines of/);
      const tl = await t.get("federated_patient_timeline")!({ study: "msk_chord_2024", patient: "P-1" });
      assert.match(tl.content[0].text, /not a study this instance discloses patient timelines of/);
    });
    await withEnv({ MCP_DISCLOSE_PATIENTS: "rms_msk_2026:alterations" }, async () => {
      const tl = await tools().get("federated_patient_timeline")!({ study: "rms_msk_2026", patient: "P-1" });
      assert.match(tl.content[0].text, /not a study this instance discloses patient timelines of/, "alterations alone: no timelines");
    });
  });
});
