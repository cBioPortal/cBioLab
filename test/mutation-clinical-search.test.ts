// The Mutations table's search over clinical-attribute columns, off legacy cbioportal-frontend cd8c6df
// ClinicalAttributeColumnFormatter.filter: an attribute whose datatype is not STRING is never matched by the
// table's search; the header filters on the column still read its value.
//
// whereSql's condition is run on a scratch ClickHouse (clickhouse local, ~/.cbiolab/bin), skipped without it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLIN_PATIENT, CLIN_SAMPLE, clinicalColumns, clinicalQueryColumn } from "../lib/mutation-clinical.ts";
import { whereSql, type RowSource, type TableQuery } from "../lib/table-query.ts";

const attr = (id: string, datatype: string, patient: 0 | 1) => ({ id, name: id, datatype, patient, priority: 1 });

describe("S1 clinicalColumns marks non-STRING attributes unsearched", () => {
  test("S1 NUMBER and BOOLEAN unsearched; STRING and 'string' not", () => {
    const cols = clinicalColumns([[attr("S", "STRING", 1), attr("N", "NUMBER", 1), attr("B", "BOOLEAN", 0), attr("L", "string", 0)]], new Set());
    const by = Object.fromEntries(cols.map((c) => [c.id, c]));
    assert.equal(by.N.unsearched, true);
    assert.equal(by.B.unsearched, true);
    assert.ok(!("unsearched" in by.S), "STRING has no unsearched");
    assert.ok(!("unsearched" in by.L), "'string' has no unsearched");
  });
});

const [SEX, AGE] = clinicalColumns([[attr("SEX", "STRING", 1), attr("AGE", "NUMBER", 1)]], new Set());
const ROWS: [string, string, string][] = [["r1", "Female", "42"], ["r2", "Male", "7"]];
const lit = (x: string) => "'" + x.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
const src: RowSource = {
  with: "WITH rows AS (SELECT id, map('SEX', sex, 'AGE', age) AS " + CLIN_PATIENT + ", map() :: Map(String, String) AS " + CLIN_SAMPLE +
    " FROM values('id String, sex String, age String', " + ROWS.map((r) => "(" + r.map(lit).join(", ") + ")").join(", ") + "))\n",
  columns: [clinicalQueryColumn(SEX), clinicalQueryColumn(AGE)],
  select: "*",
  defaultOrder: "id",
  tiebreak: "id",
};
const defaults = ["SEX", "AGE"];

const CH = path.join(process.env.CBIOLAB_DATA || path.join(os.homedir(), ".cbiolab"), "bin", "clickhouse");
const noCh = existsSync(CH) ? false : "no ClickHouse binary at " + CH;

function kept(q: TableQuery): string[] {
  const where = whereSql(src, q, defaults);
  const out = execFileSync(CH, ["local", "--max_threads=1", "--query", src.with + "SELECT id FROM rows WHERE " + where + " ORDER BY id FORMAT JSONEachRow"], { encoding: "utf8" });
  return out.trim() ? out.trim().split("\n").map((l) => String(JSON.parse(l).id)) : [];
}

describe("S2 the search passes over a NUMBER column", () => {
  test("S2 'fem' finds the Female row through the STRING column", { skip: noCh }, () => {
    assert.deepEqual(kept({ search: "fem" }), ["r1"]);
  });
  test("S2 '42' finds no row: the NUMBER column holds it but is not searched", { skip: noCh }, () => {
    assert.deepEqual(kept({ search: "42" }), []);
  });
});

describe("S3 filters on the NUMBER column still read its value", () => {
  test("S3 a value filter keeps the 42 row", { skip: noCh }, () => {
    assert.deepEqual(kept({ filters: { AGE: { values: ["42"] } } }), ["r1"]);
  });
  test("S3 contains '42' keeps the 42 row", { skip: noCh }, () => {
    assert.deepEqual(kept({ filters: { AGE: { op: "contains", value: "42" } } }), ["r1"]);
  });
});
