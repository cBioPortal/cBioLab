/**
 * Live check: the oncoprint's mutation spectrum counts (lib/oncoprint.ts spectrumSql, reached
 * through clinicalSql) against the committed fixture study on connection b, each expected value
 * written down by hand from test/fixtures/peer-study/data_mutations.txt and the portal's
 * MutationSpectrumServiceImpl (cbioportal 03c0280), which counts, per sample, the rows of the
 * study's mutation profile whose two alleles are each one of A, C, G, T (MutationMapper.xml
 * snpOnly), folded to the pyrimidine strand, with a case-sensitive comparison:
 *
 *   K1  G>T counts as C>A, G>C as C>G, G>A as C>T, A>T as T>A, A>G as T>C, A>C as T>G
 *   K2  each row counts once, a second row at the same locus too
 *   K3  an indel or a DNP counts nowhere
 *   K4  a lowercase allele counts nowhere
 *   K5  ref equal to alt counts in no class
 *   K6  germline and UNCALLED rows count (no status filter on this path)
 *   K8  a sample with mutations but no single-base substitution has no spectrum row
 *   K9  a sample with no mutations has no spectrum row
 *   K10 with the query restricted to some samples, only those count
 *   V1  a patient column's counts are its samples' summed
 *
 * Run: node --env-file=.env.local scripts/check-oncoprint-spectrum.ts (connection b must be the
 * fixture: `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { chQuery, connById } from "../lib/ch.ts";
import { clinicalSql } from "../lib/oncoprint.ts";

const STUDY = "cbiolab_peer_fixture";
const K = "MUTATION_SPECTRUM";

/** [case id, expected "C>A,C>G,C>T,T>A,T>C,T>G" counts (null = no spectrum row), the row of the case table] */
type Want = [string, string | null, string];

const PATIENTS: Want[] = [
  // FX-P21-T1: TP53 C>T, EGFR T>G, NF1 C>T, plus G>T, G>C, A>T, A>G, A>C, C>G
  ["FX-P21", "1,2,2,1,1,2", "K1 reverse complements fold to the pyrimidine strand"],
  // FX-P27-T1: TP53 C>T, EGFR T>G, STK11 C>T, CDKN2A G>A, plus T>A, T>C
  ["FX-P27", "0,0,3,1,1,1", "K1 forward classes"],
  // FX-P23-T1: EGFR T>G, SMARCA4 C>T, KEAP1 C>A and a second row C>T at the same locus
  ["FX-P23", "1,0,2,0,0,1", "K2 two rows at one locus count twice"],
  // FX-P24-T1: TP53 C>T, EGFR 15-base deletion, plus a CC>TT DNP and a - > A insertion
  ["FX-P24", "0,0,1,0,0,0", "K3 indels and DNPs count nowhere"],
  // FX-P25-T1: EGFR T>G, FAT1 G>A, plus EGFR c>a in lowercase
  ["FX-P25", "0,0,1,0,0,1", "K4 a lowercase allele counts nowhere"],
  // FX-P30-T1: TP53 C>T, ATM C>T, plus TP53 A>A
  ["FX-P30", "0,0,2,0,0,0", "K5 ref equal to alt counts in no class"],
  // FX-P28-T1: EGFR deletion, ARID1A C>T, ATM C>T (somatic), plus EGFR T>A GERMLINE and ATM T>C UNCALLED
  ["FX-P28", "0,0,2,1,1,0", "K6 germline and UNCALLED rows count"],
  // FX-P26-T1: an EGFR deletion only
  ["FX-P26", null, "K8 mutations but no SNV: no spectrum row"],
  // FX-P38-T1: no mutations
  ["FX-P38", null, "K9 no mutations: no spectrum row"],
  // FX-P01: T1 KRAS C>A, TP53 C>T; T2 KRAS C>A
  ["FX-P01", "2,0,1,0,0,0", "V1 a patient's samples summed"],
  // FX-P02: T1 KRAS C>T, SMARCA4 C>T, PIK3CA G>A; T2 KRAS C>T
  ["FX-P02", "0,0,4,0,0,0", "V1 a patient's samples summed (G>A folded)"]
];

