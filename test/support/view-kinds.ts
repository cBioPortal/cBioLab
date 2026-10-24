// Every view kind the document language has: each kind folder's lib/views/<kind>/types.ts adds its
// entry to ViewSpecs, so the kinds are the keys those entries declare. Sorted.
import { existsSync, readFileSync, readdirSync } from "node:fs";

export function viewKinds(): string[] {
  const dir = new URL("../../lib/views/", import.meta.url);
  const kinds: string[] = [];
  for (const d of readdirSync(dir)) {
    const f = new URL(d + "/types.ts", dir);
    if (!existsSync(f)) continue;
    const m = /interface ViewSpecs \{\s*([a-z0-9_]+)\s*:/.exec(readFileSync(f, "utf8"));
    if (m) kinds.push(m[1]);
  }
  return kinds.sort();
}
