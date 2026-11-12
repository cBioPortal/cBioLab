// The Genome Nexus sources: each reference genome's service annotates the warehouse's variants of the
// studies on that genome into the shared annotation.variant, pinned to the service's release. Genome
// Nexus is a stubbed fetch and ClickHouse is @cbiolab/clickhouse/testing, so nothing leaves the machine.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeCh, type FakeCh } from "@cbiolab/clickhouse/testing";
import { syncKeys } from "../src/sync.ts";
import { genomeNexusSource, genomeNexusGrch38Source, gnRelease, variantData } from "../src/sources/genome-nexus.ts";
import { syncConn } from "../src/index.ts";

const realFetch = globalThis.fetch;
let ch: FakeCh | null = null;
afterEach(() => { ch?.restore(); ch = null; globalThis.fetch = realFetch; });

const VERSION = {
  genomeNexus: { server: { version: "2.2.3" } }, vep: { cache: { version: "116" } },
  annotationSourcesInfo: [{ id: "signal", version: "x" }, { id: "clinvar", version: "20260208" }]
};

interface Asked { url: string; body: unknown }
type Loc = { chromosome: string; start: number; end: number; referenceAllele: string; variantAllele: string };
/**
 * Genome Nexus stand-in. A variant on chromosome "NA" fails as the service fails it; every other one has
 * a consequence in `genes` (its canonical transcript ENST-<gene>, and a second transcript), and in KRAS
 * a ClinVar record and a SIGNAL germline entry.
 */
function genomeNexus(opts: { genes?: string[]; status?: number } = {}): Asked[] {
  const asked: Asked[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    asked.push({ url, body });
    if (opts.status) return new Response("down", { status: opts.status });
    const path = new URL(url).pathname;
    if (path === "/version") return Response.json(VERSION);
    const gene = /^\/ensembl\/canonical-transcript\/hgnc\/(.+)$/.exec(path)?.[1];
    if (gene) return gene === "LINC1" ? Response.json({ message: "Ensembl transcript not found: LINC1" }, { status: 404 })
      : Response.json({ transcriptId: "ENST-" + decodeURIComponent(gene), hugoSymbols: [decodeURIComponent(gene)] });
    return Response.json((body as Loc[]).map((l) => {
      const q = [l.chromosome, l.start, l.end, l.referenceAllele, l.variantAllele].join(",");
      if (l.chromosome === "NA") return { originalVariantQuery: q, successfully_annotated: false, errorMessage: "Error from VEP for: NA:g.1C>T" };
      const genes = opts.genes ?? ["KRAS"];
      return {
        originalVariantQuery: q, successfully_annotated: true,
        annotation_summary: { canonicalTranscriptId: "ENST-" + genes[0], transcriptConsequenceSummaries: genes.flatMap((g) => [
          { transcriptId: "ENST-" + g, hugoGeneSymbol: g, hgvsc: "ENST-" + g + ".1:c.35G>A" },
          { transcriptId: "ENST-" + g + "-alt", hugoGeneSymbol: g, hgvsc: "ENST-" + g + "-alt.1:c.135G>A" }]) },
        clinvar: genes.includes("KRAS") ? { annotation: { clinvarId: 12582, clinicalSignificance: "Pathogenic", conflictingClinicalSignificance: "" } } : null,
        ...(genes.includes("KRAS") ? { signalAnnotation: { annotation: [{ hugoGeneSymbol: "KRAS", chromosome: l.chromosome, startPosition: l.start,
          endPosition: l.end, referenceAllele: l.referenceAllele, variantAllele: l.variantAllele, mutationStatus: "germline", pathogenic: "1",
          countsByTumorType: [{ tumorType: "Colorectal", tumorTypeCount: 100, variantCount: 2 }] }] } } : {})
      };
    }));
  }) as typeof fetch;
  return asked;
}

const key = (chr: string, pos: number, ref = "G", alt = "A", genes = "KRAS") =>
  ({ source: "genome_nexus", chr, start_position: String(pos), end_position: String(pos), reference_allele: ref, variant_allele: alt, genes });

