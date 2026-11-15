/**
 * Live check: Cancer Hotspots as a putative-driver source, as SQL run against the committed fixture
 * study on connection b — lib/hotspots.ts hotspotKeysSql (the mutations that are hotspots, read from
 * Genome Nexus's per-variant record in annotation.variant) and lib/driver-sql.ts driverCondSql (the
 * driver rule with those keys). Each expected answer is written down by hand from
 * test/fixtures/peer-study/data_mutations.txt (FX-P29-T1's rows), test/fixtures/peer-hotspots.tsv
 * and test/fixtures/peer-oncokb.tsv, by the portal's rule (cbioportal-frontend e9d70fb):
 * isLinearClusterHotspot (packages/cbioportal-utils/src/hotspot/CancerHotspotsUtils.ts 98-126) after
 * filterMutationsOnNonHotspotGenes (src/shared/lib/CancerHotspotsUtils.ts 33-40), the location from
 * extractGenomicLocation (packages/cbioportal-utils/src/mutation/MutationUtils.ts 69-90), and the
 * driver call annotateMutationPutativeDriver (ResultsViewPageStoreUtils.ts 141-146). Row ids are the
 * spec table's (H*, D*, W*).
 *
 * Run: node --env-file=.env.local scripts/check-hotspot-drivers.ts (connection b must be the
 * fixture: `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { chQuery, connById } from "../lib/ch.ts";
import { hotspotKeysSql } from "../lib/hotspots.ts";
import { driverCondSql, germlineCondSql } from "../lib/driver-sql.ts";
import { resolveDrivers } from "../lib/driver-settings.ts";

const STUDY = "cbiolab_peer_fixture";
const SAMPLE = "FX-P29-T1";
/** peer-db.ts stores the fixture's Genome Nexus records under this release (and the app's pin) */
const PINS = { hg19: "fixture", hg38: null };
/** and its OncoKB calls under this version */
const ONCOKB = "fixture";

/** [gene, mutation_variant, mutation_type, a hotspot?, the row of the case table] — all on FX-P29-T1 */
type Case = [string, string, string, boolean, string];
const CASES: Case[] = [
  ["H3-3A", "G35R", "Missense_Mutation", false, "H1 a gene not on the 684-gene list, a single-residue hotspot stored"],
  ["PIK3CA", "H1047R", "Missense_Mutation", true, "H2 a missense on a single-residue hotspot"],
  ["PIK3CA", "E110del", "In_Frame_Del", true, "H3 an in-frame deletion on an in-frame-indel hotspot"],
  ["BRAF", "D594G", "Missense_Mutation", true, "H2 a location with a 3d and a single-residue hotspot"],
  ["ATM", "A1100S", "Missense_Mutation", false, "H4 a missense on a 3d hotspot only"],
  ["NF1", "R304Q", "Missense_Mutation", false, "H5 a missense on a splice-site hotspot only"],
  ["STK11", "X200_splice", "Splice_Site", true, "H6 Splice_Site on a splice-site hotspot"],
  ["STK11", "X200_splice", "Splice_Region", true, "H6 Splice_Region on a splice-site hotspot (same protein change, another type)"],
  ["ARID1A", "X900_splice", "splice", true, "H6 a lowercase mutation type 'splice' (the warehouse holds one) on a splice-site hotspot"],
  ["SMARCA4", "X500_splice", "Splice_Site", false, "H7 a splice mutation on a single-residue hotspot"],
  ["SMARCA4", "X520_splice", "Splice_Region", false, "H7 a splice mutation on an in-frame-indel hotspot"],
  ["PTEN", "X200_splice", "Splice_Site", false, "H7 a splice mutation on a 3d hotspot"],
  ["MYC", "P57S", "Missense_Mutation", false, "H8 a stored record whose hotspot list is empty"],
  ["KEAP1", "R415C", "Missense_Mutation", false, "H9/H13 a mutation the store has no record for"],
  ["BRAF", "G469A", "Missense_Mutation", false, "H9 an empty variant allele: no location to look up (a record stored with an empty allele is not matched)"],
  ["PTEN", "R130G", "Missense_Mutation", true, "H10 Chromosome written chr10 in the MAF, the record under 10"],
  ["ATM", "R2000C", "", true, "H11 no mutation type: the non-splice branch"],
  ["ATM", "R1500C", "Missense_Mutation", true, "H12 the stored hotspot names another gene (BRAF): the type alone decides"],
  ["NF1", "R500W", "Missense_Mutation", true, "D7 a germline mutation at a hotspot"],
  ["STK11", "F354L", "Missense_Mutation", true, "D8 a hotspot OncoKB calls Likely Neutral"],
  ["CDKN2A", "D84Y", "Missense_Mutation", true, "D6 a hotspot mutation in a gene the sample also has a deep deletion of"],
  ["BRAF", "V600E", "Missense_Mutation", false, "D2 OncoKB-oncogenic, no hotspot record"]
];
/** the hotspot keys of the whole study: those of CASES; no other row of the fixture has a record */
const STUDY_KEYS = CASES.filter((c) => c[3]).map(([g, v, t]) => g + "|" + v + "|" + t);
/** OncoKB-oncogenic among CASES (peer-oncokb.tsv): a driver whenever OncoKB is on */
const ONCOKB_DRIVERS = new Set(["BRAF|V600E|Missense_Mutation"]);

