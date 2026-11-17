// OncoKB's cancer gene list (GET /utils/cancerGeneList), stored per release in
// `annotation.oncokb_cancer_gene` (sql/006), licensed like `annotation.oncokb` and written by the same
// writer. cBioPortal reads the list for two things: whether a gene is an OncoKB cancer gene at all
// (any entry: react-mutation-mapper Annotation.tsx 170-187, the last element of the Annotation sort,
// and Study View's gene-table icon) and whether OncoKB curates it (`oncokbAnnotated`).
//
// The list is one request, not a key per query; its key space is the genes the warehouse's alterations
// name, so each gets a row at the release, `cancer_gene` false for one not listed, and the sync does not
// pick it up again. `data` is the list's entry for the gene as JSON ('' for one not listed).
import { sq, type Row } from "@cbiolab/clickhouse";
import type { AnnotationSource } from "../source.ts";
import { oncokbFetch, oncokbSource } from "./oncokb.ts";

export const ONCOKB_CANCER_GENE_TABLE = "annotation.oncokb_cancer_gene";

/** an entry of OncoKB's cancer gene list, the fields this store keeps */
export interface CancerGene {
  entrezGeneId: number; hugoSymbol?: string; oncokbAnnotated?: boolean; occurrenceCount?: number;
  oncogene?: boolean; tsg?: boolean; geneType?: string;
}

let list: Promise<Map<number, CancerGene>> | null = null;
/** OncoKB's cancer gene list by Entrez id, asked once per process. */
export function cancerGeneList(): Promise<Map<number, CancerGene>> {
  list ??= (oncokbFetch("/utils/cancerGeneList") as Promise<CancerGene[]>).then((genes) => {
    if (!Array.isArray(genes) || !genes.length) throw new Error("OncoKB's cancer gene list came back empty: nothing to store");
    return new Map(genes.filter((g) => Number.isInteger(g?.entrezGeneId)).map((g) => [g.entrezGeneId, g]));
  }).catch((e: unknown) => {
    // a failed request is not the list: the next batch asks again rather than failing on this one's answer
    list = null;
    throw e;
  });
  return list;
}
/** for tests: forget the list asked for */
export function resetCancerGeneList(): void { list = null; }

/** The stored row for one gene: its entry in the list, or a row saying it is not listed. */
export function cancerGeneRow(entrez: string, g: CancerGene | undefined): Row {
  const type = (g?.geneType || "").toUpperCase();
  return {
    entrez_gene_id: entrez,
    hugo_symbol: g?.hugoSymbol || "",
    cancer_gene: !!g,
    oncokb_annotated: !!g?.oncokbAnnotated,
    is_oncogene: !!g && (g.oncogene ?? type.includes("ONCOGENE")),
    is_tsg: !!g && (g.tsg ?? type.includes("TSG")),
    occurrence_count: g && Number.isFinite(g.occurrenceCount) ? Number(g.occurrenceCount) : 0,
    data: g ? JSON.stringify(g) : ""
  };
}

export const oncokbCancerGeneSource: AnnotationSource = {
  id: "oncokb_cancer_gene",
  label: "OncoKB cancer gene list",
  table: ONCOKB_CANCER_GENE_TABLE,
  versionColumn: "oncokb_version",
  keyColumns: ["entrez_gene_id"],
  writer: "oncokb",
  needs: ["ONCOKB_TOKEN"],
  batchSize: 5000,
  batchDelayMs: 0,
  ddl: [
    "CREATE TABLE IF NOT EXISTS " + ONCOKB_CANCER_GENE_TABLE + " (oncokb_version LowCardinality(String), entrez_gene_id String, hugo_symbol String, " +
      "cancer_gene Bool, oncokb_annotated Bool, is_oncogene Bool, is_tsg Bool, occurrence_count UInt16, data String CODEC(ZSTD(3)), " +
      "api_version LowCardinality(String), resolved_at DateTime DEFAULT now()) ENGINE = ReplacingMergeTree(resolved_at) " +
      "PARTITION BY oncokb_version ORDER BY (oncokb_version, entrez_gene_id)"
  ],
  // the genes the study's alterations name (every study's, for the portal-wide count), so a study's run
  // stores only its own and the next finds them stored; the column qualified, as an alias shadows it in WHERE
  keySpace: (portalDb: string, study: string | null) =>
    "SELECT DISTINCT toString(g.entrez_gene_id) AS entrez_gene_id FROM " + portalDb + ".genomic_event_derived AS g WHERE g.entrez_gene_id > 0" +
    (study == null ? "" : " AND g.cancer_study_identifier = " + sq(study)),
  release: () => oncokbSource.release(),

  async annotate(keys: Row[]): Promise<Row[]> {
    const genes = await cancerGeneList();
    return keys.map((k) => cancerGeneRow(String(k.entrez_gene_id), genes.get(Number(k.entrez_gene_id))));
  }
};
