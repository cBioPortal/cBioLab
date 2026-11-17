// A page's every-row columns: the values rounded one step finer than the page writes them, and the
// byte limit past which they are left out with the limit named (lib/chart/format.ts, lib/views/shared.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { roundSig, roundPlaces, fmtMb } from "../lib/chart/format.ts";
import { allRowsWithin, ALL_ROWS_MAX_BYTES } from "../lib/views/shared.ts";

test("roundSig keeps a number to the given significant digits; 0 and non-finite values pass through", () => {
  assert.equal(roundSig(1.23456789e-105, 4), 1.235e-105);
  assert.equal(roundSig(0.000123456, 4), 0.0001235);
  assert.equal(roundSig(98765.4321, 4), 98770);
  assert.equal(roundSig(0, 4), 0);
  assert.equal(roundSig(Number.POSITIVE_INFINITY, 4), Number.POSITIVE_INFINITY);
  assert.ok(Number.isNaN(roundSig(Number.NaN, 4)));
});

test("roundPlaces keeps a number to the given decimal places, serialised short", () => {
  assert.equal(roundPlaces(13.33456, 3), 13.335);
  assert.equal(roundPlaces(-6.7549, 3), -6.755);
  assert.equal(JSON.stringify(roundPlaces(0.1 + 0.2, 3)), "0.3");
});

test("fmtMb writes megabytes to one place", () => {
  assert.equal(fmtMb(2_500_000), "2.5 MB");
  assert.equal(fmtMb(4_200_000), "4.2 MB");
});

test("allRowsWithin keeps columns under the limit and names the size of those over it", () => {
  const small = { gene: ["A", "B"] };
  assert.deepEqual(allRowsWithin(small), { all: small });
  const big = { gene: Array.from({ length: 300_000 }, (_, i) => "GENE" + i) };
  const r = allRowsWithin(big);
  assert.ok("tooBig" in r && r.tooBig > ALL_ROWS_MAX_BYTES);
});
