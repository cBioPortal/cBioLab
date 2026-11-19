// The cut points of a quantile split over several studies (STS-STM-12): the same rule the one-study
// split runs in ClickHouse (quantilesExact: the value at position ⌊p·n⌋ of the n sorted values,
// the last for p·n ≥ n), over every study's value counts pooled, so a cohort across studies is cut
// at its own quartiles rather than refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pooledCuts } from "../lib/partition-arms.ts";

const counts = (xs: number[]) => {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x, (m.get(x) || 0) + 1);
  return [...m].map(([v, n]) => ({ v, n }));
};

test("quantilesExact's position: ⌊p·n⌋ of the sorted values", () => {
  // [1, 2, 3, 4]: the median at index 2 is 3, as ClickHouse's quantileExact(0.5) gives
  assert.deepEqual(pooledCuts(counts([4, 1, 3, 2]), [0.5]), { qs: [3], hi: 4, n: 4 });
  assert.deepEqual(pooledCuts(counts([1, 2, 3, 4, 5, 6, 7, 8]), [0.25, 0.5, 0.75]), { qs: [3, 5, 7], hi: 8, n: 8 });
  assert.deepEqual(pooledCuts(counts([10, 20, 30]), [0.25, 0.5, 0.75]), { qs: [10, 20, 30], hi: 30, n: 3 });
});

test("two studies' counts pooled: the cut is the cohort's, not either study's", () => {
  const a = counts([1, 1, 2, 2]), b = counts([2, 9, 9, 9]);
  const pooled = [...a, ...b];
  assert.deepEqual(pooledCuts(pooled, [0.5]), { qs: [2], hi: 9, n: 8 });
  // the same value from both studies counts once per case
  assert.deepEqual(pooledCuts([{ v: 5, n: 2 }, { v: 5, n: 3 }, { v: 7, n: 1 }], [0.5]), { qs: [5], hi: 7, n: 6 });
});

test("no value: n 0, so the split is refused as before", () => {
  assert.deepEqual(pooledCuts([], [0.5]), { qs: [], hi: NaN, n: 0 });
});
