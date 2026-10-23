// The clinical table's row source: every cohort and study combined in the database, so every
// page — and the download — is a slice of one order (lib/table-query.ts pages it).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { clinicalRowSource, type TableColumn } from "../lib/clinical-table.ts";
import { pageSql, countsSql } from "../lib/table-query.ts";
import { finiteSql } from "../lib/sql-number.ts";

const cols: TableColumn[] = [{ id: "AGE", name: "Age", per: "patient", numeric: true }, { id: "TYPE", name: "Type", per: "sample", numeric: false }];
const part = (cohort: string, study: string) => ({ cohort, study, cohortSql: "SELECT '' AS pid" });
const defaults = ["patient", "sample", "AGE", "TYPE"];

describe("clinicalRowSource", () => {
  test("numbers sort with NULLS LAST, blanks last, then patient, sample and document order; the offset is global", () => {
    const src = clinicalRowSource([part("a", "s")], "db", "sample", cols);
    // a number sorts as its finite value; "nan" and "inf" read as missing (lib/sql-number.ts)
    assert.ok(pageSql(src, { sort: { column: "AGE", desc: true } }, defaults, 10, 20)
      .endsWith("ORDER BY " + finiteSql("m['AGE']") + " DESC NULLS LAST, patient, sample, ord\nLIMIT 10 OFFSET 20"));
    assert.match(pageSql(src, { sort: { column: "TYPE" } }, defaults, 10, 0), /ORDER BY \(m\['TYPE'\] = ''\) ASC, m\['TYPE'\] ASC, patient, sample, ord/);
    assert.match(pageSql(src, {}, defaults, 10, 0), /ORDER BY patient, sample, patient, sample, ord/);
  });
  test("several cohorts and studies are one UNION ALL, each row labelled, sorted once", () => {
    const sql = pageSql(clinicalRowSource([part("A", "s1"), part("B", "s2")], "db", "sample", cols), {}, defaults, 25, 0);
    assert.equal((sql.match(/UNION ALL/g) || []).length, 1);
    assert.match(sql, /'A' AS cohort, 's1' AS study, 0 AS ord/);
    assert.match(sql, /'B' AS cohort, 's2' AS study, 1 AS ord/);
    assert.equal((sql.match(/ORDER BY/g) || []).length, 1);
  });
  test("a per-patient table reads no sample attribute and has a samples column, not a sample one", () => {
    const src = clinicalRowSource([part("a", "s")], "db", "patient", cols);
    assert.match(src.with, /type = 'sample' AND 0/);
    assert.match(src.with, /uniqExact\(sample_unique_id\) AS samples/);
    assert.deepEqual(src.columns.map((c) => c.id), ["patient", "samples", "AGE", "TYPE"]);
  });
  test("the ids are columns like any other: searchable, filterable, sortable", () => {
    const src = clinicalRowSource([part("a", "s")], "db", "sample", cols);
    assert.match(pageSql(src, { filters: { sample: { op: "startsWith", value: "P-01" } } }, defaults, 10, 0), /startsWith\(lowerUTF8\(sample\), lowerUTF8\('P-01'\)\)/);
  });
  test("the counts query counts per cohort and study, kept and in all", () => {
    assert.match(countsSql(clinicalRowSource([part("A", "s1"), part("B", "s2")], "db", "sample", []), {}, defaults),
      /SELECT cohort, study, countIf\(1\) AS n, count\(\) AS all FROM rows GROUP BY cohort, study$/);
  });
});
