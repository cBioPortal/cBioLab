// Where the app reads annotations: the one `annotation` database every source's offline sync fills
// (docs/ANNOTATION.md). The app never imports the sync (@cbiolab/annotation-sync); these names are
// its own, and test/annotation-store.test.ts holds them to the sync's.

/** OncoKB, licensed: a reader is licensed by SELECT on this table, and degrades loudly without it */
export const ONCOKB_TABLE = "annotation.oncokb";
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
