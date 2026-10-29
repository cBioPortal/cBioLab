// Every view kind's output, pinned: one gallery example per kind (and a few that combine studies)
// runs through the whole engine (cohort compiler, runner, statistics, figure, results text) with
// the warehouse replaced by answers recorded from it. Five files per case in test/snapshots/ are
// compared byte for byte:
//   <case>.sql   each cohort's compiled SQL and each view's queries, by label and study
//   <case>.json  what each view computed (its result, without timings or the queries above; a long
//                array, or an object of more than 50 keys, as its first 20 items, then the rest's
//                count and digest)
//   <case>.svg   each view's figure;  <case>.txt  the results text MCP clients and the AI tools read
//   <case>.html  each view's card as the lab page draws it: header, controls, body
//                (test/support/render-views.ts)
// A change to shared code that moves another view's numbers, figure, text or queries fails here,
// named by the case. A changed query has no recorded answer, so it fails as "not recorded".
// Each case runs twice, its answers delivered in the order its queries were sent and then in the
// reverse, and the two runs must agree exactly: output that depends on which query finished first
// fails as such. (A view's
// queries are listed sorted in <case>.sql: independent queries form a set, and the snapshot pins
// which are sent, not the order they happen to be sent in.)
//
// The cases run in four parallel test files, test/view-snapshots.test.ts and -2, -3, -4.test.ts.
//
//   UPDATE_SNAPSHOTS=1 npm test          output changed on purpose, queries did not: rewrite the four files
//   RECORD_SNAPSHOTS=1 node --env-file=.env.local --test test/view-snapshots*.test.ts
//                                        queries changed: re-ask the warehouse, then rewrite everything
// Recording reads the public warehouse only (the second instance is unset first); the answers are
// stored gzipped in test/snapshots/answers/, keyed by statement, under the database name below.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { join } from "node:path";

const RECORD = !!process.env.RECORD_SNAPSHOTS;
const UPDATE = RECORD || !!process.env.UPDATE_SNAPSHOTS;
/** the database name every snapshot is written under, whatever the recording ran against */
const SNAPSHOT_DB = "snapshot_db";
const realDb = (process.env.CLICKHOUSE_DB || "").replace(/[^A-Za-z0-9_]/g, "");
if (RECORD) {
  for (const k of Object.keys(process.env)) if (k.startsWith("CLICKHOUSE2_") || k === "LOOPBACK_PEER") delete process.env[k];
  if (!realDb) throw new Error("RECORD_SNAPSHOTS needs the warehouse: run with node --env-file=.env.local");
} else {
  process.env.CLICKHOUSE_DB = SNAPSHOT_DB;
  for (const k of Object.keys(process.env)) if (k.startsWith("CLICKHOUSE2_")) delete process.env[k];
}

const { setChTransport } = await import("../../lib/ch.ts");
const { EXAMPLES } = await import("../../lib/dsl-reference.ts");
const { runAnalysis } = await import("../../lib/analysis.ts");
const { withRequestCustomData } = await import("../../lib/custom-data-server.ts");
const { viewToSvg } = await import("../../lib/view-svg.ts");
const { analysisText } = await import("../../lib/result-text.ts");
const { renderViewCards } = await import("./render-views.ts");
import type { AnalysisDoc, AnalysisResult } from "../../lib/types.ts";
import { viewKinds } from "./view-kinds.ts";

/**
 * The cases: every gallery example marked `snapshot` (lib/views/kind-doc.ts), by that name, in gallery
 * order. One per view kind — the smallest gallery example that draws it, in the kind's doc.ts or the
 * guide's examples (the oncoprint is pinned by test/oncoprint-svg.test.ts) — and one per option that
 * changes what a view asks; then examples that combine studies, where a view adds up answers from
 * several databases.
 */
const CASES: Record<string, string> = Object.fromEntries(EXAMPLES.flatMap((e) => e.snapshot ? [[e.snapshot, e.title]] : []));

const DIR = join(import.meta.dirname, "..", "snapshots");
const ANSWERS = join(DIR, "answers");
const toSnapshotDb = (s: string) => realDb ? s.replaceAll(realDb + ".", SNAPSHOT_DB + ".").replaceAll("'" + realDb + "'", "'" + SNAPSHOT_DB + "'") : s;

