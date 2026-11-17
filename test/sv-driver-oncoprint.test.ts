// A structural variant's driver call in the oncoprint's in-memory index (spec rows K1-K7) and the
// SQL condition's database and studies (O14). The portal calls an SV a driver by its pair's OncoKB
// answer with no tumour type (ResultsViewPageStore.ts 5468-5562, StoreUtils.ts 2014-2031,
// cbioportal-frontend cd8c6df); the index reads that call as a set of driver SV keys and falls back
// to the gene-level Fusion row only for an SV that carries no key. The warehouse is a stand-in
// (setChTransport) that records each statement and answers by the statement's text.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "cbio_a";
process.env.CLICKHOUSE_USER = "u";
process.env.CLICKHOUSE_PASSWORD = "p";
for (const k of ["CLICKHOUSE2_URL", "FEDERATION_PEERS", "CH_RUN_CACHE"]) delete process.env[k];
process.env.ONCOKB_PIN = "v7.5";

const { setChTransport, PRIMARY } = await import("../lib/ch.ts");
type ChConn = import("../lib/ch.ts").ChConn;
const { buildAnnotationIndex, MOCK_SOURCE } = await import("../lib/annotation.ts");
const { driverEventSql } = await import("../lib/oql.ts");

const STUDY = "luad_tcga_pan_can_atlas_2018";
/** the gene-level rows at the pin: ALK, ERG Fusion drivers; TTN Fusion not one; a mutation and two copy-number drivers */
const GENE_LEVEL = [
  { t: "SV", gene: "ALK", alteration: "Fusion", is_driver: 1 },
  { t: "SV", gene: "ERG", alteration: "Fusion", is_driver: 1 },
  { t: "SV", gene: "TTN", alteration: "Fusion", is_driver: 0 },
  { t: "MUTATION", gene: "KRAS", alteration: "G12C", is_driver: 1 },
  { t: "CNA", gene: "CDKN2A", alteration: "DELETION", is_driver: 1 },
  { t: "CNA", gene: "EGFR", alteration: "AMPLIFICATION", is_driver: 1 }
];
/** the keys of driver SVs the pair-call lookup answers with */
const DRIVER_KEYS = [{ k: "SV-KEY-DRIVER" }];

let sent: string[] = [];
/** each statement with the id of the connection it was sent on */
let sentOn: { query: string; conn: string }[] = [];
/** a test's own answer for a statement, ahead of the defaults; undefined falls through to them */
let answer: ((query: string, conn: ChConn) => Record<string, unknown>[] | undefined) | null = null;
const keyReads = () => sent.filter((q) => /annotation\.oncokb_sv/.test(q));
setChTransport(async ({ query, conn }) => {
  sent.push(query);
  sentOn.push({ query, conn: conn.id });
  const own = answer?.(query, conn);
  if (own) return JSON.stringify({ meta: [], data: own, rows: own.length });
  const data: Record<string, unknown>[] = /annotation\.oncokb_sv/.test(query) ? DRIVER_KEYS
    : /annotation\.oncokb\b/.test(query) && /alteration_type AS t/.test(query) ? GENE_LEVEL
      : /sync_run/.test(query) ? [{ study: STUDY }]
        : [];
  return JSON.stringify({ meta: [], data, rows: data.length });
});
after(() => setChTransport(null));
beforeEach(() => { sent = []; sentOn = []; answer = null; });

const GENES = ["ALK", "EML4", "ERG", "TMPRSS2", "TTN", "KRAS", "TP53", "CDKN2A", "EGFR"];

