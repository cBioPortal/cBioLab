// The transcript's Ensembl link on the study's build (lib/lollipop-links.ts), case by case from the
// portal's rule: cbioportal-frontend cd8c6df src/shared/lib/StoreUtils.ts getGenomeBuildFromStudies
// (GRCh38 when every study's referenceGenome matches /GRCh38/i or /hg38/i), AnalysisStore.ts
// ensemblLink and serverConfigDefaults.ts ensembl_transcript_url / ensembl_transcript_grch38_url.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { allGrch38, ensemblTranscriptUrl } from "../lib/lollipop-links.ts";

describe("lollipop: the Ensembl link follows the study's reference genome", () => {
  test("E1 one GRCh38 study, by either name and in any case", () => {
    for (const b of ["hg38", "GRCh38", "grch38", "HG38"]) assert.equal(allGrch38([b]), true, b);
  });
  test("E2 GRCh37 studies, an unknown build, and a mix of builds are GRCh37", () => {
    assert.equal(allGrch38(["hg19"]), false);
    assert.equal(allGrch38(["GRCh37"]), false);
    assert.equal(allGrch38([""]), false, "a study whose build could not be read");
    assert.equal(allGrch38(["hg38", "hg19"]), false, "every study must be GRCh38");
    assert.equal(allGrch38(["hg38", "GRCh38"]), true);
  });
  test("E3 the link: grch37.ensembl.org or ensembl.org, the id without its version", () => {
    assert.equal(ensemblTranscriptUrl("ENST00000311936.3", false), "https://grch37.ensembl.org/homo_sapiens/Transcript/Summary?t=ENST00000311936");
    assert.equal(ensemblTranscriptUrl("ENST00000311936.3", true), "https://www.ensembl.org/homo_sapiens/Transcript/Summary?t=ENST00000311936");
  });
});
