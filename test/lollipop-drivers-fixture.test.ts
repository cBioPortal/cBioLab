// The lollipop's driver reads, run on the fixture study (test/fixtures/peer-study on connection b),
// against oracles written here from the fixture's own tables:
//   L1  hotspotKeysSql(db, [study], genes, pins) gives exactly the (gene, alteration, mutation type)
//       keys of the study's mutations that are Cancer Hotspots — a mutation of a gene on the hotspot
//       gene list whose variant's stored Genome Nexus record holds a hotspot of its kind (a splice
//       mutation a splice-site hotspot; any other a single-residue or in-frame-indel one; 3D never;
//       no record, or an empty variant allele, none). Also with a second study id that does not exist.
//   L2  the lollipop's driver flags (PatientLevelResolver.lollipopCounts at an OncoKB pin the fixture
//       stores) equal: a change is a driver iff its (gene, protein change) is an is_driver MUTATION call
//       at the pin, or one of its mutations is a hotspot key — for several genes together and each
//       alone (a gene's flags do not change with the other genes asked).
//
// Runs when CLICKHOUSE2_* point at the fixture (`npm run peer-db` prints the lines) and is skipped otherwise.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import type { ChConn } from "../lib/ch.ts";

const FIXTURE = "cbiolab_peer_fixture";
/** peer-db.ts stores the fixture's Genome Nexus records and its OncoKB calls under this release */
const PIN = "fixture";
process.env.GENOME_NEXUS_PIN = PIN;
process.env.GENOME_NEXUS_GRCH38_PIN = PIN;
delete process.env.CH_RUN_CACHE;
const { secondary, chQuery } = await import("../lib/ch.ts");
const { hotspotKeysSql, HOTSPOT_GENES } = await import("../lib/hotspots.ts");
const { PatientLevelResolver } = await import("../lib/federation.ts");

const noDb = process.env.CLICKHOUSE2_LABEL === "fixture peer" ? false : "needs the fixture study on connection b: CLICKHOUSE2_* from `npm run peer-db`";
let conn: ChConn;
const run = async <T = Record<string, unknown>>(sql: string) => (await chQuery<T>(sql, conn)).data;

type Mut = { gene: string; pc: string; t: string; chr: string; start: number; end: number; ref: string; alt: string };
let muts: Mut[] = [];
/** the oracle's hotspot keys, "gene|alteration|type" */
let oracleKeys: string[] = [];
/** OncoKB's driver calls at the pin, "gene|alteration" */
let oncokbDrivers = new Set<string>();

const key = (gene: string, pc: string, t: string) => gene + "|" + pc + "|" + t;
/** the hotspot rule, written from lib/hotspots.ts' header and check-hotspot-drivers' case table */
function hotspotOracle(gene: string, type: string, hotspots: { type?: string }[]): boolean {
  if (!HOTSPOT_GENES.has(gene)) return false;
  const kinds = hotspots.map((h) => String(h.type ?? "").toLowerCase());
  if (type.toLowerCase().includes("splice")) return kinds.some((k) => k.includes("splice"));
  return kinds.some((k) => k.includes("single residue") || k.includes("in-frame indel") || k.includes("indel"));
}

before(async () => {
  if (noDb) return;
  conn = secondary()!;
  assert.ok(conn, "CLICKHOUSE2_URL is set but connection b is not configured");
  const db = conn.db;
  muts = (await run<Mut>(
    "SELECT g.hugo_gene_symbol AS gene, ifNull(me.protein_change, '') AS pc, ifNull(me.mutation_type, '') AS t, ifNull(me.chr, '') AS chr,\n" +
    "  ifNull(me.start_position, 0) AS start, ifNull(me.end_position, 0) AS end, ifNull(me.reference_allele, '') AS ref, ifNull(me.tumor_seq_allele, '') AS alt\n" +
    "FROM " + db + ".mutation m JOIN " + db + ".mutation_event me ON me.mutation_event_id = m.mutation_event_id\n" +
    "JOIN " + db + ".gene g ON g.entrez_gene_id = me.entrez_gene_id\n" +
    "JOIN " + db + ".genetic_profile gp ON gp.genetic_profile_id = m.genetic_profile_id\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id\n" +
    "WHERE cs.cancer_study_identifier = '" + FIXTURE + "'")).map((m) => ({ ...m, start: Number(m.start), end: Number(m.end) }));
  const records = await run<{ chr: string; start: number; end: number; ref: string; alt: string; data: string }>(
    "SELECT chr, start_position AS start, end_position AS end, reference_allele AS ref, variant_allele AS alt, data FROM annotation.variant WHERE source = 'genome_nexus' AND version = '" + PIN + "'");
  const loc = (chr: string, start: number, end: number, ref: string, alt: string) => [chr.replace(/^chr/i, ""), Number(start), Number(end), ref, alt].join(":");
  const byLoc = new Map(records.map((r) => [loc(r.chr, r.start, r.end, r.ref, r.alt), (JSON.parse(r.data).hotspots ?? []) as { type?: string }[]]));
  const keys = new Set<string>();
  for (const m of muts) {
    if (!m.alt) continue;
    const hs = byLoc.get(loc(m.chr, m.start, m.end, m.ref, m.alt));
    if (hs && hotspotOracle(m.gene, m.t, hs)) keys.add(key(m.gene, m.pc, m.t));
  }
  oracleKeys = [...keys].sort();
  oncokbDrivers = new Set((await run<{ g: string; a: string }>(
    "SELECT hugo_gene_symbol AS g, alteration AS a FROM annotation.oncokb WHERE oncokb_version = '" + PIN + "' AND alteration_type = 'MUTATION' AND is_driver")).map((r) => r.g + "|" + r.a));
});

