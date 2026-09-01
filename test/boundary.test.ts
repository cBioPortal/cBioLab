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
  carriesPatientIds, geneCountsSql, survivalCountsSql,
  AggregateResolver, PatientLevelResolver, isPatientLevel
} from "../lib/federation.ts";
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
  test("top-level patient list (v1 sugar)", () => {
    assert.equal(carriesPatientIds({ patients: ["P-0000123"] }), true);
  });
  test("patients leaf in all[]", () => {
    assert.equal(carriesPatientIds({ all: [{ kind: "patients", ids: ["P-1"] }] }), true);
  });
  test("patients leaf nested in any[]", () => {
    assert.equal(carriesPatientIds({ all: [{ any: [{ kind: "oql", q: "TP53: MUT" }, { kind: "patients", ids: ["P-1"] }] }] }), true);
  });
  test("patients leaf nested in not", () => {
    assert.equal(carriesPatientIds({ all: [{ not: { kind: "patients", ids: ["P-1"] } }] }), true);
  });
  test("ordinary clauses do not trip it", () => {
    assert.equal(carriesPatientIds({ all: [{ kind: "oql", q: "TP53: MUT" }, { kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] }), false);
    assert.equal(carriesPatientIds(null), false);
    assert.equal(carriesPatientIds({ all: [{ kind: "patients", ids: [] }] }), false); // empty list carries nothing
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

  test("isPatientLevel discriminates correctly", () => {
    assert.equal(isPatientLevel(agg), false);
    assert.equal(isPatientLevel(pl), true);
  });

  test("refuses to compile SQL embedding patient ids", () => {
    assert.throws(() => agg.cohortSql({ all: [{ kind: "patients", ids: ["P-0000123"] }] }),
      /explicit patient list/i);
  });

  test("still compiles ordinary definitions", () => {
    const sql = agg.cohortSql({ all: [{ kind: "oql", q: "TP53: MUT" }] });
    assert.match(sql, /SELECT/i);
    assert.equal(sql.includes("P-0000123"), false);
  });

  test("a patient-level instance may use an explicit list (that is its entitlement)", () => {
    const sql = pl.cohortSql({ all: [{ kind: "patients", ids: ["P-0000123"] }] });
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
      const def = { all: [{ kind: "patients" as const, ids: ["P-0000123"] }] };
      await assert.rejects(() => r.count(def), /explicit patient list/i);
      await assert.rejects(() => r.geneCounts(def, ["TP53"]), /explicit patient list/i);
      await assert.rejects(() => r.survivalCounts(def), /explicit patient list/i);
      assert.equal(calls, 0, "the guard must run before any request is made");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("remote resolver has no members() either", () => {
    const r = new RemoteAggregateResolver("s", "http://peer.invalid/api/mcp", AGG);
    assert.equal(typeof (r as unknown as { members?: unknown }).members, "undefined");
  });
});

// ---------------------------------------------------------------------------
describe("federation SQL returns aggregates, never identifiers", () => {
  const cohortSql = "SELECT DISTINCT replaceOne(patient_unique_id, 'x_', '') AS pid FROM db.sample_derived";

  test("geneCountsSql projects only counts", () => {
    assertAggregateOnly(geneCountsSql(cohortSql, ["TP53", "KRAS"], "x", "v7.4", "db"), "geneCountsSql");
  });
  test("geneCountsSql without an annotation pin still projects only counts", () => {
    assertAggregateOnly(geneCountsSql(cohortSql, ["TP53"], "x", null, "db"), "geneCountsSql (no pin)");
  });
  test("survivalCountsSql projects only (months, event, n)", () => {
    const sql = survivalCountsSql(cohortSql, "x", "db");
    assertAggregateOnly(sql, "survivalCountsSql");
    // months+event are strata, not identities: assert no id column survives
    for (const col of IDENTIFIER_COLUMNS)
      assert.equal(outerProjection(sql).some((p) => p.toLowerCase().includes(col)), false,
        "survival strata must not carry " + col);
  });
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

  test("the returned shape has no field that could carry identifiers", () => {
    const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");
    const m = /export interface ExploreResult \{([\s\S]*?)\n\}/.exec(types);
    assert.ok(m, "ExploreResult interface not found");
    for (const col of ["ids", "patients:", "members", "columns"])
      assert.equal(m![1].includes(col), false, "ExploreResult must not expose " + col);
  });
});