/** a statement's key: the instance, the format, the text and every table sent with it */
async function keyOf(st: { conn: { id: string }; format: string; query: string; externals: { name: string; structure: string; blob: Blob }[] }): Promise<string> {
  const h = createHash("sha256").update(st.conn.id + "\n" + st.format + "\n" + toSnapshotDb(st.query));
  for (const e of st.externals) h.update("\n" + e.name + "\n" + e.structure + "\n" + await e.blob.text());
  return h.digest("hex").slice(0, 32);
}

/** a ClickHouse answer without its timing statistics, which differ on every run */
function steady(text: string): string {
  try { const j = JSON.parse(text); delete j.statistics; return JSON.stringify(j); } catch { return text; }
}

/**
 * A long array (or an object keyed by gene, by value, …) keeps its first items in full and stands in
 * for the rest by their count and digest, so a change anywhere still fails the comparison while the
 * file stays small enough to review.
 */
const KEEP = 20, KEEP_KEYS = 50;
function compact(x: unknown): unknown {
  if (Array.isArray(x)) {
    const head = x.slice(0, KEEP).map(compact);
    if (x.length <= KEEP) return head;
    return [...head, { "…": x.length - KEEP + " more", sha256: createHash("sha256").update(JSON.stringify(x.slice(KEEP))).digest("hex").slice(0, 16) }];
  }
  if (x && typeof x === "object") {
    const entries = Object.entries(x);
    const head = entries.slice(0, entries.length > KEEP_KEYS ? KEEP : entries.length).map(([k, v]) => [k, compact(v)]);
    if (entries.length > KEEP_KEYS) head.push(["…", { more: entries.length - KEEP, sha256: createHash("sha256").update(JSON.stringify(entries.slice(KEEP))).digest("hex").slice(0, 16) }]);
    return Object.fromEntries(head);
  }
  return x;
}
const json = (x: unknown) => JSON.stringify(compact(x), null, 2) + "\n";

/** the four files of one case */
function render(doc: AnalysisDoc, r: AnalysisResult): Record<string, string> {
  const sql: string[] = [];
  for (const [name, c] of Object.entries(r.cohorts)) sql.push("-- cohort " + name + "\n" + toSnapshotDb(String((c as { sql?: string }).sql ?? "")));
  // a view's independent queries form a set (see this file's header)
  r.views.forEach((v, i) => sql.push(...(v.queries || []).map((q) =>
    "-- view " + i + " " + v.kind + ": " + q.label + " · " + q.study + (q.remote ? " · remote" : "") + "\n" + toSnapshotDb(q.sql)).sort()));
  const views = r.views.map(({ ms: _ms, renderMs: _r, queries: _q, method, ...v }) =>
    ({ ...v, ...(method ? { method: { ...method, python: undefined } } : {}) }));
  const cohorts = Object.fromEntries(Object.entries(r.cohorts).map(([n, c]) => {
    const { sql: _sql, ...rest } = c as { sql?: string };
    return [n, rest];
  }));
  const svg = r.views.map((v, i) => "<!-- view " + i + " " + v.kind + " -->\n" + (viewToSvg(v, { theme: "light" }) ?? "(no figure)")).join("\n") + "\n";
  return {
    sql: sql.join("\n\n") + "\n",
    json: json({ study: r.study, cohorts, splits: r.splits, views }),
    svg,
    txt: analysisText(doc, r).join("\n\n").replace(/ — \d+ms\./, " — (time)ms.") + "\n",
    html: renderViewCards(doc, r),
  };
}

if (UPDATE) mkdirSync(ANSWERS, { recursive: true });

/**
 * Every case's recorded answers, pooled: what the engine asks once per process (which database
 * holds a study, a study's profiles) is recorded by whichever case asked it first, so a case run
 * alone finds it in another case's file.
 */
const POOL: Record<string, string> = {};
if (!RECORD) for (const name of Object.keys(CASES)) {
  const f = join(ANSWERS, name + ".json.gz");
  if (existsSync(f)) Object.assign(POOL, JSON.parse(gunzipSync(readFileSync(f)).toString("utf8")));
}

