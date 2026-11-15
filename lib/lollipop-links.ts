// The links beside a lollipop that depend on the study's reference genome. Browser-safe: the page
// builds the transcript's links from the result.

/**
 * Whether a lollipop's studies are all on GRCh38, as the portal decides which Genome Nexus and
 * Ensembl to use (cbioportal-frontend cd8c6df src/shared/lib/StoreUtils.ts getGenomeBuildFromStudies):
 * every study's reference genome matches /GRCh38/i or /hg38/i; otherwise, a mix included, GRCh37.
 */
export const allGrch38 = (builds: string[]): boolean => builds.length > 0 && builds.every((b) => /grch38|hg38/i.test(b));

/**
 * An Ensembl transcript's page on the study's build, as the portal's ensembl_transcript_url and
 * ensembl_transcript_grch38_url (serverConfigDefaults.ts) give it: grch37.ensembl.org for GRCh37,
 * ensembl.org for GRCh38, the id without its version.
 */
export function ensemblTranscriptUrl(id: string, grch38: boolean): string {
  return (grch38 ? "https://www.ensembl.org" : "https://grch37.ensembl.org") + "/homo_sapiens/Transcript/Summary?t=" +
    encodeURIComponent(id.replace(/\.\d+$/, ""));
}
