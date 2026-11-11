// OncoKB: mutations by protein change and gene-level copy-number calls, resolved against the OncoKB
// API and stored in `oncokb_annotation`, a database of its own because OncoKB is licensed: a reader
// is licensed by GRANT SELECT on it and the portal import never writes there. lib/annotation.ts and
// the DRIVER / annotation SQL read it at the pin.
import { query, sq, type Conn, type Row } from "@cbiolab/clickhouse";
import type { AnnotationSource, Release } from "../source.ts";

const base = () => (process.env.ONCOKB_BASE || "https://www.oncokb.org/api/v1").replace(/\/+$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A request to the OncoKB API with the licence token, retried with backoff on 429 and 5xx. */
export async function oncokbFetch(path: string, body?: unknown, attempt = 0): Promise<unknown> {
  const res = await fetch(base() + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: "Bearer " + (process.env.ONCOKB_TOKEN || ""), "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await sleep(1000 * 2 ** attempt);
    return oncokbFetch(path, body, attempt + 1);
  }
  if (!res.ok) throw new Error("OncoKB " + path + " -> " + res.status + ": " + (await res.text()).slice(0, 300));
  return res.json();
}

interface OncokbAnnotation { oncogenic?: string; mutationEffect?: { knownEffect?: string }; highestSensitiveLevel?: string; highestResistanceLevel?: string }

function pick(a: OncokbAnnotation | undefined): Row {
  return {
    oncogenicity: a?.oncogenic || "Unknown",
    mutation_effect: a?.mutationEffect?.knownEffect || "",
    highest_sensitive_level: a?.highestSensitiveLevel || "",
    highest_resistance_level: a?.highestResistanceLevel || ""
  };
}

/** Mutations by protein change: `[{gene, alteration}]` → their annotations, in the same order. */
export async function annotateMutations(variants: { gene: string; alteration: string }[]): Promise<Row[]> {
  const out = await oncokbFetch("/annotate/mutations/byProteinChange",
    variants.map((v) => ({ gene: { hugoSymbol: v.gene }, alteration: v.alteration }))) as OncokbAnnotation[];
  return variants.map((_, i) => pick(out[i]));
}

async function annotateCnas(cnas: { gene: string; alteration: string }[]): Promise<Row[]> {
  const out = await oncokbFetch("/annotate/copyNumberAlterations",
    cnas.map((c) => ({ gene: { hugoSymbol: c.gene }, copyNameAlterationType: c.alteration }))) as OncokbAnnotation[];
  return cnas.map((_, i) => pick(out[i]));
}

export const oncokbSource: AnnotationSource = {
  id: "oncokb",
  label: "OncoKB",
  db: "oncokb_annotation",
  table: "variant_annotation",
  versionColumn: "oncokb_version",
  keyColumns: ["alteration_type", "hugo_gene_symbol", "alteration"],
  needs: ["ONCOKB_TOKEN"],
  batchSize: Number(process.env.ONCOKB_BATCH_SIZE || 250),
  batchDelayMs: Number(process.env.ONCOKB_BATCH_DELAY_MS || 300),
  ddl: [
    "CREATE DATABASE IF NOT EXISTS oncokb_annotation",
    // Rows are partitioned by release and never overwritten: a figure pinned to a release
    // re-renders against it for good, and retiring one is DROP PARTITION.
    "CREATE TABLE IF NOT EXISTS oncokb_annotation.variant_annotation (oncokb_version LowCardinality(String), " +
      "alteration_type Enum8('MUTATION' = 1, 'CNA' = 2, 'SV' = 3), hugo_gene_symbol LowCardinality(String), alteration String, " +
      "oncogenicity LowCardinality(String), mutation_effect LowCardinality(String), highest_sensitive_level LowCardinality(String), " +
      "highest_resistance_level LowCardinality(String), is_driver Bool MATERIALIZED oncogenicity IN ('Oncogenic', 'Likely Oncogenic', 'Resistance'), " +
      "api_version LowCardinality(String), resolved_at DateTime DEFAULT now()) ENGINE = ReplacingMergeTree(resolved_at) " +
      "PARTITION BY oncokb_version ORDER BY (oncokb_version, alteration_type, hugo_gene_symbol, alteration)",
    "CREATE TABLE IF NOT EXISTS oncokb_annotation.sync_run (run_id String, started_at DateTime, finished_at Nullable(DateTime), " +
      "oncokb_version LowCardinality(String), study LowCardinality(String), variants_total UInt32, already_stored UInt32, " +
      "annotated_new UInt32, failed UInt32, note String) ENGINE = MergeTree ORDER BY started_at"
  ],

  keySpace(portalDb: string, study: string | null): string {
    const ged = portalDb + ".genomic_event_derived";
    const only = study == null ? "" : "cancer_study_identifier = " + sq(study) + " AND ";
    return "SELECT DISTINCT 'MUTATION' AS alteration_type, hugo_gene_symbol, mutation_variant AS alteration FROM " + ged +
      " WHERE " + only + "variant_type = 'mutation' AND mutation_variant != ''\n" +
      "UNION ALL\n" +
      "SELECT DISTINCT 'CNA' AS alteration_type, hugo_gene_symbol, if(cna_alteration >= 2, 'AMPLIFICATION', 'DELETION') AS alteration FROM " + ged +
      " WHERE " + only + "variant_type = 'cna' AND abs(cna_alteration) >= 2";
  },

  async release(): Promise<Release> {
    const info = await oncokbFetch("/info") as { dataVersion?: { version?: string } | string; apiVersion?: { version?: string } | string };
    const dv = info?.dataVersion, av = info?.apiVersion;
    const version = String((typeof dv === "object" ? dv?.version : dv) || "");
    if (!version) throw new Error("OncoKB /info named no data version, so there is nothing to pin rows to");
    return { version, extra: { api_version: String((typeof av === "object" ? av?.version : av) || "") } };
  },

  async annotate(keys: Row[]): Promise<Row[]> {
    const of = (t: string) => keys.filter((k) => k.alteration_type === t).map((k) => ({ gene: String(k.hugo_gene_symbol), alteration: String(k.alteration) }));
    const muts = of("MUTATION"), cnas = of("CNA");
    const rows: Row[] = [];
    if (muts.length) (await annotateMutations(muts)).forEach((a, i) => rows.push({ alteration_type: "MUTATION", hugo_gene_symbol: muts[i].gene, alteration: muts[i].alteration, ...a }));
    if (cnas.length) (await annotateCnas(cnas)).forEach((a, i) => rows.push({ alteration_type: "CNA", hugo_gene_symbol: cnas[i].gene, alteration: cnas[i].alteration, ...a }));
    return rows;
  },

  async verify(conn: Conn, version: string, n: number) {
    const sample = await query<{ gene: string; alteration: string; oncogenicity: string; mutation_effect: string }>(conn,
      "SELECT hugo_gene_symbol AS gene, alteration, oncogenicity, mutation_effect FROM oncokb_annotation.variant_annotation" +
      " WHERE oncokb_version = " + sq(version) + " AND alteration_type = 'MUTATION' ORDER BY rand() LIMIT " + Math.max(1, Math.floor(n)));
    const mismatches: string[] = [];
    for (let i = 0; i < sample.length; i += 100) {
      const batch = sample.slice(i, i + 100);
      const live = await annotateMutations(batch);
      batch.forEach((r, j) => {
        if (live[j].oncogenicity !== r.oncogenicity || live[j].mutation_effect !== r.mutation_effect)
          mismatches.push(r.gene + " " + r.alteration + ": stored " + r.oncogenicity + "/" + r.mutation_effect + ", live " + String(live[j].oncogenicity) + "/" + String(live[j].mutation_effect));
      });
    }
    return { checked: sample.length, mismatches };
  }
};
