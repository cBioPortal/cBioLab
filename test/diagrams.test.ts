// The diagrams in docs/diagrams/ (drawn into docs/ARCHITECTURE.md) held to the code: every path
// they name exists, every name they cite is still in the source, and the view-kind diagram lists
// exactly the files kind folders hold and the registries keyed by ViewKind. A failure here means
// the code moved: edit the HTML, run `node scripts/render-diagrams.cjs`, and commit both.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const DIR = join(ROOT, "docs", "diagrams");
const SOURCE_DIRS = ["lib", "app", "mcp", "scripts", "python", "test"];
const SOURCE_EXT = /\.(ts|tsx|cjs|mjs|js|py)$/;

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const sourceFiles = SOURCE_DIRS.filter((d) => existsSync(join(ROOT, d))).flatMap((d) => walk(join(ROOT, d)))
  .filter((p) => !p.includes(join("test", "snapshots")));
const topLevel = readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
const basenames = new Set([...sourceFiles.map((p) => basename(p)), ...topLevel]);
const source = sourceFiles.filter((p) => SOURCE_EXT.test(p)).map((p) => readFileSync(p, "utf8")).join("\n");
const kinds = readdirSync(join(ROOT, "lib", "views")).filter((k) => statSync(join(ROOT, "lib", "views", k)).isDirectory());

/** a path that may hold `<kind>` or `*`: it exists as written, or for at least one kind */
function pathExists(p: string): boolean {
  const clean = p.replace(/\/$/, "").replaceAll("*", "<kind>");
  if (!clean.includes("<kind>")) return existsSync(join(ROOT, clean));
  return kinds.some((k) => existsSync(join(ROOT, clean.replaceAll("<kind>", k))));
}

/** what one `<code>` label claims, or null when it is not a path or a name (a URL, a type, a command) */
function claim(label: string): { path: string } | { file: string } | { name: string } | null {
  if (/^(lib|app|test|docs|scripts|python|mcp|db)\//.test(label)) return { path: label };
  if (/^[\w.-]+\.(ts|tsx|cjs|mjs|json|md)$/.test(label)) return { file: label };
  if (/^kinds\/<kind>\.tsx$/.test(label)) return { path: "app/lab/" + label };
  const call = /^(?:[a-z]\w*\.)?([A-Za-z_]\w*)(\(.*\))?$/.exec(label);
  if (call && call[1].length > 3) return { name: call[1] };
  return null;
}

const diagrams = readdirSync(DIR).filter((f) => f.endsWith(".html"));

describe("docs/diagrams", () => {
  test("every diagram has its rendered PNG beside it", () => {
    for (const f of diagrams) assert.ok(existsSync(join(DIR, f.replace(/\.html$/, ".png"))), f + " has no PNG: run node scripts/render-diagrams.cjs");
  });

  for (const f of diagrams) test(f + ": every path and name it shows is still in the code", () => {
    const html = readFileSync(join(DIR, f), "utf8");
    const labels = [...html.matchAll(/<code>([^<]*)<\/code>/g)].map((m) => unescape(m[1]).trim());
    const missing: string[] = [];
    for (const label of new Set(labels)) {
      const c = claim(label);
      if (!c) continue;
      if ("path" in c && !pathExists(c.path)) missing.push(label + " (no such path)");
      if ("file" in c && !basenames.has(c.file)) missing.push(label + " (no file of that name)");
      if ("name" in c && !new RegExp("\\b" + c.name + "\\b").test(source)) missing.push(label + " (not in the source)");
    }
    assert.deepEqual(missing, [], f + " names what the code no longer has");
  });
});

describe("docs/diagrams/view-kind.html", () => {
  const html = readFileSync(join(DIR, "view-kind.html"), "utf8");
  const shown = [...html.matchAll(/data-kind-file="([^"]+)"( data-every)?/g)].map((m) => ({ file: m[1], every: !!m[2] }));

  test("the files marked 'every kind' are exactly those every kind folder holds", () => {
    const every = shown.filter((s) => s.every).map((s) => s.file).sort();
    const counts = new Map<string, number>();
    for (const k of kinds) for (const f of readdirSync(join(ROOT, "lib", "views", k))) counts.set(f, (counts.get(f) ?? 0) + 1);
    const inAll = [...counts].filter(([, n]) => n === kinds.length).map(([f]) => f).sort();
    assert.deepEqual(every, inAll);
  });

  test("every file that three or more kind folders hold is shown", () => {
    const counts = new Map<string, number>();
    for (const k of kinds) for (const f of readdirSync(join(ROOT, "lib", "views", k))) counts.set(f, (counts.get(f) ?? 0) + 1);
    const common = [...counts].filter(([, n]) => n >= 3).map(([f]) => f).sort();
    assert.deepEqual(shown.map((s) => s.file).sort(), common);
  });

  test("the registries shown are exactly the maps keyed by ViewKind", () => {
    const drawn = [...html.matchAll(/data-registry="([^"]+)" data-file="([^"]+)"/g)].map((m) => m[1] + " " + m[2]).sort();
    const found: string[] = [];
    for (const p of sourceFiles.filter((x) => /\.tsx?$/.test(x))) {
      for (const m of readFileSync(p, "utf8").matchAll(/^(?:export )?const ([A-Z_]+)\s*:\s*(?:Record<ViewKind\b|\{\s*\[K in ViewKind\])/gm))
        found.push(m[1] + " " + p.slice(ROOT.length + 1));
    }
    assert.deepEqual(drawn, found.sort());
  });
});
