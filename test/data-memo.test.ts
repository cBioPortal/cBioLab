// Per-process memos of facts read from the studies (lib/data-memo.ts) obey the result cache's
// rules: a memo is good only under the data and settings version it was read under, for at most a
// day, and nothing is kept with RESULT_CACHE=off. A memo kept for the life of the process hid every
// study and profile imported after the server started.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DataMemo } from "../lib/data-memo.ts";

test("a memo is good only under the version it was read under", () => {
  const m = new DataMemo<number>();
  m.put("s", "v1", 1);
  assert.equal(m.fresh("s", "v1"), 1);
  assert.equal(m.fresh("s", "v2"), undefined, "new data or settings must be read again");
  assert.equal(m.fresh("s", null), undefined, "a version that could not be read is not trusted");
  m.put("t", null, 2);
  assert.equal(m.fresh("t", null), undefined, "nothing is kept without a version");
});

test("a memo is never older than a day", (t) => {
  const m = new DataMemo<number>();
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  m.put("s", "v", 1);
  t.mock.method(Date, "now", () => now + 24 * 3600_000 + 1);
  assert.equal(m.fresh("s", "v"), undefined);
});

test("RESULT_CACHE=off keeps nothing", async () => {
  const saved = process.env.RESULT_CACHE;
  process.env.RESULT_CACHE = "off";
  try {
    const m = new DataMemo<number>();
    m.put("s", "v", 1);
    assert.equal(m.fresh("s", "v"), undefined);
    let reads = 0;
    await m.get("s", async () => ++reads);
    await m.get("s", async () => ++reads);
    assert.equal(reads, 2, "every reader reads the data");
  } finally {
    if (saved === undefined) delete process.env.RESULT_CACHE; else process.env.RESULT_CACHE = saved;
  }
});