const SAMPLES: Want[] = [
  ["FX-P01-T1", "1,0,1,0,0,0", "sample column: its own counts"],
  ["FX-P01-T2", "1,0,0,0,0,0", "sample column: its own counts"],
  ["FX-P02-T1", "0,0,3,0,0,0", "sample column: its own counts"],
  ["FX-P26-T1", null, "K8 sample column: no spectrum row"]
];

/** K10: the query restricted to FX-P01-T2 and FX-P02-T2 */
const QUERY_SAMPLES = ["FX-P01-T2", "FX-P02-T2"];
const RESTRICTED: Want[] = [
  ["FX-P01", "1,0,0,0,0,0", "K10 only the queried sample counts (T1's TP53 C>T and KRAS C>A left out)"],
  ["FX-P02", "0,0,1,0,0,0", "K10 only the queried sample counts"],
  ["FX-P03", null, "K10 no sample in the query: no spectrum row"],
  ["FX-P21", null, "K10 no sample in the query: no spectrum row"]
];

let failures = 0, checks = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  checks++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

const conn = connById("b");
if (!conn) { console.log("FAIL connection b is not configured (npm run peer-db prints its CLICKHOUSE2_* lines)"); process.exit(1); }

type Row = { pid: string; k: string; v: string };
const run = async (unit: "patient" | "sample", samples?: string) =>
  (await chQuery<Row>(clinicalSql([K], STUDY, conn.db, unit, samples), conn)).data;

// the fixture holds what the cases need: the importer kept the alleles' case, the ref = alt row and both statuses
const raw = (await chQuery<{ ref: string; alt: string; status: string }>(
  "SELECT me.reference_allele AS ref, me.tumor_seq_allele AS alt, m.mutation_status AS status FROM " + conn.db + ".mutation m " +
  "JOIN " + conn.db + ".mutation_event me ON me.mutation_event_id = m.mutation_event_id " +
  "JOIN " + conn.db + ".sample s ON s.internal_id = m.sample_id " +
  "WHERE s.stable_id IN ('FX-P25-T1', 'FX-P28-T1', 'FX-P30-T1')", conn)).data;
ok("fixture: a lowercase c>a row is stored as written", raw.some((r) => r.ref === "c" && r.alt === "a"), JSON.stringify(raw.filter((r) => r.ref.toLowerCase() === "c" && r.alt.toLowerCase() === "a")));
ok("fixture: an A>A row is stored", raw.some((r) => r.ref === "A" && r.alt === "A"));
ok("fixture: a GERMLINE and an UNCALLED row are stored", raw.some((r) => r.status === "GERMLINE") && raw.some((r) => r.status === "UNCALLED"),
  [...new Set(raw.map((r) => r.status))].join(","));

const compare = (got: Row[], wants: Want[], tag: string) => {
  for (const [id, want, why] of wants) {
    const found = got.filter((r) => r.pid === id);
    const v = found[0]?.v ?? null;
    const pass = found.length <= 1 && found.every((r) => r.k === K) && v === want;
    ok(`${tag}${id}: ${why}`, pass, "ours " + (found.length > 1 ? found.length + " rows" : JSON.stringify(v)) + ", expected " + JSON.stringify(want));
  }
};

const patients = await run("patient");
ok("the fixture study is on connection b", patients.length > 0, patients.length + " rows");
compare(patients, PATIENTS, "patient ");
compare(await run("sample"), SAMPLES, "sample ");
const inQuery = "SELECT arrayJoin([" + QUERY_SAMPLES.map((s) => "'" + s + "'").join(",") + "])";
compare(await run("patient", inQuery), RESTRICTED, "samples " + QUERY_SAMPLES.join(",") + ": ");

console.log(`\n${checks - failures}/${checks} mutation spectrum checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
