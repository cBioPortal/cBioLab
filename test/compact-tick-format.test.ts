// An axis tick where room is short (lib/chart/format.ts fmtCompactTick): thousands as K, M, B.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtCompactTick } from "../lib/chart/format.ts";

test("fmtCompactTick: K, M, B from a thousand, one decimal at most; below that the scale's own format", () => {
  const cases: [number, string][] = [
    [0, "0"], [999, "999"], [1000, "1K"], [2000, "2K"], [2500, "2.5K"], [10000, "10K"], [12345, "12.3K"],
    [999_999, "1M"], [999_400, "999.4K"], [1_000_000, "1M"], [1_200_000, "1.2M"], [3e9, "3B"], [-4000, "−4K"],
  ];
  for (const [v, want] of cases) assert.equal(fmtCompactTick(v), want, String(v));
  // below a thousand, the formatter it is given
  assert.equal(fmtCompactTick(0.2, (v) => v.toString() + "!"), "0.2!");
  assert.equal(fmtCompactTick(5000, () => "unused"), "5K");
});