let failures = 0, checks = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  checks++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

const conn = connById("b");
if (!conn) { console.log("FAIL connection b is not configured (npm run peer-db prints its CLICKHOUSE2_* lines)"); process.exit(1); }
const db = conn.db;

/** run hotspotKeysSql and read its rows as "gene|alteration|type", in the column order it selects */
const keysOf = async (studies: string[], genes: string[] | null, pins: { hg19: string | null; hg38: string | null }) => {
  const sql = hotspotKeysSql(db, studies, genes, pins);
  if (sql === null) return null;
  const rows = (await chQuery<Record<string, unknown>>(sql, conn)).data;
  return rows.map((r) => Object.values(r).map((v) => String(v ?? "")).join("|"));
};
const key = (c: Case) => c[0] + "|" + c[1] + "|" + c[2];
const sameSet = (got: string[], want: string[]) => got.length === want.length && want.every((k) => got.includes(k));

// the fixture holds what the cases need: the importer kept the shapes the cases are about
const raw = (await chQuery<{ chr: string; alt: string; type: string; status: string; pc: string }>(
  "SELECT me.chr AS chr, me.tumor_seq_allele AS alt, me.mutation_type AS type, m.mutation_status AS status, me.protein_change AS pc FROM " + db + ".mutation m " +
  "JOIN " + db + ".mutation_event me ON me.mutation_event_id = m.mutation_event_id " +
  "JOIN " + db + ".sample s ON s.internal_id = m.sample_id WHERE s.stable_id = " + "'" + SAMPLE + "'", conn)).data;
ok("fixture: " + SAMPLE + " holds every case's mutation", CASES.every((c) => raw.some((r) => r.pc === c[1])), raw.length + " rows");
ok("fixture: the chr10 row is stored under 10 (H10)", raw.some((r) => r.pc === "R130G" && r.chr === "10"));
ok("fixture: the empty-allele row is stored with an empty allele (H9)", raw.some((r) => r.pc === "G469A" && r.alt === ""));
ok("fixture: a lowercase 'splice' and an empty mutation type are stored as written (H6, H11)",
  raw.some((r) => r.type === "splice") && raw.some((r) => r.pc === "R2000C" && r.type === ""));
ok("fixture: a GERMLINE row is stored (D7)", raw.some((r) => r.pc === "R500W" && r.status === "GERMLINE"));
const stored = (await chQuery<{ n: number }>("SELECT count() AS n FROM annotation.variant WHERE source = 'genome_nexus' AND version = 'fixture'", conn)).data;
ok("fixture: Genome Nexus records are stored under 'fixture'", Number(stored[0]?.n) > 0, String(stored[0]?.n));

// ---- hotspotKeysSql: which mutations are hotspots (H1-H12)
const keys = await keysOf([STUDY], null, PINS);
ok("hotspotKeysSql gives SQL with the GRCh37 pin set", keys !== null);
if (keys) {
  for (const c of CASES) {
    const has = keys.includes(key(c));
    ok(`keys ${c[0]} ${c[1]} ${c[2] || "(no type)"}: ${c[4]}`, has === c[3], (has ? "a hotspot" : "not a hotspot") + ", expected " + (c[3] ? "a hotspot" : "not"));
  }
  ok("keys: the study's hotspot keys are exactly the expected ones", sameSet(keys, STUDY_KEYS), keys.filter((k) => !STUDY_KEYS.includes(k)).join(", ") || "none extra");
  ok("keys: each key once (DISTINCT)", new Set(keys).size === keys.length, keys.length + " rows, " + new Set(keys).size + " distinct");
}

// genes: only the named genes' keys
const pik = await keysOf([STUDY], ["PIK3CA"], PINS);
ok("keys for genes [PIK3CA]: only PIK3CA's", pik !== null && sameSet(pik, STUDY_KEYS.filter((k) => k.startsWith("PIK3CA|"))), JSON.stringify(pik));
const h3 = await keysOf([STUDY], ["H3-3A"], PINS);
ok("keys for genes [H3-3A]: none (H1, off the list even when asked by name)", h3 !== null && h3.length === 0, JSON.stringify(h3));
const notMutated = await keysOf([STUDY], ["KRAS"], PINS);
ok("keys for genes [KRAS]: none (its fixture rows have no record, H9)", notMutated !== null && notMutated.length === 0, JSON.stringify(notMutated));

