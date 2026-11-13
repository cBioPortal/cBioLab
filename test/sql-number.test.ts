// THE numeric read of a stored value (lib/sql-number.ts): NaN and ±Infinity are missing, like any
// other text that is not a number, so they never reach a histogram bin, a minimum or a survival time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { finiteSql, finiteNumber } from "../lib/sql-number.ts";

test("finiteSql keeps a finite number and reads NaN and infinity as NULL", () => {
  assert.equal(finiteSql("v"), "if(isFinite(ifNull(toFloat64OrNull(v), nan)), toFloat64OrNull(v), NULL)");
});

test("every numeric read of a value in lib goes through finiteSql", () => {
  // one module may name toFloat64OrNull bare: its own; a summary that guards with isFinite itself is the other
  const bare = (readdirSync("lib", { recursive: true }) as string[]).filter((f) => f.endsWith(".ts") && f !== "sql-number.ts" && f !== "dsl-reference.ts")
    .flatMap((f) => readFileSync("lib/" + f, "utf8").split("\n").map((line, i) => ({ f, i: i + 1, line })))
    .filter(({ line }) => line.includes("toFloat64OrNull(") && !line.includes("isFinite("));
  assert.deepEqual(bare.map(({ f, i }) => f + ":" + i), []);
});

/** the warehouse's own non-numbers in NUMBER attributes, and JavaScript's lenient readings (python/tests read this list too) */
const WHOLE_NUMBER_CASES: [string, number | null][] = [
  ["7", 7], ["-2", -2], ["+5", 5], [".5", 0.5], ["1.", 1], ["1e3", 1000], ["2.5E-1", 0.25],
  [">90", null], ["> 90", null], ["<0.5", null], ["9-10", null], ["4+3", null], ["default", null], ["1801082_2", null],
  ["12abc", null], ["0x10", null], ["1,5", null], ["", null], ["Infinity", null], ["nan", null], ["1_000", null],
];

test("finiteNumber: a number only when the whole text is a decimal one, as finiteSql reads it", () => {
  for (const [s, want] of WHOLE_NUMBER_CASES) {
    const x = finiteNumber(s);
    assert.equal(Number.isNaN(x) ? null : x, want, JSON.stringify(s));
  }
});
