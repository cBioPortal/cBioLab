// Every repository path the docs and the code's comments name must exist. A pointer to a file
// that moved or was deleted ("see test/<name>.test.ts") sends the next reader, person or agent, to
// nothing, and nothing else notices: the reference is prose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const SKIP_DIRS = new Set(["node_modules", "fixtures", "__pycache__"]);
const walk = (dir: string): string[] => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (SKIP_DIRS.has(e.name) || e.name.startsWith(".") ? [] : walk(join(dir, e.name))) : [join(dir, e.name)]);
const sources = [
  ...readdirSync(root).filter((f) => f.endsWith(".md")),
  ...["docs", "lib", "app", "mcp", "scripts", "test", "python"].flatMap(walk),
].filter((f) => /\.(md|ts|tsx|cjs|mjs|py|sh)$/.test(f));

// a path under one of the repo's top-level folders, ending in a file extension; a placeholder
// such as lib/views/<kind>.ts does not match
const PATH = /(?<![\w./-])((?:lib|test|scripts|docs|app|mcp|python|db)\/[A-Za-z0-9_\-./[\]()]+?\.(?:ts|tsx|js|md|cjs|mjs|py|json|sql|sh|svg|npz))(?!\w)/g;

test("every repository path named in the docs and comments exists", () => {
  const missing: string[] = [];
  for (const f of sources) {
    for (const m of readFileSync(join(root, f), "utf8").matchAll(PATH))
      if (!existsSync(join(root, m[1]))) missing.push(m[1] + " (named in " + f + ")");
  }
  assert.deepEqual([...new Set(missing)], [], "fix or remove these references");
  assert.ok(sources.length > 300, "the scan found the sources");
});
