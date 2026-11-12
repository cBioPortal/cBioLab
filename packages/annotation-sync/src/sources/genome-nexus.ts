// Genome Nexus: each genomic variant's annotation as cBioPortal's mutation table reads it — every
// transcript's consequence (HGVSc, HGVSp, consequence, SIFT, PolyPhen-2, AlphaMissense), each gene's
// canonical transcript (MSKCC isoform overrides), ClinVar, SIGNAL, gnomAD, dbSNP, MutationAssessor and Cancer Hotspots — stored in the shared public table `annotation.variant`,
// one row per (source, release, variant). Genome Nexus runs one service per reference genome, each with
// its own releases, so each is a source of its own: `genome_nexus` (GRCh37, the studies on hg19) and
// `genome_nexus_grch38` (hg38). The app reads the rows at a pin (lib/variant-annotation.ts).
import { query, sq, type Conn, type Row } from "@cbiolab/clickhouse";
import type { AnnotationSource, Release } from "../source.ts";
import { VARIANT_DDL, VARIANT_TABLE } from "../store.ts";

/** canonical-transcript requests in flight at once */
const CANONICAL_CONCURRENCY = 8;
/** variants per my_variant_info request, and such requests in flight at once */
const MVI_BATCH = Number(process.env.GENOME_NEXUS_MVI_BATCH_SIZE || 25);
const MVI_CONCURRENCY = 4;
const KEY_COLUMNS = ["source", "chr", "start_position", "end_position", "reference_allele", "variant_allele"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/**
 * Which fields a row holds, part of its release: a row stored before a field was added lacks it, so
 * adding one names a new release and the next sync asks for every variant again. 2: gnomAD, dbSNP,
 * MutationAssessor and Cancer Hotspots.
 */
export const GN_FIELD_SET = 2;

/** A request to a Genome Nexus service, retried with backoff on 429 and 5xx; `missing` is the answer to a 404, when one is expected. */
async function gnFetch(base: string, path: string, body?: unknown, attempt = 0, missing?: unknown): Promise<unknown> {
  const res = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await sleep(1000 * 2 ** attempt);
    return gnFetch(base, path, body, attempt + 1, missing);
  }
  if (res.status === 404 && missing !== undefined) return missing;
  if (!res.ok) throw new Error("Genome Nexus " + path.replace(/\?.*/, "") + " -> " + res.status + ": " + (await res.text()).slice(0, 300));
  return res.json();
}

interface GnVersion {
  genomeNexus?: { server?: { version?: string } };
  vep?: { cache?: { version?: string } };
  annotationSourcesInfo?: { id?: string; version?: string }[];
}

/**
 * The release a service's rows are pinned to: its server version, the VEP cache it annotates with and
 * its ClinVar release — what decides the transcripts' consequences and the ClinVar calls. A service that
 * names none of the three has nothing to pin to.
 */
export function gnRelease(v: GnVersion): string {
  const server = v.genomeNexus?.server?.version || "";
  if (!server) throw new Error("Genome Nexus /version named no server version, so there is nothing to pin rows to");
  const clinvar = v.annotationSourcesInfo?.find((s) => s.id === "clinvar")?.version || "NA";
  return server + "-vep" + (v.vep?.cache?.version || "NA") + "-clinvar" + clinvar + "+f" + GN_FIELD_SET;
}

interface GnSummary { transcriptId?: string; hugoGeneSymbol?: string; hgvsc?: string }
interface GnAnnotation {
  originalVariantQuery?: string;
  successfully_annotated?: boolean;
  errorMessage?: string;
  annotation_summary?: { canonicalTranscriptId?: string; transcriptConsequenceSummaries?: GnSummary[] };
  clinvar?: { annotation?: { clinvarId?: number; clinicalSignificance?: string; conflictingClinicalSignificance?: string } | null };
  signalAnnotation?: { annotation?: Record<string, unknown>[] };
  seq_region_name?: string;
  my_variant_info?: { annotation?: MyVariantInfo | null };
  mutation_assessor?: { functionalImpactPrediction?: string | null; functionalImpactScore?: number | null; msa?: string | null } | null;
  hotspots?: { annotation?: Record<string, unknown>[][] } | null;
}
interface GnomadCounts { alleleCount?: unknown; alleleNumber?: unknown; homozygotes?: unknown; alleleFrequency?: unknown }
interface MyVariantInfo {
  gnomadExome?: GnomadCounts | null;
  gnomadGenome?: GnomadCounts | null;
  vcf?: { position?: string; ref?: string; alt?: string } | null;
  dbsnp?: { rsid?: string } | null;
}

