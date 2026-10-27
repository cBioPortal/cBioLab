// Clearing the result cache from /admin expires one tag (RESULT_TAG, lib/next-cache.ts), so it
// clears only entries that carry it: every `'use cache: remote'` body must start with resultEntry(),
// which sets the tag with the lifetime. A cached function written without it would survive a clear.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";

test("every cached function carries the tag a cache clear expires", () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = d + "/" + f; if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p); } };
  for (const d of ["app", "lib", "mcp"]) walk(d);
  const bodies: string[] = [], untagged: string[] = [];
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((l, i) => {
      if (!/^\s*["']use cache(: \w+)?["'];/.test(l)) return;
      bodies.push(f + ":" + (i + 1));
      if (!/^\s*resultEntry\(\);/.test(lines[i + 1] || "")) untagged.push(f + ":" + (i + 1));
    });
  }
  assert.ok(bodies.length >= 9, "expected the cached functions of lib/next-cache.ts and the routes; found " + bodies.length);
  assert.deepEqual(untagged, [], "start these cached bodies with resultEntry() (lib/next-cache.ts), or /admin's clear misses them");
});
