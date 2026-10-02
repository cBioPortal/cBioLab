// The one definition of a treatment line (lib/treatment-lines.ts), and that every caller uses it:
// the sequence view, the DSL's "Treatment line (derived)" (and the MCP tool built on it) and the
// `lines` cohort metric must build lines from the same records by the same rule, or "number of
// lines" depends on where it is asked.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { linesCtes, lineClassesOf, SYSTEMIC_LINE_CLASSES, compositionKeySql } from "../lib/treatment-lines.ts";
import { sequenceSql } from "../lib/federation.ts";
import { compileLines, compileCohort, LINE_TYPE } from "../lib/compiler.ts";
import { derivedMetricSql } from "../lib/cohort2.ts";

const block = (sql: string, name: string) => {
  const i = sql.indexOf(name + " AS (");
  assert.ok(i >= 0, "has a " + name + " CTE");
  let depth = 0, j = sql.indexOf("(", i);
  for (let k = j; k < sql.length; k++) { if (sql[k] === "(") depth++; else if (sql[k] === ")" && --depth === 0) return sql.slice(j, k + 1); }
  throw new Error("unbalanced " + name);
};

describe("which records form lines", () => {
  const sql = linesCtes({ db: "db", study: "s", patientFilter: "1", spec: { gap: 90 } }).join(",\n");
  test("systemic-therapy classes by default, on both class vocabularies, folded", () => {
    for (const c of ["chemo", "medical therapy", "targeted molecular therapy"]) assert.ok((SYSTEMIC_LINE_CLASSES as readonly string[]).includes(c));
    for (const c of ["radiation therapy", "prior medications to msk", "bone treatment", "surgery, nos"]) assert.ok(!(SYSTEMIC_LINE_CLASSES as readonly string[]).includes(c), c + " is not a line of systemic therapy");
    assert.match(sql, /t\.cls IN \(lowerUTF8\(trimBoth\('chemo'\)\)/);
  });
  test("the class is SUBTYPE where an event has one, else TREATMENT_TYPE", () => {
    assert.match(sql, /argMin\(lowerUTF8\(trimBoth\(value\)\), \(lowerUTF8\(trimBoth\(key\)\) != 'subtype', lowerUTF8\(trimBoth\(value\)\)\)\)/);
  });
  test("a document can take every record, or name its own classes", () => {
    assert.equal(lineClassesOf({ gap: 90, classes: "all" }), null);
    assert.deepEqual(lineClassesOf({ gap: 90, classes: ["Chemo", " RADIATION THERAPY "] }), ["chemo", "radiation therapy"]);
    assert.doesNotMatch(linesCtes({ db: "db", study: "s", patientFilter: "1", spec: { gap: 90, classes: "all" } }).join(""), /t\.cls IN/);
  });
  test("a new line needs a gap past the running maximum stop", () => {
    assert.match(sql, /max\(toNullable\(e\)\) OVER \(PARTITION BY patient_id\s+ORDER BY s, e, eid ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING\)/);
    assert.match(sql, /pms IS NULL OR s > pms \+ 90/);
  });
});

describe("every caller builds lines the same way", () => {
  const seq = sequenceSql("SELECT 1 AS pid", "s", "db", { eventType: "Treatment", labelKey: "SUBTYPE", exclude: [], lineGap: 90, maxSteps: 3 });
  const dsl = compileLines("db", "s", 90, false).histSql;
  const cohort = compileCohort({ db: "db", study: "s", a: { eventType: LINE_TYPE, attrs: [{ key: "LINE_NO", value: "3" }] } as any }).countSql;
  const metric = derivedMetricSql("lines", "s", "db", { eventType: "Treatment", lineGap: 90 });
  for (const name of ["txLabelled", "flagged", "numbered", "lines"]) {
    test("the " + name + " step is identical in the sequence view, the DSL's derived lines and the lines metric", () => {
      const ref = block(seq, name);
      assert.equal(block(dsl, name), ref);
      assert.equal(block(cohort, name), ref);
      assert.equal(block(metric, name), ref);
    });
  }
  test("they differ only in which patients they look at", () => {
    assert.notEqual(block(seq, "txAll"), block(metric, "txAll"));
    assert.equal(block(seq, "txAll").replace(/p\.stable_id IN \(SELECT pid FROM cohort\)/, "1"), block(metric, "txAll"));
  });
});

test("a COMPOSITION clause matches the combination however it is spaced or cased", () => {
  const sql = compileCohort({ db: "db", study: "s", a: { eventType: LINE_TYPE, attrs: [{ key: "COMPOSITION", value: "biologic+CHEMO" }] } as any }).countSql;
  assert.ok(sql.includes(compositionKeySql("combo") + " = " + compositionKeySql("'biologic+CHEMO'")));
});
