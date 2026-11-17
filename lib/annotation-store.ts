// Where the app reads annotations: the one `annotation` database every source's offline sync fills
// (docs/ANNOTATION.md). The app never imports the sync (@cbiolab/annotation-sync); these names are
// its own, and test/annotation-store.test.ts holds them to the sync's.

import { sq } from "./compiler.ts";

/** OncoKB, licensed: a reader is licensed by SELECT on this table, and degrades loudly without it */
export const ONCOKB_TABLE = "annotation.oncokb";
/**
 * OncoKB by tumour type, licensed with ONCOKB_TABLE: one row per (gene, protein change, mutation
 * type, tumour type) of a synced study, with the levels of evidence for that tumour type
 */
export const ONCOKB_TUMOR_TYPE_TABLE = "annotation.oncokb_tumor_type";
/**
 * OncoKB for structural variants, licensed with ONCOKB_TABLE: one row per (site 1 Entrez id, site 2
 * Entrez id, OncoKB SV type, tumour type) of a synced study, each id '' where its site names no gene
 */
export const ONCOKB_SV_TABLE = "annotation.oncokb_sv";
/**
 * OncoKB's cancer gene list, licensed with ONCOKB_TABLE: one row per gene of the portal's gene table at
 * each release, `cancer_gene` whether the list has it, `oncokb_annotated` whether OncoKB curates it
 */
export const ONCOKB_CANCER_GENE_TABLE = "annotation.oncokb_cancer_gene";
/**
 * The Entrez ids (`entrez`, UInt32) of OncoKB's cancer genes at the pin, as SQL — the portal's
 * isOncoKbCancerGene. A reader asks oncokbCancerGenesCompleteSql first and, unless the pin's list is
 * complete, leaves the cancer-gene part out and says so, rather than reading a gene not stored as not
 * a cancer gene.
 */
export const oncokbCancerGeneSql = (pin: string): string =>
  "SELECT toUInt32(entrez_gene_id) AS entrez FROM " + ONCOKB_CANCER_GENE_TABLE + " FINAL WHERE oncokb_version = " + sq(pin) + " AND cancer_gene";
/**
 * Whether the pin's cancer gene list is complete, as SQL (`complete` 1 or 0): the latest portal-wide run
 * of its sync at the pin left no gene unstored (lib/annotation-sync syncStudies' "complete" note); runs in one
 * second are ordered by their run id, a millisecond timestamp. Rows
 * present without such a run are a partial sync, so not complete.
 */
export const oncokbCancerGenesCompleteSql = (pin: string): string =>
  "SELECT toUInt8(count() > 0 AND argMax(note, (finished_at, run_id)) = 'complete') AS complete FROM " + SYNC_RUN_TABLE +
  " WHERE source = 'oncokb_cancer_gene' AND version = " + sq(pin) + " AND study = '__portal__' AND finished_at IS NOT NULL";
/** every public source's annotations, one row per (source, release, variant), the source's JSON in `data` */
export const VARIANT_TABLE = "annotation.variant";
/** Genome Nexus's source in VARIANT_TABLE for each reference genome (one service, and one release line, per genome) */
export const GENOME_NEXUS_SOURCES = { hg19: "genome_nexus", hg38: "genome_nexus_grch38" } as const;
/** every source's sync runs, by `source`; which studies a release covers */
export const SYNC_RUN_TABLE = "annotation.sync_run";

/** the studies a source's syncs have covered, as SQL: studies whose keys some run annotated or found stored */
export function syncedStudiesSql(source: string): string {
  return "SELECT DISTINCT study FROM " + SYNC_RUN_TABLE + " WHERE source = '" + source.replace(/[^a-z0-9_]/g, "") + "' AND (annotated_new > 0 OR already_stored > 0)";
}