describe("the oncoprint's driver index on structural variants", () => {
  test("K1 an SV event whose key the pair-call lookup returns is a driver", async () => {
    const ev = { vt: "structural_variant", gene: "EML4", svk: "SV-KEY-DRIVER" };
    const ix = await buildAnnotationIndex([ev], GENES, STUDY);
    assert.notEqual(ix.source, MOCK_SOURCE);
    assert.equal(ix.isDriver(ev), true);
    assert.ok(keyReads().length >= 1, "the pair-call lookup is asked");
  });
  test("K2 an SV event whose key the lookup does not return is not a driver, even with a gene-level Fusion driver row", async () => {
    const ev = { vt: "structural_variant", gene: "ALK", svk: "SV-KEY-NOT-RETURNED" };
    const ix = await buildAnnotationIndex([ev, { vt: "structural_variant", gene: "EML4", svk: "SV-KEY-DRIVER" }], GENES, STUDY);
    assert.notEqual(ix.source, MOCK_SOURCE);
    assert.equal(ix.isDriver(ev), false);
  });
  test("K3 an SV event with no key takes its gene's gene-level Fusion row", async () => {
    const erg = { vt: "structural_variant", gene: "ERG" };
    const ttn = { vt: "structural_variant", gene: "TTN" };
    const tmprss2 = { vt: "structural_variant", gene: "TMPRSS2" };
    const ix = await buildAnnotationIndex([erg, ttn, tmprss2, { vt: "structural_variant", gene: "ALK", svk: "SV-KEY-DRIVER" }], GENES, STUDY);
    assert.notEqual(ix.source, MOCK_SOURCE);
    assert.equal(ix.isDriver(erg), true, "ERG's Fusion row is a driver");
    assert.equal(ix.isDriver(ttn), false, "TTN's Fusion row is not a driver");
    assert.equal(ix.isDriver(tmprss2), false, "TMPRSS2 has no Fusion row");
  });
  test("K3 with no SV key anywhere, a keyless SV event still takes its gene-level row", async () => {
    const erg = { vt: "structural_variant", gene: "ERG" };
    const ix = await buildAnnotationIndex([erg], GENES, STUDY);
    assert.equal(ix.isDriver(erg), true);
  });
  test("K4 when no SV event carries a key the pair-call lookup is not queried", async () => {
    await buildAnnotationIndex([
      { vt: "structural_variant", gene: "ALK" },
      { vt: "mutation", gene: "KRAS", mv: "G12C", mt: "Missense_Mutation" },
      { vt: "cna", gene: "CDKN2A", cna: -2 }
    ], GENES, STUDY);
    assert.ok(sent.some((q) => /alteration_type AS t/.test(q)), "the gene-level rows are read");
    assert.equal(keyReads().length, 0, "no statement reads annotation.oncokb_sv:\n" + keyReads().join("\n---\n"));
  });
  test("K4 an empty event list queries no pair calls", async () => {
    await buildAnnotationIndex([], GENES, STUDY);
    assert.equal(keyReads().length, 0);
  });
  test("K5 mutation and copy-number events keep their gene-level calls", async () => {
    const evs = {
      krasG12C: { vt: "mutation", gene: "KRAS", mv: "G12C", mt: "Missense_Mutation" },
      krasG13C: { vt: "mutation", gene: "KRAS", mv: "G13C", mt: "Missense_Mutation" },
      tp53: { vt: "mutation", gene: "TP53", mv: "R213*", mt: "Nonsense_Mutation" },
      cdkn2aDel: { vt: "cna", gene: "CDKN2A", cna: -2 },
      egfrAmp: { vt: "cna", gene: "EGFR", cna: 2 },
      cdkn2aAmp: { vt: "cna", gene: "CDKN2A", cna: 2 }
    };
    for (const withKey of [false, true]) {
      const rows = [...Object.values(evs), ...(withKey ? [{ vt: "structural_variant", gene: "ALK", svk: "SV-KEY-DRIVER" }] : [])];
      const ix = await buildAnnotationIndex(rows, GENES, STUDY);
      const tag = withKey ? " (with a keyed SV in the list)" : "";
      assert.notEqual(ix.source, MOCK_SOURCE);
      assert.equal(ix.isDriver(evs.krasG12C), true, "KRAS G12C" + tag);
      assert.equal(ix.isDriver(evs.krasG13C), false, "KRAS G13C, no store row" + tag);
      assert.equal(ix.isDriver(evs.tp53), false, "TP53 R213*, no store row" + tag);
      assert.equal(ix.isDriver(evs.cdkn2aDel), true, "CDKN2A deep deletion" + tag);
      assert.equal(ix.isDriver(evs.egfrAmp), true, "EGFR amplification" + tag);
      assert.equal(ix.isDriver(evs.cdkn2aAmp), false, "CDKN2A amplification, no store row" + tag);
    }
  });
});

