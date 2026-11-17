// The OncoKB sort value's SQL and the SV and Mutations tables' Annotation orders built from it, by shape
// (spec-sv-levels S3–S10; scripts/check-sv-levels.ts runs them against the fixture study).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SV_ANNOTATION_ORDER, oncokbSortSql } from "../lib/sv-oncokb.ts";
import { MUTATION_ANNOTATION_ORDER } from "../lib/mutation-table.ts";

/** the top-level elements of a SQL array literal `[a, b, ...]` */
const elements = (sql: string): string[] => {
  const s = sql.trim();
  assert.ok(s.startsWith("[") && s.endsWith("]"), "an array literal: " + s.slice(0, 40));
  const out: string[] = [];
  let depth = 0, from = 1, quoted = false;
  for (let i = 1; i < s.length - 1; i++) {
    const c = s[i];
    if (c === "'" && s[i - 1] !== "\\") quoted = !quoted;
    if (quoted) continue;
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) { out.push(s.slice(from, i).trim()); from = i + 1; }
  }
  out.push(s.slice(from, s.length - 1).trim());
  return out;
};

test("S3–S6 oncokbSortSql: five Float64 elements, oncogenic, sensitive, resistance, diagnostic, prognostic, each reading its own column", () => {
  const sql = oncokbSortSql("o_col", "s_col", "r_col", "d_col", "p_col");
  const el = elements(sql);
  assert.equal(el.length, 5);
  el.forEach((e, i) => {
    assert.ok(e.startsWith("toFloat64("), `element ${i + 1} is Float64: ${e.slice(0, 30)}`);
    const cols = ["o_col", "s_col", "r_col", "d_col", "p_col"].filter((c) => e.includes(c));
    assert.deepEqual(cols, [["o_col", "s_col", "r_col", "d_col", "p_col"][i]], `element ${i + 1} reads only its column`);
  });
  for (const v of ["'Oncogenic'", "'Likely Oncogenic'", "'Resistance'"]) assert.ok(el[0].includes(v), "oncogenic names " + v);
  for (const [i, lv] of [[1, "'3A'"], [2, "'R1'"], [3, "'Dx1'"], [4, "'Px1'"]] as const) assert.ok(el[i].includes(lv), `element ${i + 1} names ${lv}`);
  assert.ok(sql.includes("'LEVEL_'"), "a level is normalised by stripping LEVEL_");
});

test("S9 SV_ANNOTATION_ORDER: the OncoKB sort value over the SV rows' columns, then CIViC 0", () => {
  const sort = oncokbSortSql("oncogenicity", "level", "resistanceLevel", "diagnosticLevel", "prognosticLevel");
  assert.equal(SV_ANNOTATION_ORDER, "arrayConcat(" + sort + ", [toFloat64(0)])");
});

test("S10 MUTATION_ANNOTATION_ORDER: the OncoKB sort value, then CIViC 0, the hotspot flag, reVUE 0", () => {
  const sort = oncokbSortSql("oncogenicity", "level", "resistanceLevel", "diagnosticLevel", "prognosticLevel");
  assert.ok(MUTATION_ANNOTATION_ORDER.startsWith("arrayConcat(" + sort + ", "), MUTATION_ANNOTATION_ORDER.slice(0, 60));
  const tail = MUTATION_ANNOTATION_ORDER.slice(("arrayConcat(" + sort + ", ").length, -1);
  assert.deepEqual(elements(tail), ["toFloat64(0)", "toFloat64(hot)", "toFloat64(0)"]);
});
