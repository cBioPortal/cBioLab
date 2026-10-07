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
import { readFileSync } from "node:fs";

import {
  carriesPatientIds, plotBinsSql, plotBoxSql, plotCountSql, plotCoverageSql, plotMomentsSql, plotStatsSql, plotTableSql, plotViolinSql,
  geneCountsSql, survivalCountsSql, survivalEndpointsSql, anchoredSurvivalSql, pairCountsSql,
  clinicalCountsSql, clinicalMomentsSql, clinicalHistogramSql, attributeQuantileSql, momentPairsSql, variantCountsSql, geneMutationTotalsSql, profileMomentsSql,
  lollipopChangesSql, lollipopTypesSql, lollipopTotalsSql, cohortSampleCountSql,
  timelineSpanSql, eventCourseSql, sequenceSql, sequenceKeysSql, coxRowsSql, logisticRowsSql,
  AggregateResolver, PatientLevelResolver, isPatientLevel
} from "../lib/federation.ts";
import * as federation from "../lib/federation.ts";
import { axisSelect, plotPointsSql } from "../lib/plot.ts";
import { clinicalRowSource } from "../lib/clinical-table.ts";
import { mutationRowSource } from "../lib/mutation-table.ts";
import { pageSql } from "../lib/table-query.ts";
import { RemoteAggregateResolver } from "../lib/federation-remote.ts";
import type { Instance } from "../lib/federation.ts";
import { PRIMARY } from "../lib/ch.ts";

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
    assert.equal(typeof (agg as unknown as { moreRows?: unknown }).moreRows, "undefined");
    assert.equal(typeof (pl as unknown as { moreRows?: unknown }).moreRows, "function");
    // and a remote peer answers neither the per-patient rows nor the new aggregates
    const remote = RemoteAggregateResolver.prototype as unknown as { moreRows?: unknown; moreAggregate?: unknown };
    assert.equal(typeof remote.moreRows, "undefined");
    assert.equal(typeof remote.moreAggregate, "undefined");
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
    for (const name of ["clinicalRowSource", "mutationRowSource", "pageSql"])
      assert.equal(name in (federation as Record<string, unknown>), false, name + " returns ids and must not sit among the aggregate builders");
    const part = [{ cohort: "c", study: "x", cohortSql: "SELECT '' AS pid" }];
    assert.match(pageSql(clinicalRowSource(part, "db", "sample", [{ id: "AGE", name: "Age", per: "patient", numeric: true }]), {}, [], 10, 0), /AS patient, replaceOne\(u\.suid/);
    assert.match(pageSql(mutationRowSource(part, "db", "KRAS", "v7.5"), {}, [], 10, 0), /m\.sid AS sid/);
    for (const m of ["rowsPage", "rowsCounts", "rowsValues"]) {
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

  const LAB = { eventType: "Lab_Test", testKey: "TEST", test: "PSA", resultKey: "RESULT" };
  const LAB_ANCHOR = { eventType: "Treatment", key: "SUBTYPE", value: "Hormone", occurrence: "FIRST" as const };
  const LAB_OPTS = { baselineDays: 90, fromDays: -84, toDays: 364, binDays: 28 };
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
  "plotViolinSql": () => plotViolinSql(numAxis, catAxis, cohortSql),
  "plotCoverageSql": () => plotCoverageSql(numAxis, catAxis, axisCtx),
  "plotCoverageSql:patient": () => plotCoverageSql(numAxis, catAxis, { ...axisCtx, unit: "patient" as const }),
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
    // lib/federation-more.ts, re-exported through lib/federation.ts: the genome view's bins group
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
    // labs: per-patient % changes stay inside; the course and best-response queries return histograms
    "labCourseSql": () => federation.labCourseSql(cohortSql, "x", "db", LAB, LAB_ANCHOR, LAB_OPTS),
    "labBestSql": () => federation.labBestSql(cohortSql, "x", "db", LAB, LAB_ANCHOR, LAB_OPTS, 50),
    // one row per patient — its best % change — but no identifier; run only by PatientLevelResolver.moreRows
    "labWaterfallSql": () => federation.labWaterfallSql(cohortSql, "x", "db", LAB, LAB_ANCHOR, LAB_OPTS, 5000),
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
