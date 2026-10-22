// The timeline sub-DSL's semantics (lib/compiler.ts): what BEFORE, DURING and NOT_FOLLOWED_BY
// mean on day-resolution dates, what the prior-treatment guard keeps, and that what the compiler
// cannot honour is refused rather than approximated. These read the compiled SQL; the gallery's
// pinned example counts (test/fixtures/example-counts.json) check the same rules on real data.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compileCohort, validateSelector, LINE_TYPE } from "../lib/compiler.ts";
import { chException } from "../lib/ch.ts";

const A = { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Chemo" }] };
const B = { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] };
const compile = (o: Record<string, unknown>) => compileCohort({ db: "db", study: "s1", a: A, ...o } as any);

const cte = (sql: string, name: string): string => {
  const i = sql.indexOf(name + " AS (");
  assert.ok(i >= 0, "has a " + name + " CTE");
  const j = sql.indexOf("(", i);
  let depth = 0;
  for (let k = j; k < sql.length; k++) { if (sql[k] === "(") depth++; else if (sql[k] === ")" && --depth === 0) return sql.slice(j, k + 1); }
  throw new Error("unbalanced " + name);
};

describe("BEFORE: B starts after A, inside the window", () => {
  const sql = compile({ b: B, rel: { type: "BEFORE", minDays: 7, maxDays: 180 } }).countSql;
  test("strictly after A + minDays: a B on A's own day may have come first", () => {
    assert.match(sql, /sel_b\.start_date > sel_a\.start_date \+ 7/);
  });
  test("at most maxDays after A, that day included", () => {
    assert.match(sql, /sel_b\.start_date <= sel_a\.start_date \+ 180/);
  });
  test("the gap histogram counts each patient once, by their nearest qualifying B", () => {
    const { histSql, histBucket } = compile({ b: B, rel: { type: "BEFORE", maxDays: 180 } });
    assert.equal(histBucket, 15);
    assert.match(histSql!, /min\(sel_b\.start_date - sel_a\.start_date\) AS gap/);
    assert.match(histSql!, /GROUP BY patient_id\)\nWHERE gap <= 180/);
  });
});

describe("DURING: B starts within A's span", () => {
  const sql = compile({ b: B, rel: { type: "DURING" } }).countSql;
  test("A's first day counts", () => assert.match(sql, /sel_b\.start_date >= sel_a\.start_date/));
  test("A's last day counts, and an A with no stop date is a one-day event", () => {
    assert.match(sql, /sel_b\.start_date <= coalesce\(sel_a\.stop_date, sel_a\.start_date\)/);
  });
});