test("the release pins the server, its VEP cache and its ClinVar; a service naming no version is refused", async () => {
  assert.equal(gnRelease(VERSION), "2.2.3-vep116-clinvar20260208");
  assert.equal(gnRelease({ genomeNexus: { server: { version: "1.4.1" } }, vep: { cache: { version: "NA" } } }), "1.4.1-vepNA-clinvarNA");
  assert.throws(() => gnRelease({}), /named no server version/);
  const asked = genomeNexus();
  assert.deepEqual(await genomeNexusSource.release(), { version: "2.2.3-vep116-clinvar20260208", extra: {} });
  assert.equal(asked[0].url, "https://v1.genomenexus.org/version");
  await genomeNexusGrch38Source.release();
  assert.equal(asked[1].url, "https://grch38.genomenexus.org/version", "each genome's own service");
});

test("each genome's key space is its own studies' variants, and only those cBioPortal can ask about", () => {
  const ks = genomeNexusSource.keySpace("cbio", "s'1");
  assert.match(ks, /^SELECT 'genome_nexus' AS source, assumeNotNull\(chr\) AS chr, toString\(startPosition\) AS start_position/);
  // with the genes the warehouse lists each variant under: the HGVSc of each is on that gene's canonical transcript
  assert.match(ks, /arrayStringConcat\(arraySort\(groupUniqArrayIf\(`GENE\.hugoGeneSymbol`, `GENE\.hugoGeneSymbol` != ''\)\), ','\) AS genes FROM cbio\.mutation_derived/);
  assert.match(ks, /GROUP BY source, chr, start_position, end_position, reference_allele, variant_allele$/);
  assert.match(ks, /FROM cbio\.mutation_derived WHERE studyId = 's\\'1' AND studyId IN \(SELECT cs\.cancer_study_identifier FROM cbio\.cancer_study cs JOIN cbio\.reference_genome rg .* WHERE rg\.name = 'hg19'\)/);
  assert.match(ks, /startPosition > 0 AND endPosition > 0 AND referenceAllele NOT IN \('', 'NA'\) AND tumorSeqAllele NOT IN \('', 'NA'\) AND NOT \(referenceAllele = '-' AND tumorSeqAllele = '-'\)/);
  assert.match(genomeNexusGrch38Source.keySpace("cbio", null), /'genome_nexus_grch38' AS source.* WHERE studyId IN .*rg\.name = 'hg38'/s);
  assert.doesNotMatch(genomeNexusGrch38Source.keySpace("cbio", null), /studyId = /);
});

test("a batch is asked as cBioPortal asks it, and each variant is stored with every transcript, each gene's canonical one, ClinVar and SIGNAL", async () => {
  const asked = genomeNexus({ genes: ["KRAS", "LINC1"] });
  const rows = await genomeNexusSource.annotate([key("chr12", 25398284, "C", "T", "KRAS,LINC1"), key("NA", 1, "C", "T")]);
  const ask = asked.find((a) => a.url.includes("/annotation/genomic"))!;
  assert.equal(ask.url, "https://v1.genomenexus.org/annotation/genomic?fields=annotation_summary,clinvar,signal&isoformOverrideSource=mskcc");
  assert.deepEqual(ask.body, [{ chromosome: "12", start: 25398284, end: 25398284, referenceAllele: "C", variantAllele: "T" },
    { chromosome: "NA", start: 1, end: 1, referenceAllele: "C", variantAllele: "T" }], "the chr prefix dropped, as MutationUtils.extractGenomicLocation drops it");

  // the row keeps the warehouse's own spelling, so it joins back to the mutation
  assert.deepEqual({ ...rows[0], data: undefined }, { source: "genome_nexus", chr: "chr12", start_position: 25398284, end_position: 25398284,
    reference_allele: "C", variant_allele: "T", data: undefined });
  const d = JSON.parse(String(rows[0].data));
  assert.equal(d.ok, true);
  assert.deepEqual(d.canonical, { KRAS: "ENST-KRAS" }, "a gene the service has no canonical transcript for (a 404) is left out");
  assert.equal(d.transcripts.length, 4, "every transcript of every gene");
  assert.deepEqual(d.clinvar, { id: 12582, significance: "Pathogenic", conflicting: "" });
  assert.equal(d.signal[0].mutationStatus, "germline");
  assert.equal(d.signal[0].startPosition, undefined, "SIGNAL's copy of the coordinates is dropped: the row's key holds them");
  // a variant the service could not annotate is stored as such, so it is not asked again every run
  assert.deepEqual(JSON.parse(String(rows[1].data)), { ok: false, error: "Error from VEP for: NA:g.1C>T" });
});

test("each gene's canonical transcript is asked once per sync, a gene at a time, by the warehouse's own symbol", async () => {
  // Genome Nexus may name the gene differently (an older symbol): cBioPortal looks it up by its own, and so does the sync
  const asked = genomeNexus({ genes: ["CXorf22"] });
  const [row] = await genomeNexusSource.annotate([key("23", 35993875, "C", "A", "CFAP47")]);
  await genomeNexusSource.annotate([key("23", 35993876, "C", "A", "CFAP47")]);
  const canon = asked.filter((a) => a.url.includes("/canonical-transcript/"));
  assert.deepEqual(canon.map((a) => a.url), ["https://v1.genomenexus.org/ensembl/canonical-transcript/hgnc/CFAP47?isoformOverrideSource=mskcc"]);
  assert.deepEqual(JSON.parse(String(row.data)).canonical, { CFAP47: "ENST-CFAP47" });
});

test("variantData without a successful annotation says why", () => {
  assert.deepEqual(variantData(undefined, [], new Map()), { ok: false, error: "Genome Nexus returned no annotation for this variant" });
});

test("GRCh38's service has no SIGNAL, so it is not asked for", async () => {
  const asked = genomeNexus({ genes: ["GNAQ"] });
  await genomeNexusGrch38Source.annotate([{ ...key("9", 77794572, "G", "A", "GNAQ"), source: "genome_nexus_grch38" }]);
  assert.equal(asked.find((a) => a.url.includes("/annotation/genomic"))!.url,
    "https://grch38.genomenexus.org/annotation/genomic?fields=annotation_summary,clinvar&isoformOverrideSource=mskcc");
});

test("a sync writes the shared table, keyed by source, pinned to the release, as the public sources' writer", async () => {
  genomeNexus({ genes: ["TP53"] });
  ch = fakeCh();
  ch.answer(/^SELECT uniqExact\(source, chr, start_position, end_position, reference_allele, variant_allele\) AS n FROM \(SELECT 'genome_nexus'/, [{ n: 2 }]);
  ch.answer(/LEFT ANTI JOIN/, [key("17", 7577120, "G", "A", "TP53")]);
  const r = await syncKeys(ch.conn, { ...genomeNexusSource, batchDelayMs: 0 }, { version: "2.2.3-vep116-clinvar20260208", extra: {} }, "a_study", () => {});
  assert.deepEqual(r, { total: 2, alreadyStored: 1, done: 1, failed: 0, aborted: false });
  const diff = ch.statements.find((s) => /LEFT ANTI JOIN/.test(s) && !/uniqExact/.test(s))!;
  assert.match(diff, /FROM annotation\.variant WHERE version = '2\.2\.3-vep116-clinvar20260208' AND \(toString\(source\), toString\(chr\)/, "the diff is within this source's rows");
  assert.match(diff, /^SELECT w\.\* FROM \(SELECT 'genome_nexus' AS source/, "the key space's genes come along with each key");
  // the stored side is compared on the key alone: the key space's extra column would not match the key's six
  assert.match(diff, /toString\(variant_allele\)\) IN \(SELECT source, chr, start_position, end_position, reference_allele, variant_allele FROM \(SELECT 'genome_nexus' AS source/);
  assert.match(String(ch.rows("variant")[0].data), /"canonical":\{"TP53":"ENST-TP53"\}/);
  const [row] = ch.rows("variant");
  assert.equal(row.source, "genome_nexus");
  assert.equal(row.version, "2.2.3-vep116-clinvar20260208");
  assert.equal(ch.rows("sync_run")[0].source, "genome_nexus");

  const c = syncConn(genomeNexusSource, { CLICKHOUSE_URL: "https://ch", CLICKHOUSE_DB: "cbio", ANNOTATION_WRITER_PASSWORD: "pw" });
  assert.equal(c.user, "annotation_writer", "one writer for every public source, not one per source");
  assert.throws(() => syncConn(genomeNexusGrch38Source, { CLICKHOUSE_URL: "https://ch", CLICKHOUSE_DB: "cbio" }), /needs ANNOTATION_WRITER_PASSWORD/);
});

test("a service that stays down fails the batch, so the run says to resume", async () => {
  genomeNexus({ status: 400 });
  await assert.rejects(genomeNexusSource.annotate([key("1", 100)]), /Genome Nexus \/annotation\/genomic -> 400: down/);
});

test("verify re-asks the service for stored variants and names each disagreement", async () => {
  genomeNexus({ genes: ["KRAS"] });
  ch = fakeCh();
  const stored = (hgvsc: string, significance: string) => JSON.stringify({ ok: true, canonical: { KRAS: "ENST-KRAS" },
    transcripts: [{ transcriptId: "ENST-KRAS", hugoGeneSymbol: "KRAS", hgvsc }], clinvar: { id: 12582, significance, conflicting: "" },
    signal: [{ hugoGeneSymbol: "KRAS", mutationStatus: "germline", pathogenic: "1", countsByTumorType: [{ tumorType: "Colorectal", tumorTypeCount: 100, variantCount: 2 }] }] });
  ch.answer(/ORDER BY rand\(\) LIMIT 2/, [
    { chr: "12", start_position: "1", end_position: "1", reference_allele: "G", variant_allele: "A", data: stored("ENST-KRAS.1:c.35G>A", "Pathogenic") },
    { chr: "12", start_position: "2", end_position: "2", reference_allele: "G", variant_allele: "A", data: stored("ENST-KRAS.1:c.34G>A", "Benign") }]);
  const r = await genomeNexusSource.verify!(ch.conn, "2.2.3-vep116-clinvar20260208", 2);
  assert.equal(r.checked, 2);
  assert.deepEqual(r.mismatches, ["12,2,2,G,A HGVSc: stored KRAS=ENST-KRAS.1:c.34G>A, live KRAS=ENST-KRAS.1:c.35G>A", "12,2,2,G,A ClinVar: stored Benign, live Pathogenic"]);
  assert.match(ch.statements[0], /WHERE source = 'genome_nexus' AND version = '2\.2\.3-vep116-clinvar20260208' ORDER BY rand\(\)/);
});

test("a busy service is asked again; a variant it leaves out, or one with no ClinVar record or genes, is stored as what it is", async () => {
  let calls = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/annotation/genomic") && calls++ === 0) return new Response("busy", { status: 503 });
    if (url.includes("/annotation/genomic")) {
      const [first] = JSON.parse(String(init?.body)) as Loc[];
      return Response.json([{ originalVariantQuery: [first.chromosome, first.start, first.end, first.referenceAllele, first.variantAllele].join(","),
        successfully_annotated: true, annotation_summary: {}, clinvar: { annotation: null } }]);
    }
    return Response.json({ message: "not found" }, { status: 404 });
  }) as typeof fetch;
  const rows = await genomeNexusSource.annotate([key("1", 100, "G", "A", ""), key("1", 200)]);
  assert.equal(calls, 2, "asked again after the 503");
  assert.deepEqual(JSON.parse(String(rows[0].data)), { ok: true, variantCanonical: "", canonical: {}, transcripts: [], clinvar: null });
  assert.deepEqual(JSON.parse(String(rows[1].data)), { ok: false, error: "Genome Nexus returned no annotation for this variant" });
});

test("a 404 where none is expected is an error, not an empty answer", async () => {
  globalThis.fetch = (async () => Response.json({ message: "no such path" }, { status: 404 })) as typeof fetch;
  await assert.rejects(genomeNexusSource.release(), /Genome Nexus \/version -> 404/);
});
