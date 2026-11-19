// The header text filter's conditions (MUT-TB-6), from the spec table P1-P8 written off legacy
// cbioportal-frontend cd8c6df: CategoricalFilterMenu.tsx lists the options; MutationUtils.tsx
// matchCategoricalFilterSearch decides a row: '' keeps every row, the rest compare upper-cased value and
// filter (regex alone is case-sensitive). cBioLab's names: contains, notContains, equals, notEquals,
// startsWith, notStartsWith, endsWith, notEndsWith, regex.
//
// whereSql's condition is run, not matched as text: on a scratch ClickHouse (clickhouse local, the pinned
// binary `npm run local` downloads to ~/.cbiolab/bin) over a handful of literal values, skipped without it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TEXT_FILTER_OPS, checkQuery, describeQuery, whereSql, type RowSource, type TextFilterOp } from "../lib/table-query.ts";

const LEGACY_ORDER = ["contains", "notContains", "equals", "notEquals", "startsWith", "notStartsWith", "endsWith", "notEndsWith", "regex"];

/** the column's values, blank included; `ord` keeps them apart */
const VALUES = ["G12C", "g12d", "G12", "G13D", "Q61H", "AG12", "xg12v", "d", "D", "Gd", "abc", ""];

const lit = (x: string) => "'" + x.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
const src: RowSource = {
  with: "WITH rows AS (SELECT * FROM values('pc String, ord UInt32', " + VALUES.map((v, i) => "(" + lit(v) + ", " + i + ")").join(", ") + "))\n",
  columns: [
    { id: "pc", name: "Protein Change", numeric: false, text: "pc" },
    { id: "n", name: "Count", numeric: true, text: "toString(ord)", num: "toFloat64(ord)" },
  ],
  select: "*",
  defaultOrder: "ord",
  tiebreak: "ord",
};
const defaults = ["pc"];
const cols = src.columns;

const CH = path.join(process.env.CBIOLAB_DATA || path.join(os.homedir(), ".cbiolab"), "bin", "clickhouse");
const noCh = existsSync(CH) ? false : "no ClickHouse binary at " + CH + " (npm run local downloads it)";

/** the values whereSql keeps for one text filter on pc, run in ClickHouse */
function kept(op: TextFilterOp, value: string): string[] {
  const where = whereSql(src, { filters: { pc: { op, value } } }, defaults);
  const out = execFileSync(CH, ["local", "--max_threads=1", "--query", src.with + "SELECT pc FROM rows WHERE " + where + " ORDER BY ord FORMAT JSONEachRow"], { encoding: "utf8" });
  return out.trim() ? out.trim().split("\n").map((l) => String(JSON.parse(l).pc)) : [];
}

describe("P1 TEXT_FILTER_OPS", () => {
  test("exactly the nine, in the legacy order", () => assert.deepEqual([...TEXT_FILTER_OPS], LEGACY_ORDER));
});

describe("P2 P3 checkQuery", () => {
  test("P2 notStartsWith and notEndsWith on a text column are accepted", () => {
    assert.equal(checkQuery({ filters: { pc: { op: "notStartsWith", value: "G12" } } }, cols), null);
    assert.equal(checkQuery({ filters: { pc: { op: "notEndsWith", value: "d" } } }, cols), null);
  });
  test("P2 every one of the nine is accepted, with a value and with ''", () => {
    for (const op of LEGACY_ORDER as TextFilterOp[]) {
      assert.equal(checkQuery({ filters: { pc: { op, value: "G" } } }, cols), null, op);
      assert.equal(checkQuery({ filters: { pc: { op, value: "" } } }, cols), null, op + " ''");
    }
  });
  test("P3 an unknown op is refused, and the message lists all nine", () => {
    for (const op of ["doesNotBeginWith", "beginsWith", "like"]) {
      const msg = checkQuery({ filters: { pc: { op: op as TextFilterOp, value: "x" } } }, cols);
      assert.ok(msg, op + " refused");
      assert.ok(msg!.includes(LEGACY_ORDER.join(", ")), "lists the nine in order: " + msg);
    }
  });
});

describe("P4 P5 P6 whereSql, run", () => {
  test("P4 notStartsWith 'G12' keeps the values not beginning with g12, any case; blank kept", { skip: noCh }, () => {
    assert.deepEqual(kept("notStartsWith", "G12"), ["G13D", "Q61H", "AG12", "xg12v", "d", "D", "Gd", "abc", ""]);
    assert.deepEqual(kept("notStartsWith", "g12"), kept("notStartsWith", "G12"), "the filter's own case does not matter");
  });
  test("P4 notStartsWith is the complement of startsWith", { skip: noCh }, () => {
    const keep = kept("notStartsWith", "G12"), drop = kept("startsWith", "G12");
    assert.deepEqual([...keep, ...drop].sort(), [...VALUES].sort());
    assert.deepEqual(drop, ["G12C", "g12d", "G12"]);
  });
  test("P5 notEndsWith 'd' keeps the values not ending in d or D; blank kept", { skip: noCh }, () => {
    assert.deepEqual(kept("notEndsWith", "d"), ["G12C", "G12", "Q61H", "AG12", "xg12v", "abc", ""]);
    assert.deepEqual(kept("notEndsWith", "D"), kept("notEndsWith", "d"), "the filter's own case does not matter");
    const drop = kept("endsWith", "d");
    assert.deepEqual([...kept("notEndsWith", "d"), ...drop].sort(), [...VALUES].sort(), "the complement of endsWith");
  });
  test("P6 '' keeps every row, whatever the op", { skip: noCh }, () => {
    for (const op of LEGACY_ORDER as TextFilterOp[]) assert.deepEqual(kept(op, ""), VALUES, op);
  });
  test("P6 '' compiles to no condition that could drop a row", () => {
    for (const op of LEGACY_ORDER as TextFilterOp[]) {
      const w = whereSql(src, { filters: { pc: { op, value: "" } } }, defaults);
      assert.match(w, /^\(?1\)?$/, op + ": " + w);
    }
  });
});

describe("P7 P8 describeQuery", () => {
  test("P7 notStartsWith / notEndsWith in words", () => {
    assert.equal(describeQuery({ filters: { pc: { op: "notStartsWith", value: "x" } } }, cols), "rows Protein Change does not start with “x”");
    assert.equal(describeQuery({ filters: { pc: { op: "notEndsWith", value: "x" } } }, cols), "rows Protein Change does not end with “x”");
  });
  test("P8 a '' text filter is not described", () => {
    for (const op of LEGACY_ORDER as TextFilterOp[]) assert.equal(describeQuery({ filters: { pc: { op, value: "" } } }, cols), "", op);
    assert.equal(describeQuery({ filters: { pc: { op: "notContains", value: "" }, n: { min: 2 } } }, cols), "rows Count ≥ 2");
  });
});