// H13: the genome's pin decides which store is read; a release with nothing stored gives nothing
const hg38only = await keysOf([STUDY], null, { hg19: null, hg38: "fixture" });
ok("H13 keys with only a GRCh38 pin: none for a GRCh37 study", hg38only !== null && hg38only.length === 0, JSON.stringify(hg38only));
const otherRelease = await keysOf([STUDY], null, { hg19: "no-such-release", hg38: null });
ok("H13 keys at a release the store does not hold: none", otherRelease !== null && otherRelease.length === 0, JSON.stringify(otherRelease));
ok("H13 no pin at all: no SQL", hotspotKeysSql(db, [STUDY], null, { hg19: null, hg38: null }) === null);
const otherStudy = await keysOf(["no_such_study"], null, PINS);
ok("keys of a study not in the database: none", otherStudy !== null && otherStudy.length === 0, JSON.stringify(otherStudy));
// invariant 5: values reach SQL quoted — a quote in a study id, gene or pin runs and matches nothing
let quoted: string[] | null = null, quoteErr = "";
try { quoted = await keysOf([STUDY + "' OR '1'='1"], ["PIK3CA' OR '1'='1"], { hg19: "fixture' OR '1'='1", hg38: null }); } catch (e) { quoteErr = String((e as Error).message).slice(0, 120); }
ok("keys with quotes in the study, gene and pin: run, and match nothing", quoted !== null && quoted.length === 0, quoteErr || JSON.stringify(quoted));

// ---- driverCondSql with the keys: the driver call (D1-D8, W1/W3)
type Ev = { gene: string; v: string; t: string; vt: string; drv: number; germ: number };
const events = async (settings: Parameters<typeof resolveDrivers>[0], pin: string | null, k: string | null) =>
  (await chQuery<Ev>(
    "SELECT g.hugo_gene_symbol AS gene, g.mutation_variant AS v, g.mutation_type AS t, g.variant_type AS vt, toUInt8(" +
    driverCondSql(resolveDrivers(settings), pin, "g", k) + ") AS drv, toUInt8(" + germlineCondSql("g") + ") AS germ FROM " + db + ".genomic_event_derived g " +
    "WHERE g.cancer_study_identifier = '" + STUDY + "' AND g.sample_unique_id = '" + STUDY + "_" + SAMPLE + "'", conn)).data;
const ksql = hotspotKeysSql(db, [STUDY], null, PINS);

const compare = async (tag: string, settings: Parameters<typeof resolveDrivers>[0], pin: string | null, want: (c: Case) => boolean) => {
  const got = await events(settings, pin, ksql);
  ok(`${tag}: ${SAMPLE}'s rows are read`, got.length > CASES.length, got.length + " rows");
  for (const c of CASES) {
    const row = got.find((e) => e.vt === "mutation" && e.gene === c[0] && e.v === c[1] && e.t === c[2]);
    const w = want(c);
    ok(`${tag} ${c[0]} ${c[1]} ${c[2] || "(no type)"}: ${c[4]}`, !!row && Number(row.drv) === (w ? 1 : 0), row ? (Number(row.drv) ? "driver" : "not a driver") + ", expected " + (w ? "driver" : "not") : "row missing");
  }
  return got;
};

// hotspots alone: a driver exactly when a hotspot (D4); D7's germline row is one, and is still germline
const alone = await compare("hotspots alone", { oncokb: false, custom: false, tiers: [] }, null, (c) => c[3]);
const germ = alone.find((e) => e.gene === "NF1" && e.v === "R500W");
ok("D7 the germline hotspot is a driver and still germline (Show only somatic hides it)", !!germ && Number(germ.drv) === 1 && Number(germ.germ) === 1);
// D6: copy-number rows never count by hotspot, even in a gene with a hotspot mutation
const cna = alone.filter((e) => e.vt !== "mutation");
ok("D6 a copy-number row is never a hotspot driver (FX-P29-T1's CDKN2A deep deletion)", cna.length > 0 && cna.every((e) => Number(e.drv) === 0),
  cna.map((e) => e.gene + " " + e.vt + " " + e.drv).join(", "));

// D2: hotspots off, every other source off: nothing is a driver
await compare("D2 hotspots off", { oncokb: false, hotspots: false, custom: false, tiers: [] }, null, () => false);
// D2: hotspots off, OncoKB on: OncoKB's calls stand, the hotspots go
await compare("D2 hotspots off, OncoKB on", { hotspots: false, custom: false, tiers: [] }, ONCOKB, (c) => ONCOKB_DRIVERS.has(key(c)));
// D1, D3, D8: the defaults (hotspots on) with OncoKB: a hotspot is a driver whatever OncoKB says; OncoKB's still count
await compare("D1/D3/D8 defaults", undefined, ONCOKB, (c) => c[3] || ONCOKB_DRIVERS.has(key(c)));

// the rule applies study-wide: a key that is a hotspot is a driver in every sample that has it, and
// the rows of other samples, none of which has a record, are not called by hotspot
const study = (await chQuery<{ n: number }>(
  "SELECT countIf(toUInt8(" + driverCondSql(resolveDrivers({ oncokb: false, custom: false, tiers: [] }), null, "g", ksql) + ") = 1) AS n FROM " + db + ".genomic_event_derived g " +
  "WHERE g.cancer_study_identifier = '" + STUDY + "' AND g.sample_unique_id != '" + STUDY + "_" + SAMPLE + "'", conn)).data;
ok("hotspots alone: no other sample's row is a hotspot driver", Number(study[0]?.n) === 0, String(study[0]?.n));

console.log(`\n${checks - failures}/${checks} hotspot driver checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
