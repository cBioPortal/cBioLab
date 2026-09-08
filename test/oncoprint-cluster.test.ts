// Ward clustering of columns: it must group like with like, be deterministic, and never
// invent structure that is not there.
import test from "node:test";
import assert from "node:assert/strict";
import { wardOrder, CLUSTER_LIMIT } from "../lib/oncoprint-cluster.ts";

/** three tight groups, interleaved on input: high, low, and middling on two dimensions */
const interleaved = () => {
  const n = 30;
  const a = new Float64Array(n), b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const g = i % 3;                       // 0 high, 1 low, 2 middling
    a[i] = g === 0 ? 10 + (i % 5) * 0.01 : g === 1 ? -10 + (i % 5) * 0.01 : 0.2;
    b[i] = g === 0 ? 10 : g === 1 ? -10 : 0;
  }
  return { columns: [a, b], n };
};

test("like columns end up adjacent, whatever order they arrived in", () => {
  const order = wardOrder(interleaved());
  assert.equal(order.length, 30);
  assert.equal(new Set(order).size, 30, "every column appears exactly once");
  const group = (i: number) => i % 3;
  // each group occupies one contiguous run
  const runs: number[] = [];
  for (const i of order) if (!runs.length || runs[runs.length - 1] !== group(i)) runs.push(group(i));
  assert.equal(runs.length, 3, "three runs, not " + runs.length + ": " + order.map(group).join(""));
});

test("the order is deterministic", () => {
  const a = wardOrder(interleaved()), b = wardOrder(interleaved());
  assert.deepEqual(a, b);
});

test("missing values sit at the mean rather than at an end", () => {
  const n = 6;
  const col = Float64Array.from([5, 5, -5, -5, NaN, NaN]);
  const order = wardOrder({ columns: [col], n });
  assert.equal(order.length, n);
  const pos = new Map(order.map((idx, at) => [idx, at]));
  const gap = Math.abs(pos.get(4)! - pos.get(5)!);
  assert.equal(gap, 1, "the two valueless columns cluster together");
});

test("degenerate inputs pass through instead of throwing", () => {
  assert.deepEqual(wardOrder({ columns: [], n: 5 }), [0, 1, 2, 3, 4]);
  assert.deepEqual(wardOrder({ columns: [Float64Array.from([1, 2])], n: 2 }), [0, 1]);
  assert.deepEqual(wardOrder({ columns: [new Float64Array(4)], n: 4 }).sort(), [0, 1, 2, 3]);
});

test("the limit is a real number a caller can reason about", () => {
  assert.ok(CLUSTER_LIMIT >= 1000 && CLUSTER_LIMIT <= 100000);
});