const keysOf = async (studies: string[], genes: string[] | null) => {
  const sql = hotspotKeysSql(conn.db, studies, genes, { hg19: PIN, hg38: null });
  assert.ok(sql, "SQL with the GRCh37 pin set");
  return (await run(sql)).map((r) => Object.values(r).map((v) => String(v ?? "")).join("|")).sort();
};

describe("L1 hotspotKeysSql on the fixture", () => {
  test("the oracle finds the fixture's hotspot cases (the comparison says something)", { skip: noDb }, () => {
    assert.ok(muts.length > 50, muts.length + " mutations");
    for (const k of ["PIK3CA|H1047R|Missense_Mutation", "STK11|X200_splice|Splice_Site", "PTEN|R130G|Missense_Mutation"]) assert.ok(oracleKeys.includes(k), k + " in " + oracleKeys.join(", "));
    for (const k of ["H3-3A|G35R|Missense_Mutation", "ATM|A1100S|Missense_Mutation", "BRAF|G469A|Missense_Mutation", "SMARCA4|X500_splice|Splice_Site"]) assert.ok(!oracleKeys.includes(k), k);
  });

  test("every gene: exactly the oracle's keys, each once", { skip: noDb }, async () => {
    const got = await keysOf([FIXTURE], null);
    assert.deepEqual(got, oracleKeys);
    assert.equal(new Set(got).size, got.length);
  });

  test("with a second study id that does not exist: the same keys", { skip: noDb }, async () => {
    assert.deepEqual(await keysOf([FIXTURE, "no_such_study"], null), oracleKeys);
    assert.deepEqual(await keysOf(["no_such_study", FIXTURE], null), oracleKeys);
  });

  for (const genes of [["PIK3CA"], ["KRAS", "TP53", "EGFR"], ["BRAF", "STK11", "ATM"], ["KRAS", "TP53", "EGFR", "BRAF", "PIK3CA", "PTEN"]]) {
    test("genes " + genes.join(", ") + ": the oracle's keys of those genes", { skip: noDb }, async () => {
      const want = oracleKeys.filter((k) => genes.includes(k.split("|")[0]));
      assert.deepEqual(await keysOf([FIXTURE], genes), want);
      assert.deepEqual(await keysOf([FIXTURE, "no_such_study"], genes), want);
    });
  }
});

describe("L2 the lollipop's driver flags on the fixture", () => {
  const GENES = ["KRAS", "TP53", "EGFR", "BRAF", "PIK3CA"];
  const resolver = () => new PatientLevelResolver(FIXTURE, { oncokbPin: PIN }, { id: "b-lollipop", mode: "patient-level", label: "fixture", conn: { ...conn, id: "b-lollipop" } } as never);
  /** a change is a driver iff OncoKB calls it one at the pin or one of its mutations is a hotspot */
  const expected = (gene: string, change: string) =>
    oncokbDrivers.has(gene + "|" + change) || muts.some((m) => m.gene === gene && m.pc === change && oracleKeys.includes(key(m.gene, m.pc, m.t)));
  const flags = async (genes: string[]) => {
    const rep = await resolver().lollipopCounts(null, genes, 1);
    assert.equal(rep.annotated, true, "annotated at the pin");
    return new Map(rep.changes.map((c) => [c.gene + "|" + c.change, c.driver]));
  };
  let together = new Map<string, boolean>();

  test(GENES.join(", ") + " together: every change's flag is the oracle's", { skip: noDb }, async () => {
    together = await flags(GENES);
    assert.ok(together.size > 10, together.size + " changes");
    const wrong = [...together].filter(([k, d]) => d !== expected(k.split("|")[0], k.split("|").slice(1).join("|")));
    assert.deepEqual(wrong, [], "flags that differ from the oracle");
    assert.ok([...together.values()].some((d) => d) && [...together.values()].some((d) => !d), "both kinds occur");
    const hotOnly = [...together.keys()].filter((k) => { const [g, ...c] = k.split("|"); return !oncokbDrivers.has(k) && expected(g, c.join("|")); });
    assert.ok(hotOnly.length >= 1, "a change that is a driver by hotspot alone: " + hotOnly.join(", "));
  });

  for (const gene of GENES) {
    test(gene + " alone: the same flags as with the others, and the oracle's", { skip: noDb }, async () => {
      if (!together.size) together = await flags(GENES);
      const alone = await flags([gene]);
      const mine = new Map([...together].filter(([k]) => k.startsWith(gene + "|")));
      assert.deepEqual(new Map([...alone].sort()), new Map([...mine].sort()));
      for (const [k, d] of alone) assert.equal(d, expected(gene, k.slice(gene.length + 1)), k);
      if (["KRAS", "TP53", "EGFR"].includes(gene)) assert.ok(alone.size > 0, gene + " has mutations in the fixture");
    });
  }
});
