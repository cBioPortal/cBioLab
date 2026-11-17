/**
 * Live check: OncoKB's cancer gene list, as SQL run against the fixture database on connection b —
 * the sync's key space (packages/annotation-sync/src/sources/oncokb-cancer-gene.ts keySpace: every
 * gene of the portal's gene table with a positive Entrez id, as a String) and the app's two reads
 * (lib/annotation-store.ts oncokbCancerGeneSql, oncokbCancerGenesStoredSql). The portal's rule is
 * react-mutation-mapper Annotation.tsx 170-187: a gene is an OncoKB cancer gene when the list has its
 * Entrez id (isOncoKbCancerGene). Row ids are the case table's (C7, C8).
 *
 * The reads are checked on rows this script stores in annotation.oncokb_cancer_gene under a scratch
 * version of its own, and deletes again: a listed gene (KRAS), a listed gene OncoKB does not curate
 * (KIF5B: a cancer gene all the same, oncokbAnnotated is kept apart), an unlisted one (TTN), and a gene
 * (TP53) stored listed and then, later, not listed, which the read must take at its latest (FINAL).
 * The table is created by `npm run peer-db` (its store DDL is annotationStoreDdl()). It writes only to
 * connection b, and refuses unless that is a database on this machine.
 *
 * Run: node --env-file=.env.local scripts/check-oncokb-cancer-gene.ts (connection b must be the
 * fixture: `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { exec, insertRows, type Conn } from "@cbiolab/clickhouse";
import { chQuery, connById, PRIMARY } from "../lib/ch.ts";
import { ONCOKB_CANCER_GENE_TABLE, oncokbCancerGeneSql, oncokbCancerGenesStoredSql } from "../lib/annotation-store.ts";
import { oncokbCancerGeneSource } from "../packages/annotation-sync/src/sources/oncokb-cancer-gene.ts";

let failures = 0, checks = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  checks++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

const conn = connById("b");
if (!conn) { console.log("FAIL connection b is not configured (npm run peer-db prints its CLICKHOUSE2_* lines)"); process.exit(1); }
const host = new URL(conn.url).hostname;
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host) || conn.url === PRIMARY.url) {
  console.log("FAIL connection b is not a database on this machine; this check writes to it, so it stops here");
  process.exit(1);
}

// ---- C8: the key space ------------------------------------------------------------------------

type Key = { entrez_gene_id: unknown };
/** a key space's rows, or none when its SQL fails (which is said) */
const keySpace = async (study: string | null): Promise<Key[]> => {
  try { return (await chQuery<Key>(oncokbCancerGeneSource.keySpace(conn.db, study), conn)).data; }
  catch (e) { ok("C8 the key space's SQL runs" + (study ? " (study " + study + ")" : ""), false, e instanceof Error ? e.message.slice(0, 300) : String(e)); return []; }
};
const keys = await keySpace(null);
const want = (await chQuery<{ n: number | string }>("SELECT uniqExact(entrez_gene_id) AS n FROM " + conn.db + ".gene WHERE entrez_gene_id > 0", conn)).data[0];
ok("C8 the key space has a row per gene of the fixture's gene table with a positive Entrez id", keys.length > 0 && keys.length === Number(want.n),
  keys.length + " keys, " + want.n + " genes");
const notString = keys.filter((k) => typeof k.entrez_gene_id !== "string");
ok("C8 every key is a String", notString.length === 0, notString.slice(0, 5).map((k) => JSON.stringify(k)).join("; "));
const notPositive = keys.filter((k) => !/^[1-9]\d*$/.test(String(k.entrez_gene_id)));
ok("C8 every key is a positive Entrez id, written plainly", notPositive.length === 0, notPositive.slice(0, 5).map((k) => JSON.stringify(k)).join("; "));
const ids = keys.map((k) => String(k.entrez_gene_id));
ok("C8 one key per gene", new Set(ids).size === ids.length);
ok("C8 KRAS (3845) and TP53 (7157) are keys", ids.includes("3845") && ids.includes("7157"));
ok("C8 the key space is the same whatever the study", (await keySpace("no_such_study")).length === keys.length);

// ---- C7: the app's reads ----------------------------------------------------------------------

const exists = (await chQuery<{ n: number | string }>("SELECT count() AS n FROM system.tables WHERE database = 'annotation' AND name = 'oncokb_cancer_gene'", conn)).data[0];
if (!Number(exists.n)) {
  ok("C7 " + ONCOKB_CANCER_GENE_TABLE + " exists on connection b (npm run peer-db creates it)", false);
} else {
  const VERSION = "check-cancer-gene-" + process.pid;
  const w: Conn = { id: "b", url: conn.url, user: conn.user, password: conn.password, db: "annotation" };
  const row = (entrez: string, hugo: string, listed: boolean, at: string, curated = listed) => ({
    oncokb_version: VERSION, entrez_gene_id: entrez, hugo_symbol: hugo, cancer_gene: listed, oncokb_annotated: curated,
    is_oncogene: false, is_tsg: false, occurrence_count: listed ? 1 : 0, data: "", api_version: "check", resolved_at: at
  });
  try {
    await insertRows(w, "oncokb_cancer_gene", [
      row("3845", "KRAS", true, "2026-01-01 00:00:00"),
      row("3799", "KIF5B", true, "2026-01-01 00:00:00", false),
      row("7273", "", false, "2026-01-01 00:00:00"),
      row("7157", "TP53", true, "2026-01-01 00:00:00")
    ]);
    await insertRows(w, "oncokb_cancer_gene", [row("7157", "", false, "2026-01-02 00:00:00")]);
    const genes = (await chQuery<{ entrez: unknown }>(oncokbCancerGeneSql(VERSION), conn)).data;
    const entrez = genes.map((g) => Number(g.entrez)).sort((a, b) => a - b);
    ok("C7 oncokbCancerGeneSql: the pin's cancer genes alone, the latest row of each (KIF5B and KRAS, not TTN, not TP53 since unlisted)",
      JSON.stringify(entrez) === JSON.stringify([3799, 3845]), JSON.stringify(genes));
    ok("C7 a listed gene OncoKB does not curate (KIF5B, oncokb_annotated false) is a cancer gene (Annotation.tsx 182-186: any entry)",
      entrez.includes(3799), JSON.stringify(genes));
    ok("C7 entrez is a number (UInt32)", genes.every((g) => typeof g.entrez === "number"));
    const stored = (await chQuery<{ n: number | string }>(oncokbCancerGenesStoredSql(VERSION), conn)).data;
    ok("C7 oncokbCancerGenesStoredSql: genes are stored at the pin", stored.length === 1 && Number(stored[0].n) > 0, JSON.stringify(stored));
    const other = (await chQuery<{ entrez: unknown }>(oncokbCancerGeneSql(VERSION + "-other"), conn)).data;
    ok("C7 another release's pin reads none of them", other.length === 0, JSON.stringify(other));
    const none = (await chQuery<{ n: number | string }>(oncokbCancerGenesStoredSql(VERSION + "-other"), conn)).data;
    ok("C7 oncokbCancerGenesStoredSql: 0 at a pin with nothing stored", none.length === 1 && Number(none[0].n) === 0, JSON.stringify(none));
    const quoted = (await chQuery<{ entrez: unknown }>(oncokbCancerGeneSql("o'brien"), conn)).data;
    ok("C7 a pin with a quote runs and reads nothing", quoted.length === 0);
  } finally {
    await exec(w, "ALTER TABLE oncokb_cancer_gene DELETE WHERE oncokb_version = '" + VERSION + "'");
  }
}

console.log(`\n${checks - failures}/${checks} OncoKB cancer gene checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
