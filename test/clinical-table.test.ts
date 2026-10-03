// The clinical table's ordering: the SQL's ORDER BY and the merge of per-study pages must agree,
// or a preview drawn from two studies interleaves rows in an order the download does not have.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compareRows, tableRowsSql, type TableColumn } from "../lib/clinical-table.ts";

const cols: TableColumn[] = [{ id: "AGE", name: "Age", per: "patient", numeric: true }, { id: "TYPE", name: "Type", per: "sample", numeric: false }];
const row = (patient: string, values: Record<string, string>, sample = "") => ({ patient, sample, values });

describe("compareRows", () => {
  test("numbers sort as numbers, missing last in either direction", () => {
    const rows = [row("a", { AGE: "9" }), row("b", { AGE: "" }), row("c", { AGE: "10" }), row("d", { AGE: "x" })];
    const asc = [...rows].sort((x, y) => compareRows({ attribute: "AGE" }, cols, x, y)).map((r) => r.patient);
    const desc = [...rows].sort((x, y) => compareRows({ attribute: "AGE", desc: true }, cols, x, y)).map((r) => r.patient);
    assert.deepEqual(asc, ["a", "c", "b", "d"]);
    assert.deepEqual(desc, ["c", "a", "b", "d"]);
  });
  test("text sorts by code point, blank last, then patient and sample break ties", () => {
    const rows = [row("b", { TYPE: "Lung" }), row("a", { TYPE: "" }), row("a", { TYPE: "Lung" }, "s2"), row("a", { TYPE: "Lung" }, "s1"), row("c", { TYPE: "Breast" })];
    assert.deepEqual(rows.sort((x, y) => compareRows({ attribute: "TYPE" }, cols, x, y)).map((r) => r.patient + r.sample), ["c", "as1", "as2", "b", "a"]);
  });
  test("no sort: patient, then sample", () => {
    assert.ok(compareRows(null, cols, row("a", {}, "2"), row("b", {}, "1")) < 0);
    assert.ok(compareRows(null, cols, row("a", {}, "2"), row("a", {}, "1")) > 0);
  });
});

describe("tableRowsSql", () => {
  test("the SQL orders the same way: numbers with NULLS LAST, blanks last, then patient and sample", () => {
    const num = tableRowsSql("SELECT '' AS pid", "s", "db", "sample", cols, { attribute: "AGE", desc: true }, 10, 20);
    assert.match(num, /ORDER BY toFloat64OrNull\(m\['AGE'\]\) DESC NULLS LAST, patient, sample\nLIMIT 10 OFFSET 20$/);
    const txt = tableRowsSql("SELECT '' AS pid", "s", "db", "sample", cols, { attribute: "TYPE" }, 10, 0);
    assert.match(txt, /ORDER BY \(m\['TYPE'\] = ''\) ASC, m\['TYPE'\] ASC, patient, sample/);
  });
  test("a per-patient table reads no sample attribute", () => {
    const sql = tableRowsSql("SELECT '' AS pid", "s", "db", "patient", cols, null, 10, 0);
    assert.match(sql, /type = 'sample' AND 0/);
    assert.match(sql, /uniqExact\(sample_unique_id\) AS samples/);
  });
});
