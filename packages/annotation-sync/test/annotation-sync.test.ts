// The offline annotation sync (@cbiolab/annotation-sync): a source's keys are diffed against its store
// for the release, resolved in batches against the service, appended pinned to that release, and
// every run is logged in the shared annotation.sync_run. ClickHouse is @cbiolab/clickhouse/testing; OncoKB is a
// stubbed fetch, so nothing leaves the machine.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeCh, type FakeCh } from "@cbiolab/clickhouse/testing";
import { MAX_CONSECUTIVE_FAILURES, pendingKeys, syncKeys, syncStudies, warehouseStudies, ensureStore } from "../src/sync.ts";
import { oncokbSource } from "../src/sources/oncokb.ts";
import { annotationSource, annotationStoreDdl, missingNeeds, syncConn } from "../src/index.ts";

const realFetch = globalThis.fetch;
let ch: FakeCh | null = null;
afterEach(() => { ch?.restore(); ch = null; globalThis.fetch = realFetch; });

const src = { ...oncokbSource, batchSize: 2, batchDelayMs: 0 };
const RELEASE = { version: "v9.9", extra: { api_version: "v1.5" } };

interface Asked { path: string; body: unknown }
/** OncoKB stand-in: answers each annotate request with one annotation per item; `fail` makes every request 400 */
function oncokb(opts: { fail?: boolean; info?: unknown; oncogenic?: (alt: string) => string } = {}): Asked[] {
  const asked: Asked[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace("https://www.oncokb.org/api/v1", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    asked.push({ path, body });
    if (opts.fail) return new Response("bad token", { status: 400 });
    if (path === "/info") return Response.json(opts.info ?? { dataVersion: { version: "v9.9" }, apiVersion: { version: "v1.5" } });
    const items = body as { alteration?: string; copyNameAlterationType?: string }[];
    return Response.json(items.map((x) => ({ oncogenic: opts.oncogenic?.(x.alteration ?? x.copyNameAlterationType ?? "") ?? "Oncogenic",
      mutationEffect: { knownEffect: "Gain-of-function" }, highestSensitiveLevel: "LEVEL_1", highestResistanceLevel: "" })));
  }) as typeof fetch;
  return asked;
}

