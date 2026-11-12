// The mutation table's Genome Nexus columns: read from the offline store at each genome's pin, never
// from the service (docs/ANNOTATION.md), and spelled as cBioPortal's mutation table spells them.
// lib/ch.ts reads its connection when it loads, so the environment is set before it is imported.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, { CLICKHOUSE_URL: "http://warehouse.test:8123", CLICKHOUSE_USER: "app", CLICKHOUSE_PASSWORD: "pw", CLICKHOUSE_DB: "cbio" });
delete process.env.GENOME_NEXUS_PIN; delete process.env.GENOME_NEXUS_GRCH38_PIN;
const { variantPins, describePins, studiesWithoutVariantAnnotation, variantAnnotationCte, variantColumnsSql, hgvsgSql } = await import("../lib/variant-annotation.ts");
const { mutationRowSource, MUTATION_COLUMNS } = await import("../lib/mutation-table.ts");
const { pageSql } = await import("../lib/table-query.ts");
const { hgvsgUrl, truncate, signalRows, num, upperFirst } = await import("../lib/mutation-cell-text.ts");

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });
let sent: string[] = [];
/** the warehouse: answers the pin query with `pins` rows and the coverage query with `studies` */
function warehouse(pins: { source: string; v: string }[], studies: Record<string, string[]> = {}) {
  sent = [];
  globalThis.fetch = (async (_: unknown, init?: RequestInit) => {
    const sql = String(init?.body ?? "");
    sent.push(sql);
    const src = /source = '(\w+)'/.exec(sql)?.[1];
    const data = /argMax\(version/.test(sql) ? pins : src ? (studies[src] || []).map((study) => ({ study })) : [];
    return new Response(JSON.stringify({ data, meta: [], rows: data.length, statistics: {} }));
  }) as typeof fetch;
}

const PINS = { hg19: "2.2.3-vep116-clinvar20260208", hg38: "1.4.1-vepNA-clinvar20250106" };

test("each genome's pin is the release its latest sync stored, read once from the shared log; a setting overrides it", async () => {
  warehouse([{ source: "genome_nexus", v: PINS.hg19 }]);
  assert.deepEqual(await variantPins(), { hg19: PINS.hg19, hg38: null });
  assert.match(sent[0], /SELECT source, argMax\(version, started_at\) AS v FROM annotation\.sync_run WHERE source IN \('genome_nexus', 'genome_nexus_grch38'\) AND \(annotated_new > 0 OR already_stored > 0\)/);
  await variantPins();
  assert.equal(sent.length, 1, "cached");
  process.env.GENOME_NEXUS_GRCH38_PIN = "pinned-38";
  try { assert.deepEqual(await variantPins(), { hg19: PINS.hg19, hg38: "pinned-38" }); } finally { delete process.env.GENOME_NEXUS_GRCH38_PIN; }
});

test("the pins are named for the reader, genome by genome", () => {
  assert.equal(describePins(PINS), "Genome Nexus GRCh37 2.2.3-vep116-clinvar20260208, GRCh38 1.4.1-vepNA-clinvar20250106");
  assert.equal(describePins({ hg19: null, hg38: PINS.hg38 }), "Genome Nexus GRCh38 1.4.1-vepNA-clinvar20250106");
  assert.equal(describePins({ hg19: null, hg38: null }), "");
});

test("a study no sync has covered is named, so its blank cells are explained", async () => {
  warehouse([], { genome_nexus: ["a"], genome_nexus_grch38: ["b"] });
  assert.deepEqual(await studiesWithoutVariantAnnotation(["a", "b", "c"]), ["c"]);
});

beforeEach(() => { sent = []; });

test("a part reads the source of its study's own genome, at that genome's pin, for its variants only", () => {
  assert.equal(variantAnnotationCte("g0", "cbio", "s", "SELECT 1", { hg19: null, hg38: null }), null, "no pin, no read of the store");
  const cte = variantAnnotationCte("g0", "cbio", "s'1", "SELECT chr, start, end, ref, var FROM m0", PINS)!;
  assert.match(cte, /FROM annotation\.variant/);
  assert.match(cte, /WHERE \(source, version\) IN \(\('genome_nexus', '2\.2\.3-vep116-clinvar20260208'\), \('genome_nexus_grch38', '1\.4\.1-vepNA-clinvar20250106'\)\)/);
  assert.match(cte, /AND source = \(SELECT multiIf\(rg\.name = 'hg19', 'genome_nexus', rg\.name = 'hg38', 'genome_nexus_grch38', ''\) FROM cbio\.cancer_study cs .* WHERE cs\.cancer_study_identifier = 's\\'1'\)/);
  assert.match(cte, /AND \(chr, start_position, end_position, reference_allele, variant_allele\) IN \(SELECT chr, start, end, ref, var FROM m0\)/);
  // a ReplacingMergeTree may hold a row twice until it merges: one per variant
  assert.match(cte, /any\(data\) AS gd\n {2}FROM .*GROUP BY chr, start, end, ref, var\)$/s);
  // only the genome that has a pin is read
  assert.doesNotMatch(variantAnnotationCte("g0", "cbio", "s", "SELECT 1", { hg19: PINS.hg19, hg38: null })!, /grch38/);
});

test("HGVSc is on the canonical transcript of the table's gene; ClinVar and SIGNAL's germline entry from the record", () => {
  const sql = variantColumnsSql("gd", "KRAS");
  assert.match(sql, /JSONExtractString\(arrayFirst\(t -> JSONExtractString\(t, 'transcriptId'\) = JSONExtractString\(gd, 'canonical', 'KRAS'\), JSONExtractArrayRaw\(gd, 'transcripts'\)\), 'hgvsc'\) AS hgvsc/);
  assert.match(sql, /JSONExtractString\(gd, 'clinvar', 'significance'\) AS clinvar/);
  assert.match(sql, /arrayLast\(e -> position\(JSONExtractString\(e, 'mutationStatus'\), 'germline'\) > 0, JSONExtractArrayRaw\(gd, 'signal'\)\) AS sig/);
  assert.match(sql, /if\(lower\(JSONExtractString\(sig, 'mutationStatus'\)\) = 'germline' AND .*'variantCount'.* \/ .*'tumorTypeCount'.*, NULL\) AS signalFreq/s);
});

test("the mutation table reads the store only when a genome has a pin, and joins on all five coordinates", () => {
  const part = [{ cohort: "c", study: "s", cohortSql: "SELECT '' AS pid, '' AS sid" }];
  const none = String(pageSql(mutationRowSource(part, "cbio", "KRAS", null, { hg19: null, hg38: null }), {}, [], 10, 0));
  assert.doesNotMatch(none, /annotation\.variant/, "a warehouse without the store still answers");
  assert.match(none, /AS hgvsg/, "HGVSg needs no store");
  const read = String(pageSql(mutationRowSource(part, "cbio", "KRAS", null, PINS), {}, [], 10, 0));
  assert.match(read, /g0 AS \(SELECT chr, start_position AS start/);
  assert.match(read, /LEFT JOIN g0 AS g ON g\.chr = m\.chr AND g\.start = m\.start AND g\.end = m\.end AND g\.ref = m\.ref AND g\.var = m\.var/);
  assert.match(read, /\(SELECT rg\.name FROM cbio\.cancer_study cs .*'s'\) AS build/s);
  // HGVSc sorts by its c. position, ClinVar by its significance, SIGNAL by its frequency, as the portal sorts them
  const sorted = (column: string) => String(pageSql(mutationRowSource(part, "cbio", "KRAS", null, PINS), { sort: { column } }, [], 10, 0));
  assert.match(sorted("hgvsc"), /ORDER BY toInt64OrNull\(extract\(hgvsc, 'c\\\.\(-\?\[0-9\]\+\)'\)\) ASC NULLS LAST/);
  assert.match(sorted("clinvar"), /ORDER BY nullIf\(clinvar, ''\) ASC NULLS LAST/);
  assert.match(sorted("signal"), /ORDER BY signalFreq ASC NULLS LAST/);
  assert.deepEqual(MUTATION_COLUMNS.slice(-6).map((c) => c.id), ["var", "hgvsg", "hgvsc", "status", "clinvar", "signal"]);
});

test("HGVSg is built from the mutation's coordinates, as MutationUtils.generateHgvsgByMutation builds it", () => {
  const sql = hgvsgSql("c", "s", "e", "r", "a");
  for (const piece of ["r = '-', concat(toString(s), '_', toString(e), 'ins', a)", "a = '-', if(s = e, concat(toString(s), 'del'), concat(toString(s), '_', toString(e), 'del'))",
    "length(r) = 1 AND length(a) = 1, concat(toString(s), r, '>', a)", "length(r) = 1, concat(toString(s), 'delins', a)", "concat(toString(s), '_', toString(e), 'delins', a)",
    "NOT (r = '-' AND a = '-')", "r NOT IN ('', 'NA')"])
    assert.ok(sql.includes(piece), piece);
});

test("the cells' text is the portal's", () => {
  assert.equal(hgvsgUrl("7:g.140453136A>T", false), "https://www.genomenexus.org/variant/7%3Ag.140453136A%3ET");
  assert.equal(hgvsgUrl("9:g.1A>T", true), "https://grch38.genomenexus.org/variant/9%3Ag.1A%3ET");
  // TruncatedText: 32 characters fit; past that, 30 and "..."
  assert.equal(truncate("Pathogenic/Likely_pathogenic"), "Pathogenic/Likely_pathogenic");
  assert.equal(truncate("x".repeat(32)), "x".repeat(32));
  assert.equal(truncate("Conflicting_classifications_of_pathogenicity"), "Conflicting_classifications_of...");
  assert.equal(truncate("abcdefgh", 4, 1), "abcd...", "a narrower cut: past max + buffer");
  assert.equal(truncate("abcde", 4, 1), "abcde");
  assert.deepEqual([num(null), num(12.345, 1), num(7)], ["-", "12.3", "7"]);
  assert.equal(upperFirst("colorectal"), "Colorectal");
});

test("SIGNAL's table has a row per cancer type, with prevalence and the biallelic share", () => {
  const rows = signalRows({ mutationStatus: "germline", pathogenic: "1",
    countsByTumorType: [{ tumorType: "breast", tumorTypeCount: 200, variantCount: 4 }, { tumorType: "lung", tumorTypeCount: 100, variantCount: 0 }],
    biallelicCountsByTumorType: [{ tumorType: "breast", tumorTypeCount: 200, variantCount: 2 }],
    qcPassCountsByTumorType: [{ tumorType: "breast", tumorTypeCount: 200, variantCount: 4 }],
    statsByTumorType: [{ tumorType: "breast", ageAtDx: 51, tmb: 2.345, msiScore: 0.1, hrdScore: { lst: 9, ntelomericAi: 7, fractionLoh: 0.12 } }] });
  assert.deepEqual(rows[0], { tumorType: "breast", mutationStatus: "Germline - Pathogenic", tumorTypeCount: 200, variantCount: 4, frequency: 0.02,
    biallelicRatio: 0.5, biallelicTumorCount: 2, qcPassTumorCount: 4, ageAtDx: 51, tmb: 2.345, msiScore: 0.1, lst: 9, ntelomericAi: 7, fractionLoh: 0.12 });
  assert.equal(rows[1].biallelicRatio, null, "0 / 0 is no ratio");
  assert.equal(signalRows({ mutationStatus: "germline", countsByTumorType: [{ tumorType: "x", tumorTypeCount: 1, variantCount: 1 }] })[0].mutationStatus, "Germline - Benign/VUS");
  assert.equal(signalRows({ mutationStatus: "somatic" }).length, 0);
  const one = { tumorType: "x", tumorTypeCount: 10, variantCount: 2 };
  assert.equal(signalRows({ mutationStatus: "Somatic", countsByTumorType: [one] })[0].mutationStatus, "Somatic", "status is read case-blind");
  assert.equal(signalRows({ mutationStatus: "unknown", countsByTumorType: [one] })[0].mutationStatus, "Unknown");
  // the biallelic share needs both lists; with only one, there is none, and the counts it has are kept
  const half = signalRows({ mutationStatus: "germline", countsByTumorType: [one], biallelicCountsByTumorType: [{ ...one, variantCount: 1 }] })[0];
  assert.equal(half.biallelicRatio, null);
  assert.equal(half.biallelicTumorCount, 1);
  assert.equal(half.qcPassTumorCount, null);
  // a cancer type the stats leave out has no stats
  assert.deepEqual([half.ageAtDx, half.tmb, half.msiScore, half.lst], [null, null, null, null]);
});