describe("NOT_FOLLOWED_BY: no B within the window after A", () => {
  test("a patient is excluded when any of their A occurrences is followed by B", () => {
    const sql = compile({ b: B, rel: { type: "NOT_FOLLOWED_BY", withinDays: 180 } }).countSql;
    assert.match(sql, /sel_a\.patient_id NOT IN \(SELECT a2\.patient_id FROM sel_a AS a2 JOIN sel_b/);
    assert.match(sql, /sel_b\.start_date > a2\.start_date AND sel_b\.start_date <= a2\.start_date \+ 180/);
  });
  test("without `observed`, a record that ends inside the window still counts as not followed", () => {
    assert.doesNotMatch(compile({ b: B, rel: { type: "NOT_FOLLOWED_BY", withinDays: 180 } }).countSql, /obs AS/);
  });
  test("`observed` asks for follow-up through the window: a later event of any type", () => {
    const sql = compile({ b: B, rel: { type: "NOT_FOLLOWED_BY", withinDays: 180, observed: true } }).countSql;
    const obs = cte(sql, "obs");
    assert.match(obs, /max\(start_date\) AS max_date FROM db\.clinical_event\n/);
    assert.doesNotMatch(obs, /event_type/, "any event type shows the patient was still followed");
    assert.match(sql, /obs\.max_date >= sel_a\.start_date \+ 180/);
  });
});

describe("which occurrence of an event counts", () => {
  test("FIRST is each patient's earliest start, with that event's own stop", () => {
    const sel = cte(compile({ a: { ...A, occurrence: "FIRST" } }).countSql, "sel_a");
    assert.match(sel, /min\(start_date\) AS occ_start, argMin\(stop_date, start_date\) AS occ_stop/);
  });
  test("LAST is each patient's latest start", () => {
    const sel = cte(compile({ a: { ...A, occurrence: "LAST" } }).countSql, "sel_a");
    assert.match(sel, /max\(start_date\) AS occ_start, argMax\(stop_date, start_date\) AS occ_stop/);
  });
  test("ANY keeps every occurrence", () => {
    assert.doesNotMatch(cte(compile({}).countSql, "sel_a"), /GROUP BY/);
  });
});

describe("priorGuard: only patients recorded as treatment-naive", () => {
  const guarded = compile({ b: B, rel: { type: "BEFORE", maxDays: 180 }, priorGuard: true }).countSql;
  test("naive means a 'No prior medications' record; a patient with no record is left out", () => {
    const naive = cte(guarded, "nopriormed");
    assert.match(naive, /lowerUTF8\(trimBoth\(pm\.key\)\) = lowerUTF8\(trimBoth\('PRIOR_MED_TO_MSK'\)\)/);
    assert.match(naive, /lowerUTF8\(trimBoth\(pm\.value\)\) = lowerUTF8\(trimBoth\('No prior medications'\)\)/);
  });
  test("a study that records the flag for no one is refused, not answered with an empty cohort", () => {
    const naive = cte(guarded, "nopriormed");
    assert.match(naive, /\n {4}AND \(SELECT throwIf\(count\(\) = 0, 'priorGuard needs the PRIOR_MED_TO_MSK treatment flag, and s1 records it for no patient[^']*'\) FROM/);
    assert.match(naive, /'PRIOR_MED_TO_MSK'\)\)\n {2}WHERE ce\.patient_id IN \(SELECT internal_id FROM study_patients\)\) = 0\n\)$/, "counts the key's records, whatever their value");
  });
  test("the refusal reaches the reader as its own words", () => {
    const body = JSON.stringify({ meta: [], data: [], rows: 0, exception: "Code: 395. DB::Exception: priorGuard needs the flag: while executing 'FUNCTION throwIf(...)'. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO)" });
    assert.equal(chException(body), "priorGuard needs the flag");
    assert.equal(chException('{"exception": "Code: 47. DB::Exception: Unknown identifier"}'), "Code: 47. DB::Exception: Unknown identifier");
    assert.equal(chException("Code: 60. Table missing"), "Code: 60. Table missing");
  });
  test("it filters A, which every relation reaches B through", () => {
    assert.match(cte(guarded, "sel_a"), /patient_id IN \(SELECT patient_id FROM nopriormed\)/);
    assert.doesNotMatch(cte(guarded, "sel_b"), /nopriormed/);
  });
  test("it filters the records treatment lines are built from", () => {
    const sql = compile({ a: { eventType: LINE_TYPE, attrs: [{ key: "LINE_NO", value: "1" }] }, priorGuard: true }).countSql;
    assert.match(cte(sql, "txAll"), /nopriormed/);
  });
  test("without it, nothing about prior treatment is read", () => {
    assert.doesNotMatch(compile({ b: B, rel: { type: "BEFORE", maxDays: 180 } }).countSql, /nopriormed|PRIOR_MED/);
  });
});

describe("what the compiler cannot honour is refused", () => {
  test("an unknown relation, rather than dropping B", () => {
    assert.throws(() => compile({ b: B, rel: { type: "AFTER" } }), /rel\.type must be one of NONE, BEFORE, DURING, NOT_FOLLOWED_BY, not "AFTER"/);
  });
  test("an unknown occurrence, rather than counting any", () => {
    assert.throws(() => validateSelector({ ...A, occurrence: "SECOND" } as any), /occurrence must be ANY, FIRST or LAST/);
  });
  test("an unsupported numeric op, rather than a different comparison", () => {
    assert.throws(() => validateSelector({ eventType: "Lab", numeric: { key: "RESULT", op: "!=", value: 3 } }), /numeric op must be one of/);
  });
  test("more attribute matches than a selector takes, rather than dropping some", () => {
    const attrs = ["A", "B", "C", "D"].map((k) => ({ key: k, value: "x" }));
    assert.throws(() => validateSelector({ eventType: "Lab", attrs }), /at most 3 attribute matches; this has 4/);
  });
  test("a window that is not a number", () => {
    assert.throws(() => compile({ b: B, rel: { type: "BEFORE", maxDays: "soon" } }), /invalid number for maxDays/);
  });
  test("blank attribute rows are an unfinished form, not a condition", () => {
    assert.deepEqual(validateSelector({ eventType: "Lab", attrs: [{ key: "", value: "" }, { key: "K", value: "v" }] }).attrs, [{ key: "K", value: "v" }]);
  });
  test("no relation, or NONE, is A alone", () => {
    assert.equal(compile({}).countSql, compile({ rel: { type: "NONE" } }).countSql);
    assert.doesNotMatch(compile({ b: B, rel: { type: "NONE" } }).countSql, /sel_b/);
  });
});
