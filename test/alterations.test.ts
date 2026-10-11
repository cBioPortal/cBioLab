// The alterations view's tables (lib/patient-alterations.ts): the portal's columns and defaults,
// column ids that cannot be mistaken for the labels every row carries, and row sources the shared
// table query (lib/table-query.ts) can search, filter, sort and page on every column.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ALTERATION_TABLES, ALTERATION_COLUMNS, ALTERATION_DEFAULT_COLUMNS, ALTERATION_PATIENT_COLUMNS, ALTERATION_PATIENT_DEFAULT_COLUMNS,
  alterationSource, alterationPatientRowSource,
} from "../lib/patient-alterations.ts";
import { checkQuery, countsSql, pageSql, rankSql, valuesSql } from "../lib/table-query.ts";

const part = { cohort: "Prostate", study: "msk_chord_2024", cohortSql: "SELECT 'P-1' AS pid" };
/** what every row carries besides its columns: a column with one of these ids would shadow it */
const LABELS = ["cohort", "study", "patient", "ord", "sid", "total"];

describe("the alterations view's tables", () => {
  for (const t of ALTERATION_TABLES) {
    const cols = ALTERATION_COLUMNS[t];
    test(t + ": ids unique, none a row label, the defaults among them", () => {
      const ids = cols.map((c) => c.id);
      assert.equal(new Set(ids).size, ids.length);
      assert.deepEqual(ids.filter((id) => LABELS.includes(id)), []);
      assert.deepEqual(ALTERATION_DEFAULT_COLUMNS[t].filter((id) => !ids.includes(id)), []);
      assert.equal(ids[0], "samples", "the portal's tables lead with the samples");
    });
    test(t + ": every column sorts, filters and lists its values in SQL", () => {
      for (const pin of ["v7.5", null]) {
        const src = alterationSource(t, part, "P-1", "db", pin, ["P-1-T01", "P-1-T02"]);
        for (const c of cols) {
          const q = { sort: { column: c.id, desc: true }, filters: { [c.id]: c.numeric ? { min: 0 } : { op: "contains" as const, value: "x" } } };
          assert.equal(checkQuery(q, cols), null);
          const sql = pageSql(src, q, ALTERATION_DEFAULT_COLUMNS[t], 25, 0);
          assert.match(sql, /ORDER BY /);
          assert.match(valuesSql(src, {}, ALTERATION_DEFAULT_COLUMNS[t], c.id), c.numeric ? /min\(v\) AS lo/ : /GROUP BY v/);
        }
        assert.match(countsSql(src, {}, ALTERATION_DEFAULT_COLUMNS[t]), /GROUP BY cohort, study/);
      }
    });
  }
  test("one patient's rows only: every table reads the patient it is given", () => {
    for (const t of ALTERATION_TABLES) {
      const sql = alterationSource(t, part, "P-0024249", "db", "v7.5", []).with;
      assert.match(sql, /P-0024249/);
    }
    assert.match(alterationSource("mutations", part, "P-1", "db", null, []).with, /NOT LIKE '%uncalled%'/, "uncalled calls are left out, as the portal leaves them out");
    assert.match(alterationSource("cna", part, "P-1", "db", null, []).with, /abs\(cna_alteration\) >= 2/, "the deep calls only");
  });
  test("with no sort a gene's rows sit together, then follow the patient's sample order", () => {
    const order = ["P-1-T03", "P-1-T01"];
    for (const t of ["mutations", "cna"] as const) {
      const src = alterationSource(t, part, "P-1", "db", null, order);
      assert.match(src.defaultOrder, /^gdrv DESC, gene, so\b/, "genes with a driver first, a gene's rows together, then by sample");
      assert.match(src.with, /max\(drv\) OVER \(PARTITION BY gene\) AS gdrv/);
    }
    assert.match(alterationSource("sv", part, "P-1", "db", null, order).defaultOrder, /^gene1, so\b/);
    // the Samples column lists them in that order too, not by id
    assert.match(alterationSource("mutations", part, "P-1", "db", null, order).with, /arraySort\(x -> if\(indexOf\(\['P-1-T03', 'P-1-T01'\], x\)/);
  });
  test("OncoKB joins only when a version is pinned, by protein change or by AMPLIFICATION / DELETION", () => {
    assert.doesNotMatch(alterationSource("mutations", part, "P-1", "db", null, []).with, /oncokb_annotation/);
    assert.match(alterationSource("mutations", part, "P-1", "db", "v7.5", []).with, /alteration_type = 'MUTATION'[\s\S]*ann\.alteration = g\.proteinChange/);
    assert.match(alterationSource("cna", part, "P-1", "db", "v7.5", []).with, /alteration_type = 'CNA'[\s\S]*'AMPLIFICATION', 'DELETION'/);
  });
});

describe("the alterations view's patient list", () => {
  test("its columns, and a rank for prev / next in the same order as its pages", () => {
    const ids = ALTERATION_PATIENT_COLUMNS.map((c) => c.id);
    assert.deepEqual(ALTERATION_PATIENT_DEFAULT_COLUMNS.filter((id) => !ids.includes(id)), []);
    const src = alterationPatientRowSource([part], "db");
    const q = { sort: { column: "sv", desc: true } };
    const order = (sql: string) => /ORDER BY ([^\n)]*)/.exec(sql)![1];
    assert.equal(order(rankSql(src, q, ALTERATION_PATIENT_DEFAULT_COLUMNS, part.study, "P-1")), order(pageSql(src, q, ALTERATION_PATIENT_DEFAULT_COLUMNS, 25, 0)));
  });
  test("refuses an empty list of parts", () => {
    assert.throws(() => alterationPatientRowSource([], "db"), /at least one part/);
  });
});