describe("the pair-call lookup per connection (K6) and when it fails (K7)", () => {
  const OTHER: ChConn = { id: "peer-k6", url: "http://other.invalid", user: "u", password: "p", db: "cbio_b", label: "other" };
  const connOf = (s: string) => (s === "s2" ? OTHER : PRIMARY);
  test("K6 each study's pair lookup is sent on its own connection, in that connection's database, naming only that study", async () => {
    answer = (q, c) => (/annotation\.oncokb_sv/.test(q) && c.id === OTHER.id ? [{ k: "SV-KEY-S2" }] : undefined);
    const s1 = { vt: "structural_variant", gene: "EML4", svk: "SV-KEY-S1" };
    const s2 = { vt: "structural_variant", gene: "ALK", svk: "SV-KEY-S2" };
    const ix = await buildAnnotationIndex([s1, s2], GENES, ["s1", "s2"], connOf);
    assert.notEqual(ix.source, MOCK_SOURCE);
    const reads = sentOn.filter((x) => /annotation\.oncokb_sv/.test(x.query));
    const onPrimary = reads.filter((x) => x.conn === PRIMARY.id), onOther = reads.filter((x) => x.conn === OTHER.id);
    assert.equal(onPrimary.length, 1, "one lookup on the primary: " + JSON.stringify(reads.map((x) => x.conn)));
    assert.equal(onOther.length, 1, "one lookup on the other connection: " + JSON.stringify(reads.map((x) => x.conn)));
    assert.match(onPrimary[0].query, new RegExp("\\b" + PRIMARY.db + "\\.structural_variant\\b"));
    assert.ok(onPrimary[0].query.includes("'s1'") && !onPrimary[0].query.includes("'s2'"), onPrimary[0].query);
    assert.match(onOther[0].query, /\bcbio_b\.structural_variant\b/);
    assert.doesNotMatch(onOther[0].query, new RegExp("\\b" + PRIMARY.db + "\\.structural_variant\\b"));
    assert.ok(onOther[0].query.includes("'s2'") && !onOther[0].query.includes("'s1'"), onOther[0].query);
    assert.equal(ix.isDriver(s2), true, "s2's key, returned by its own connection's lookup, is a driver");
    assert.equal(ix.isDriver(s1), false, "s1's key is not returned by the primary");
  });
  test("K7 a failed pair lookup leaves the index on OncoKB: mutations keep their calls, keyed SVs take their gene-level Fusion row", async () => {
    answer = (q) => { if (/annotation\.oncokb_sv/.test(q)) throw new Error("ClickHouse error [a]: HTTP 500"); return undefined; };
    const kras = { vt: "mutation", gene: "KRAS", mv: "G12C", mt: "Missense_Mutation" };
    const alk = { vt: "structural_variant", gene: "ALK", svk: "SV-KEY-DRIVER" };
    const ttn = { vt: "structural_variant", gene: "TTN", svk: "SV-KEY-TTN" };
    const ix = await buildAnnotationIndex([kras, alk, ttn], GENES, STUDY);
    assert.ok(keyReads().length >= 1, "the pair lookup was asked");
    assert.notEqual(ix.source, MOCK_SOURCE);
    assert.ok(ix.source.startsWith("OncoKB"), ix.source);
    assert.equal(ix.isDriver(kras), true, "KRAS G12C keeps its gene-level driver row");
    assert.equal(ix.isDriver(alk), true, "ALK's gene-level Fusion row is a driver");
    assert.equal(ix.isDriver(ttn), false, "TTN's gene-level Fusion row is not a driver");
  });
});

describe("the SQL driver condition's structural-variant lookup", () => {
  test("O14 the studies reach the SQL as quoted literals, and the database by name", () => {
    const sql = driverEventSql("v7.5", "g", { db: "cbio_peer", studies: ["study_one", "study_two"] });
    assert.ok(sql.includes("'study_one'") && sql.includes("'study_two'"), sql);
    assert.match(sql, /\bcbio_peer\.structural_variant\b/);
    assert.doesNotMatch(sql, /\bcbio_a\.structural_variant\b/, "not the default database");
  });
  test("O14 a study name with a quote is escaped", () => {
    const sql = driverEventSql("v7.5", "", { db: "cbio_a", studies: ["o'neil_2024"] });
    assert.ok(sql.includes("'o\\'neil_2024'"), sql);
    assert.ok(!sql.includes("'o'neil_2024'"), "an unescaped quote ends the literal early");
  });
  test("O14 only the named studies reach the SQL", () => {
    const sql = driverEventSql("v7.5", "", { db: "cbio_a", studies: ["study_one"] });
    assert.ok(sql.includes("'study_one'"));
    assert.ok(!sql.includes("study_two"));
  });
});
