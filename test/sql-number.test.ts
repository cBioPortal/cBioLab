// THE numeric read of a stored value (lib/sql-number.ts): NaN and ±Infinity are missing, like any
// other text that is not a number, so they never reach a histogram bin, a minimum or a survival time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { finiteSql } from "../lib/sql-number.ts";

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