/**
 * One thread per statement while recording: ClickHouse otherwise adds floats across threads in
 * whatever order they finish, and returns rows of a query without ORDER BY in no fixed order, so
 * a re-recorded case would differ from the last recording where nothing changed.
 */
const RECORD_SETTINGS = "max_threads=1";

/**
 * Delivery in a chosen order: answers that are waiting together are held for a moment, then
 * released in the order their statements were sent ("sent") or the reverse ("reversed"). Two runs
 * in opposite orders give any two concurrent answers opposite arrival orders, so output that depends
 * on which arrived first differs between them, every time.
 */
type Delivery = "sent" | "reversed";
let waiting: (() => void)[] = [];
function arrive(order: Delivery): Promise<void> {
  return new Promise((release) => {
    waiting.push(release);
    if (waiting.length === 1) setTimeout(() => {
      const batch = order === "reversed" ? waiting.reverse() : waiting;
      waiting = [];
      for (const r of batch) r();
    }, 1);
  });
}

/** run the example once: live while recording, else from the pool, delivered in `order` */
async function runCase(ex: (typeof EXAMPLES)[number], recorded: Record<string, string>, order: Delivery | null): Promise<AnalysisResult> {
  setChTransport(async (st, send) => {
    const key = await keyOf(st);
    if (RECORD) return (recorded[key] = toSnapshotDb(steady(await send(RECORD_SETTINGS))));
    if (!(key in POOL)) throw new Error("not recorded (a query changed; RECORD_SNAPSHOTS=1, see this file's header):\n" + toSnapshotDb(st.query).slice(0, 2000));
    if (order) await arrive(order);
    return POOL[key];
  });
  try { return await withRequestCustomData(ex.customData, () => runAnalysis(ex.doc as unknown as AnalysisDoc, { oncoprint: "spec" })); }
  finally { setChTransport(null); }
}

/** One shard's tests, as [name, test] pairs: every `of`-th case from `shard` (1-based), in CASES order. */
export function snapshotCases(shard: number, of: number): [string, () => Promise<void>][] {
  return Object.entries(CASES).filter((_, i) => i % of === shard - 1).map(([kind, title]) => ["snapshot: " + kind, async () => {
    const ex = EXAMPLES.find((e) => e.title === title);
    assert.ok(ex, "no gallery example titled “" + title + "…”");
    const answersFile = join(ANSWERS, kind + ".json.gz");
    const recorded: Record<string, string> = {};
    const result = await runCase(ex, recorded, RECORD ? null : "sent");
    const failed = result.views.filter((v) => v.error && /not recorded/.test(v.error));
    assert.deepEqual(failed.map((v) => v.error), [], "a view asked something the recording never answered");
    if (RECORD) writeFileSync(answersFile, gzipSync(JSON.stringify(Object.fromEntries(Object.entries(recorded).sort())), { level: 9 }));
    const out = render(ex.doc as unknown as AnalysisDoc, result);
    if (!RECORD) {
      const again = render(ex.doc as unknown as AnalysisDoc, await runCase(ex, recorded, "reversed"));
      for (const ext of Object.keys(out))
        assert.equal(again[ext], out[ext], kind + "." + ext + " depends on the order database answers arrive: combine a view's answers " +
          "after they are all in, in a fixed order (askEachSite in lib/views/shared.ts), not as each one lands");
    }
    for (const [ext, text] of Object.entries(out)) {
      const file = join(DIR, kind + "." + ext);
      if (UPDATE) { writeFileSync(file, text); continue; }
      assert.ok(existsSync(file), file + " is missing — RECORD_SNAPSHOTS=1, see this file's header");
      assert.equal(text, readFileSync(file, "utf8"), kind + "." + ext + " changed — review the diff; if intended, UPDATE_SNAPSHOTS=1 npm test");
    }
  }]);
}

/** That CASES covers every view kind, each case name once; the first shard runs it. */
export function everyKindHasACase(): void {
  const names = EXAMPLES.flatMap((e) => e.snapshot ? [e.snapshot] : []);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), [], "a snapshot case name is used by two examples");
  assert.deepEqual(viewKinds().filter((k) => k !== "oncoprint" && !(k in CASES)), [],
    "mark each one's smallest gallery example `snapshot: \"<kind>\"` (its lib/views/<kind>/doc.ts), then RECORD_SNAPSHOTS=1");
}