/** gnomAD's counts by population, as cBioPortal's gnomAD column reads them (GnomadUtils), and nothing else of the record */
function gnomadCounts(g: GnomadCounts | null | undefined) {
  return g ? { alleleCount: g.alleleCount ?? null, alleleNumber: g.alleleNumber ?? null, homozygotes: g.homozygotes ?? null, alleleFrequency: g.alleleFrequency ?? null } : null;
}

/** How a variant is asked for: the warehouse's own values, with a `chr` prefix dropped, as cBioPortal asks (MutationUtils.extractGenomicLocation). */
function location(k: Row) {
  return { chromosome: String(k.chr).replace("chr", ""), start: Number(k.start_position), end: Number(k.end_position),
    referenceAllele: String(k.reference_allele), variantAllele: String(k.variant_allele) };
}
const queryKey = (l: ReturnType<typeof location>) => [l.chromosome, l.start, l.end, l.referenceAllele, l.variantAllele].join(",");

/** SIGNAL's per-variant entry without the variant's own coordinates, which the row's key already holds. */
function signalEntry(a: Record<string, unknown>): Record<string, unknown> {
  const { chromosome: _c, startPosition: _s, endPosition: _e, referenceAllele: _r, variantAllele: _v, ...rest } = a;
  return rest;
}

/**
 * The stored annotation of one variant. `canonical` maps each gene the warehouse lists the variant under
 * (`genes`) to that gene's canonical transcript: cBioPortal's HGVSc is the consequence on the canonical
 * transcript of the gene the mutation is listed under, looked up by cBioPortal's own symbol, and a variant
 * listed under two genes has two.
 */
export function variantData(a: GnAnnotation | undefined, genes: string[], canonical: Map<string, string | null>): Record<string, unknown> {
  if (!a || !a.successfully_annotated) return { ok: false, error: a?.errorMessage || "Genome Nexus returned no annotation for this variant" };
  const transcripts = a.annotation_summary?.transcriptConsequenceSummaries || [];
  const byGene: Record<string, string> = {};
  for (const g of [...genes].sort()) { const t = canonical.get(g); if (t) byGene[g] = t; }
  const cv = a.clinvar?.annotation;
  const signal = a.signalAnnotation?.annotation?.map(signalEntry) || [];
  const mvi = a.my_variant_info?.annotation;
  const ma = a.mutation_assessor;
  return {
    ok: true,
    variantCanonical: a.annotation_summary?.canonicalTranscriptId || "",
    canonical: byGene,
    transcripts,
    clinvar: cv ? { id: cv.clinvarId ?? null, significance: cv.clinicalSignificance || "", conflicting: cv.conflictingClinicalSignificance || "" } : null,
    ...(signal.length ? { signal } : {}),
    // the chromosome as Genome Nexus names it, for gnomAD's link
    seqRegion: a.seq_region_name || "",
    gnomad: mvi && (mvi.gnomadExome || mvi.gnomadGenome) ? { exome: gnomadCounts(mvi.gnomadExome), genome: gnomadCounts(mvi.gnomadGenome) } : null,
    vcf: mvi?.vcf ? { position: mvi.vcf.position ?? "", ref: mvi.vcf.ref ?? "", alt: mvi.vcf.alt ?? "" } : null,
    rsid: mvi?.dbsnp?.rsid || "",
    // Cancer Hotspots' residues (single residue and 3D) on any of the variant's transcripts, each once
    hotspots: [...new Map((a.hotspots?.annotation || []).flat().map((h) => [JSON.stringify(h), h])).values()],
    mutationAssessor: ma ? { prediction: ma.functionalImpactPrediction ?? null, score: ma.functionalImpactScore ?? null, msa: ma.msa ?? null } : null
  };
}

