// A cancelled query must never be remembered as an answer.
//
// This guards a real outage, not a hypothetical. `studyRouting()` has always swallowed query
// failures — "an unreachable instance simply contributes no studies" — and then memoized the
// result for the life of the process. That was safe while the only possible error meant the
// instance was genuinely unreachable. Wiring the reader's abort signal through to ClickHouse
// introduced a second, entirely different error: AbortError, which means the READER left and
// says nothing at all about the data.
//
// The two together were an outage. One cancelled request — a facet ticked twice quickly, or a
// browser navigating away — could land while the routing map was still being built. The catch
// swallowed it, an EMPTY map was cached, and from then on every request from every user was
// refused with "unknown study <x>" until the process restarted. It presented as a flaky e2e
// suite (4 failures in 5 cold runs) and took a bisect to find, because a warm process had
// already cached a good map and could never reproduce it.
//
// The dangerous edit is any `catch` that folds an error into a cached value without asking
// whether the error was a cancellation. It does not fail loudly; it fails once, silently, and
// then permanently.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const federation = src("lib/federation.ts");
const annotation = src("lib/annotation.ts");
const analysis = src("lib/analysis.ts");
const ch = src("lib/ch.ts");

/** the routing builder, where a failed instance is tolerated and the answer is memoized */
function studyRoutingSrc(): string {
  const i = federation.indexOf("export async function studyRouting(");
  assert.ok(i > 0, "could not find studyRouting in lib/federation.ts");
  const j = federation.indexOf("\nexport ", i + 10);
  return federation.slice(i, j > 0 ? j : i + 3000);
}

describe("a cancelled query is never cached as an answer", () => {
  test("ch.ts exports a way to tell a cancellation from a failure", () => {
    assert.match(ch, /export function isAbortError\b/,
      "isAbortError must be exported: callers that catch errors need to distinguish a reader " +
      "leaving from data being unavailable");
    assert.match(ch, /AbortError/, "isAbortError must recognise undici's AbortError");
  });

  test("studyRouting rethrows a cancellation instead of swallowing it", () => {
    const fn = studyRoutingSrc();
    assert.match(fn, /catch\s*\(\s*\w+\s*\)/,
      "the catch must bind the error — a bare `catch {}` cannot tell a cancellation apart");
    assert.match(fn, /isAbortError\s*\(\s*\w+\s*\)\s*\)?\s*(\)\s*)?\{?\s*throw|if\s*\(\s*isAbortError[^)]*\)\s*throw/,
      "studyRouting must rethrow an abort: caching an empty routing map because the reader " +
      "left makes every later request answer 'unknown study'");
  });

  test("studyRouting memoizes only a complete answer", () => {
    const fn = studyRoutingSrc();
    // the assignment to the module-level cache must be conditional
    const assign = fn.match(/_routing\s*=\s*map/g) || [];
    assert.equal(assign.length, 1, "expected exactly one place that memoizes the routing map");
    assert.match(fn, /if\s*\(\s*complete\s*\)\s*_routing\s*=\s*map/,
      "the routing map must be cached only when every instance answered — a partial map would " +
      "outlive the outage that produced it and make a transient failure look permanent");
  });

  // The same trap, at the other sites an abort can now reach. These were found by asking
  // "where else does a catch feed a cached value?" rather than by another outage.
  test("the OncoKB pin is not cached as null because a reader left", () => {
    const i = annotation.indexOf("export async function oncokbPin(");
    assert.ok(i > 0, "could not find oncokbPin in lib/annotation.ts");
    const fn = annotation.slice(i, annotation.indexOf("\n}", i));
    assert.match(fn, /isAbortError\s*\(\s*\w+\s*\)\s*\)?\s*throw/,
      "oncokbPin must rethrow an abort: caching a null pin refuses every `OQL ... DRIVER` " +
      "clause until the 5-minute TTL expires");
  });

  test("the synced-study list is not cached empty because a reader left", () => {
    const i = annotation.indexOf("async function syncedStudies(");
    assert.ok(i > 0, "could not find syncedStudies in lib/annotation.ts");
    const fn = annotation.slice(i, annotation.indexOf("\n}", i));
    assert.match(fn, /isAbortError\s*\(\s*\w+\s*\)\s*\)?\s*throw/,
      "syncedStudies must rethrow an abort: this cache has NO TTL, so swallowing one would " +
      "convince the process that no study is synced for the rest of its life");
  });

  test("validStudies does not keep a second cache that could outlive the routing map", () => {
    const i = analysis.indexOf("export async function validStudies(");
    assert.ok(i > 0, "could not find validStudies in lib/analysis.ts");
    const fn = analysis.slice(i, i + 400);
    assert.doesNotMatch(fn, /_studySet\s*=/,
      "validStudies must not memoize separately: a second cache on top of studyRouting can " +
      "outlive a bad routing map, which is exactly how one cancelled request became a process " +
      "that rejected every study until restarted");
  });
});