/** the fake warehouse: `total` keys in the study's space, of which `todo` are not yet stored */
function warehouse(total: number, todo: Record<string, string>[]): FakeCh {
  const c = fakeCh();
  c.answer(/^SELECT uniqExact\(alteration_type, hugo_gene_symbol, alteration\) AS n FROM \(SELECT DISTINCT/, [{ n: total }]);
  c.answer(/^SELECT uniqExact\(.*LEFT ANTI JOIN/s, [{ n: todo.length }]);
  c.answer(/LEFT ANTI JOIN/, todo);
  c.answer(/SELECT DISTINCT cancer_study_identifier AS s FROM genomic_event_derived/, [{ s: "a_study" }, { s: "b_study" }]);
  return c;
}

const KEYS = [
  { alteration_type: "CNA", hugo_gene_symbol: "ERBB2", alteration: "AMPLIFICATION" },
  { alteration_type: "MUTATION", hugo_gene_symbol: "KRAS", alteration: "G12D" },
  { alteration_type: "MUTATION", hugo_gene_symbol: "TP53", alteration: "R175H" }
];

test("only the keys the store lacks for the release are asked for, in batches, and stored pinned to it", async () => {
  const asked = oncokb();
  ch = warehouse(5, KEYS);
  const r = await syncKeys(ch.conn, src, RELEASE, "a_study", () => {});
  assert.deepEqual(r, { total: 5, alreadyStored: 2, done: 3, failed: 0, aborted: false });

  // the diff runs in ClickHouse, against this release, inside this study's key space
  const diff = ch.statements.find((s) => /LEFT ANTI JOIN/.test(s) && !/uniqExact/.test(s))!;
  assert.match(diff, /cancer_study_identifier = 'a_study'/);
  assert.match(diff, /WHERE oncokb_version = 'v9\.9' AND \(toString\(alteration_type\), toString\(hugo_gene_symbol\), toString\(alteration\)\) IN/);
  assert.match(diff, /USING \(alteration_type, hugo_gene_symbol, alteration\)/);

  // two batches of at most two keys; within one, mutations and copy-number calls go to their own endpoints
  assert.deepEqual(asked.map((a) => a.path), ["/annotate/mutations/byProteinChange", "/annotate/copyNumberAlterations", "/annotate/mutations/byProteinChange"]);
  assert.deepEqual(asked[0].body, [{ gene: { hugoSymbol: "KRAS" }, alteration: "G12D" }]);
  assert.deepEqual(asked[1].body, [{ gene: { hugoSymbol: "ERBB2" }, copyNameAlterationType: "AMPLIFICATION" }]);

  const rows = ch.rows("oncokb");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.find((x) => x.alteration === "R175H"), { oncokb_version: "v9.9", alteration_type: "MUTATION", hugo_gene_symbol: "TP53",
    alteration: "R175H", oncogenicity: "Oncogenic", mutation_effect: "Gain-of-function", highest_sensitive_level: "LEVEL_1",
    highest_resistance_level: "", api_version: "v1.5" });

  const [run] = ch.rows("sync_run");
  assert.deepEqual([run.source, run.version, run.study], ["oncokb", "v9.9", "a_study"]);
  assert.deepEqual([run.variants_total, run.already_stored, run.annotated_new, run.failed, run.note], [5, 2, 3, 0, "complete"]);
});

test("a study with nothing left to annotate asks the service nothing, and still records the run", async () => {
  const asked = oncokb();
  ch = warehouse(4, []);
  const r = await syncKeys(ch.conn, src, RELEASE, "a_study", () => {});
  assert.deepEqual(r, { total: 4, alreadyStored: 4, done: 0, failed: 0, aborted: false });
  assert.equal(asked.length, 0);
  assert.equal(ch.rows("oncokb").length, 0);
  assert.equal(ch.rows("sync_run")[0].note, "complete");
});

test("a failing batch is counted and the run goes on; a sustained failure stops it, saying how to resume", async () => {
  oncokb({ fail: true });
  const many = Array.from({ length: 2 * (MAX_CONSECUTIVE_FAILURES + 3) }, (_, i) => ({ alteration_type: "MUTATION", hugo_gene_symbol: "TP53", alteration: "X" + i }));
  ch = warehouse(many.length, many);
  const logs: string[] = [];
  const r = await syncKeys(ch.conn, src, RELEASE, "a_study", (m) => logs.push(m));
  assert.equal(r.aborted, true);
  assert.equal(r.failed, 2 * MAX_CONSECUTIVE_FAILURES, "stopped after the tenth failed batch in a row");
  assert.equal(r.done, 0);
  assert.ok(logs.some((l) => /batch at 0 failed: OncoKB \/annotate\/mutations\/byProteinChange -> 400: bad token/.test(l)));
  assert.match(String(ch.rows("sync_run")[0].note), /^aborted after 10 consecutive batch failures — re-run to resume$/);
});

test("--all syncs each study, then records how much of the portal's key space is stored", async () => {
  oncokb();
  ch = warehouse(3, KEYS.slice(0, 1));
  const studies = await warehouseStudies(ch.conn);
  assert.deepEqual(studies, ["a_study", "b_study"]);
  const r = await syncStudies(ch.conn, src, RELEASE, studies, () => {});
  assert.equal(r.done, 2);
  const runs = ch.rows("sync_run");
  assert.deepEqual(runs.map((x) => x.study), ["a_study", "b_study", "__portal__"]);
  // the stand-in still says one key is missing, as a store would if a study's run had failed
  assert.deepEqual([runs[2].variants_total, runs[2].already_stored, runs[2].note], [3, 2, "incomplete: 1 keys still missing"]);
  assert.equal(r.missing, 1);
  // the portal-wide check counts what is missing; it never fetches the keys themselves
  const portalWide = ch.statements.filter((s) => /LEFT ANTI JOIN/.test(s) && !/cancer_study_identifier =/.test(s));
  assert.ok(portalWide.length && portalWide.every((s) => s.startsWith("SELECT uniqExact(")));
});

test("pendingKeys compares Strings, so the store's Enum key matches the warehouse's text", async () => {
  ch = warehouse(1, [KEYS[0]]);
  const p = await pendingKeys(ch.conn, src, "v9.9", src.keySpace("cbio", "a_study"));
  assert.deepEqual(p, { total: 1, todo: [KEYS[0]] });
  assert.match(ch.statements.at(-1)!, /SELECT toString\(alteration_type\) AS alteration_type/);
});

test("OncoKB's release is its data version, with the API version alongside; no version is refused, not stored as 'unknown'", async () => {
  oncokb();
  assert.deepEqual(await oncokbSource.release(), { version: "v9.9", extra: { api_version: "v1.5" } });
  oncokb({ info: { dataVersion: "v4.2", apiVersion: "v1.0" } });
  assert.deepEqual(await oncokbSource.release(), { version: "v4.2", extra: { api_version: "v1.0" } });
  oncokb({ info: {} });
  await assert.rejects(oncokbSource.release(), /named no data version/);
});

test("OncoKB's key space: a study's mutations by protein change and its high-level copy-number calls", () => {
  const one = oncokbSource.keySpace("cbio", "s'1");
  assert.match(one, /FROM cbio\.genomic_event_derived WHERE cancer_study_identifier = 's\\'1' AND variant_type = 'mutation' AND mutation_variant != ''/);
  assert.match(one, /if\(cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'\) AS alteration .* abs\(cna_alteration\) >= 2/s);
  assert.doesNotMatch(oncokbSource.keySpace("cbio", null), /cancer_study_identifier =/);
});

test("verify re-asks the service for sampled stored keys and lists every disagreement", async () => {
  oncokb({ oncogenic: (alt) => alt === "R175H" ? "Likely Neutral" : "Oncogenic" });
  ch = fakeCh();
  ch.answer(/ORDER BY rand\(\) LIMIT 50/, [
    { gene: "KRAS", alteration: "G12D", oncogenicity: "Oncogenic", mutation_effect: "Gain-of-function" },
    { gene: "TP53", alteration: "R175H", oncogenicity: "Oncogenic", mutation_effect: "Gain-of-function" }]);
  const r = await oncokbSource.verify!(ch.conn, "v9.9", 50);
  assert.equal(r.checked, 2);
  assert.deepEqual(r.mismatches, ["TP53 R175H: stored Oncogenic/Gain-of-function, live Likely Neutral/Gain-of-function"]);
  assert.match(ch.statements[0], /WHERE oncokb_version = 'v9\.9' AND alteration_type = 'MUTATION'/);
});

test("the store is created by its own statements, idempotently", async () => {
  ch = fakeCh();
  await ensureStore(ch.conn, oncokbSource);
  assert.deepEqual(ch.statements, annotationStoreDdl(), "the database, the shared log and OncoKB's table");
  assert.deepEqual(ch.statements.map((s) => /^CREATE (DATABASE|TABLE) IF NOT EXISTS (\S+)/.exec(s)?.[2]),
    ["annotation", "annotation.sync_run", "annotation.oncokb"]);
});

test("a sync writes as the source's own writer, or as the local instance; never silently as the app", () => {
  const local = syncConn(oncokbSource, { CBIOLAB_LOCAL: "1", CLICKHOUSE_URL: "http://127.0.0.1:8123", CLICKHOUSE_USER: "default", CLICKHOUSE_PASSWORD: "x", CLICKHOUSE_DB: "cbio" });
  assert.deepEqual({ user: local.user, db: local.db, url: local.url }, { user: "default", db: "cbio", url: "http://127.0.0.1:8123" }, "local mode: the instance's own user");
  assert.throws(() => syncConn(oncokbSource, { CLICKHOUSE_URL: "https://ch" }), /a OncoKB sync \(docs\/ANNOTATION\.md\) needs CLICKHOUSE_DB, ONCOKB_WRITER_PASSWORD/);
  const c = syncConn(oncokbSource, { CLICKHOUSE_URL: "https://ch", CLICKHOUSE_DB: "cbio-db", ONCOKB_WRITER_PASSWORD: "pw" });
  assert.deepEqual({ user: c.user, db: c.db, url: c.url }, { user: "oncokb_writer", db: "cbiodb", url: "https://ch" });
  assert.equal(syncConn(oncokbSource, { CLICKHOUSE_URL: "u", CLICKHOUSE_DB: "d", ONCOKB_WRITER_PASSWORD: "p", ONCOKB_WRITER_USER: "w2" }).user, "w2");
  assert.equal(missingNeeds(oncokbSource, {}), "a OncoKB sync needs ONCOKB_TOKEN");
  assert.equal(missingNeeds(oncokbSource, { ONCOKB_TOKEN: "t" }), null);
});

test("an unknown source is refused, naming the ones there are", () => {
  assert.equal(annotationSource("oncokb"), oncokbSource);
  assert.throws(() => annotationSource("civic"), /no annotation source 'civic' \(sources: oncokb\)/);
});