function makeSource(o: { id: string; label: string; build: "hg19" | "hg38"; baseEnv: string; defaultBase: string }): AnnotationSource {
  const base = () => (process.env[o.baseEnv] || o.defaultBase).replace(/\/+$/, "");
  // each gene's canonical transcript, asked once per sync (null: the service names none)
  const canonical = new Map<string, string | null>();

  /**
   * Each gene's canonical transcript, asked a gene at a time as cBioPortal asks it
   * (fetchCanonicalTranscriptWithFallback): the batch endpoint answers a symbol with a transcript another
   * symbol it was asked also names, and leaves unknown ones out, so its answers cannot be matched back.
   */
  async function canonicalOf(genes: Set<string>): Promise<Map<string, string | null>> {
    const ask = [...genes].filter((g) => !canonical.has(g));
    for (let i = 0; i < ask.length; i += CANONICAL_CONCURRENCY) {
      await Promise.all(ask.slice(i, i + CANONICAL_CONCURRENCY).map(async (g) => {
        const t = await gnFetch(base(), "/ensembl/canonical-transcript/hgnc/" + encodeURIComponent(g) + "?isoformOverrideSource=mskcc", undefined, 0, {}) as { transcriptId?: string };
        canonical.set(g, t.transcriptId || null);
      }));
    }
    return canonical;
  }

  /**
   * myvariant.info's record (gnomAD, dbSNP) of each location, by query key. Genome Nexus drops it for
   * every variant of a request when one variant's record fails it (3:52475300 G>A on GRCh37, for one),
   * answering the request without error; so it is asked in small requests of its own, and a request that
   * comes back with none at all is split and asked again, down to the variant that fails. That variant
   * alone is left without a record.
   */
  async function myVariantInfo(locs: ReturnType<typeof location>[]): Promise<Map<string, MyVariantInfo>> {
    const out = new Map<string, MyVariantInfo>();
    const ask = async (part: ReturnType<typeof location>[]): Promise<void> => {
      const got = await gnFetch(base(), "/annotation/genomic?fields=my_variant_info&isoformOverrideSource=mskcc", part) as GnAnnotation[];
      const found = got.filter((a) => a.originalVariantQuery && a.my_variant_info?.annotation);
      if (!found.length && part.length > 1) {
        const half = Math.ceil(part.length / 2);
        await ask(part.slice(0, half));
        await ask(part.slice(half));
        return;
      }
      for (const a of found) out.set(a.originalVariantQuery!, a.my_variant_info!.annotation!);
    };
    const parts: ReturnType<typeof location>[][] = [];
    for (let i = 0; i < locs.length; i += MVI_BATCH) parts.push(locs.slice(i, i + MVI_BATCH));
    for (let i = 0; i < parts.length; i += MVI_CONCURRENCY) await Promise.all(parts.slice(i, i + MVI_CONCURRENCY).map(ask));
    return out;
  }

  async function annotateLocations(keys: Row[]): Promise<Map<string, GnAnnotation>> {
    const locs = keys.map(location);
    // the GRCh38 service has no SIGNAL
    const fields = "annotation_summary,clinvar,hotspots,mutation_assessor" + (o.build === "hg19" ? ",signal" : "");
    const [out, mvi] = await Promise.all([
      gnFetch(base(), "/annotation/genomic?fields=" + fields + "&isoformOverrideSource=mskcc", locs) as Promise<GnAnnotation[]>,
      myVariantInfo(locs)]);
    const by = new Map<string, GnAnnotation>();
    for (const a of out) if (a.originalVariantQuery) by.set(a.originalVariantQuery, { ...a, my_variant_info: { annotation: mvi.get(a.originalVariantQuery) ?? null } });
    return by;
  }

  const src: AnnotationSource = {
    id: o.id,
    label: o.label,
    table: VARIANT_TABLE,
    versionColumn: "version",
    keyColumns: KEY_COLUMNS,
    writer: "annotation",
    needs: [],
    batchSize: Number(process.env.GENOME_NEXUS_BATCH_SIZE || 200),
    batchDelayMs: Number(process.env.GENOME_NEXUS_BATCH_DELAY_MS || 100),
    ddl: [VARIANT_DDL],

    keySpace(portalDb: string, study: string | null): string {
      const md = portalDb + ".mutation_derived";
      const onBuild = "studyId IN (SELECT cs.cancer_study_identifier FROM " + portalDb + ".cancer_study cs JOIN " + portalDb +
        ".reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id WHERE rg.name = " + sq(o.build) + ")";
      // what cBioPortal can ask about (MutationUtils.hasValidGenomicLocation): every part present, no -1 or NA, not both alleles '-';
      // with the genes the variant is listed under, whose canonical transcripts its HGVSc is read on
      return "SELECT " + sq(o.id) + " AS source, assumeNotNull(chr) AS chr, toString(startPosition) AS start_position, " +
        "toString(endPosition) AS end_position, assumeNotNull(referenceAllele) AS reference_allele, assumeNotNull(tumorSeqAllele) AS variant_allele, " +
        "arrayStringConcat(arraySort(groupUniqArrayIf(`GENE.hugoGeneSymbol`, `GENE.hugoGeneSymbol` != '')), ',') AS genes FROM " + md +
        " WHERE " + (study == null ? "" : "studyId = " + sq(study) + " AND ") + onBuild +
        " AND chr IS NOT NULL AND chr != '' AND startPosition > 0 AND endPosition > 0" +
        " AND referenceAllele NOT IN ('', 'NA') AND tumorSeqAllele NOT IN ('', 'NA') AND NOT (referenceAllele = '-' AND tumorSeqAllele = '-')" +
        " GROUP BY source, chr, start_position, end_position, reference_allele, variant_allele";
    },

    async release(): Promise<Release> {
      return { version: gnRelease(await gnFetch(base(), "/version") as GnVersion), extra: {} };
    },

    async annotate(keys: Row[]): Promise<Row[]> {
      const by = await annotateLocations(keys);
      const genesOf = (k: Row) => String(k.genes ?? "").split(",").filter(Boolean);
      const canon = await canonicalOf(new Set(keys.flatMap(genesOf)));
      return keys.map((k) => ({
        source: o.id, chr: String(k.chr), start_position: Number(k.start_position), end_position: Number(k.end_position),
        reference_allele: String(k.reference_allele), variant_allele: String(k.variant_allele),
        data: JSON.stringify(variantData(by.get(queryKey(location(k))), genesOf(k), canon))
      }));
    },

    async verify(conn: Conn, version: string, n: number) {
      const sample = await query<Row & { data: string }>(conn,
        "SELECT chr, toString(start_position) AS start_position, toString(end_position) AS end_position, reference_allele, variant_allele, data FROM " + VARIANT_TABLE +
        " WHERE source = " + sq(o.id) + " AND version = " + sq(version) + " ORDER BY rand() LIMIT " + Math.max(1, Math.floor(n)));
      const mismatches: string[] = [];
      for (let i = 0; i < sample.length; i += 100) {
        // re-asked under the genes it was stored for
        const batch = sample.slice(i, i + 100).map((r) => ({ ...r, genes: Object.keys(JSON.parse(r.data).canonical || {}).join(",") }));
        const live = await src.annotate(batch);
        batch.forEach((r, j) => {
          const a = JSON.parse(r.data), b = JSON.parse(String(live[j].data));
          for (const [what, x, y] of [["HGVSc", hgvscs(a), hgvscs(b)], ["ClinVar", a.clinvar?.significance, b.clinvar?.significance],
            ["SIGNAL", JSON.stringify(a.signal ?? null), JSON.stringify(b.signal ?? null)],
            ["gnomAD", JSON.stringify(a.gnomad ?? null), JSON.stringify(b.gnomad ?? null)], ["dbSNP", a.rsid ?? "", b.rsid ?? ""],
            ["MutationAssessor", JSON.stringify(a.mutationAssessor ?? null), JSON.stringify(b.mutationAssessor ?? null)],
            ["Cancer Hotspots", JSON.stringify(a.hotspots ?? []), JSON.stringify(b.hotspots ?? [])]] as const)
            if (x !== y) mismatches.push(queryKey(location(r)) + " " + what + ": stored " + String(x) + ", live " + String(y));
        });
      }
      return { checked: sample.length, mismatches };
    }
  };
  return src;
}

/** a stored annotation's HGVSc on each gene's canonical transcript, for comparing two of them */
function hgvscs(d: { canonical?: Record<string, string>; transcripts?: GnSummary[] }): string {
  return Object.entries(d.canonical || {}).sort().map(([g, t]) => g + "=" + (d.transcripts?.find((x) => x.transcriptId === t)?.hgvsc || "")).join(";");
}

export const genomeNexusSource = makeSource({ id: "genome_nexus", label: "Genome Nexus (GRCh37)", build: "hg19",
  baseEnv: "GENOME_NEXUS_BASE", defaultBase: "https://v1.genomenexus.org" });
export const genomeNexusGrch38Source = makeSource({ id: "genome_nexus_grch38", label: "Genome Nexus (GRCh38)", build: "hg38",
  baseEnv: "GENOME_NEXUS_GRCH38_BASE", defaultBase: "https://grch38.genomenexus.org" });
