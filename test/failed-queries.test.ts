// A cached answer must not be built on a failed query, even one the engine caught and turned
// into a view's `error` (lib/next-cache.ts runs every cached body under withoutFailedQueries).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { chQuery, withoutFailedQueries, FailedQueriesError, type ChConn } from "../lib/ch.ts";

// nothing listens on the discard port, so the request fails at once
const DOWN: ChConn = { id: "down", url: "http://127.0.0.1:9", user: "u", password: "p", db: "d", label: "down" };

describe("withoutFailedQueries", () => {
  test("returns the value when nothing failed", async () => {
    assert.equal(await withoutFailedQueries(async () => 42), 42);
  });
  test("throws when a query failed, even though the caller caught it", async () => {
    const run = withoutFailedQueries(async () => {
      try { await chQuery("SELECT 1", DOWN); } catch { return { kind: "survival", error: "the view degraded" }; }
      return { kind: "survival" };
    });
    await assert.rejects(run, (e: unknown) => e instanceof FailedQueriesError && e.count === 1);
  });
  test("a failure outside it is not counted inside a later one", async () => {
    await chQuery("SELECT 1", DOWN).catch(() => {});
    assert.equal(await withoutFailedQueries(async () => "clean"), "clean");
  });
});
