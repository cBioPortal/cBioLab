// The clinical table's row query: every cohort and study combined and sorted together in the
// database, so every page — and the download — is a slice of one order.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tableRowsSql, tableCountsSql, type TableColumn } from "../lib/clinical-table.ts";

const cols: TableColumn[] = [{ id: "AGE", name: "Age", per: "patient", numeric: true }, { id: "TYPE", name: "Type", per: "sample", numeric: false }];
const part = (cohort: string, study: string) => ({ cohort, study, cohortSql: "SELECT '' AS pid" });

describe("tableRowsSql", () => {
  test("numbers sort with NULLS LAST, blanks last, then patient, sample and document order; the offset is global", () => {
    const num = tableRowsSql([part("a", "s")], "db", "sample", cols, { attribute: "AGE", desc: true }, 10, 20);
    assert.match(num, /ORDER BY toFloat64OrNull\(m\['AGE'\]\) DESC NULLS LAST, patient, sample, ord\nLIMIT 10 OFFSET 20$/);
    const txt = tableRowsSql([part("a", "s")], "db", "sample", cols, { attribute: "TYPE" }, 10, 0);
    assert.match(txt, /ORDER BY \(m\['TYPE'\] = ''\) ASC, m\['TYPE'\] ASC, patient, sample, ord/);
  });
  test("several cohorts and studies are one UNION ALL, each row labelled, sorted once", () => {
    const sql = tableRowsSql([part("A", "s1"), part("B", "s2")], "db", "sample", cols, null, 25, 0);
    assert.equal((sql.match(/UNION ALL/g) || []).length, 1);
    assert.match(sql, /'A' AS cohort, 's1' AS study, 0 AS ord/);
    assert.match(sql, /'B' AS cohort, 's2' AS study, 1 AS ord/);
    assert.equal((sql.match(/ORDER BY/g) || []).length, 1);
  });
  test("a per-patient table reads no sample attribute", () => {
    const sql = tableRowsSql([part("a", "s")], "db", "patient", cols, null, 10, 0);
    assert.match(sql, /type = 'sample' AND 0/);
    assert.match(sql, /uniqExact\(sample_unique_id\) AS samples/);
  });
  test("the counts query counts per cohort and study", () => {
    assert.match(tableCountsSql([part("A", "s1"), part("B", "s2")], "db", "sample"), /SELECT cohort, study, count\(\) AS n FROM rows GROUP BY cohort, study$/);
  });
});
