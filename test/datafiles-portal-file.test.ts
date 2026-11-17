// The Download tab's gene-by-sample files in the legacy portal's own formats
// (docs/legacy-spec/10-results-download.md RDL-1.1–1.5, RDL-1.9, RDL-STM-4; DownloadUtils generateDownloadData).
//
// | case | what                                                                                   |
// |------|----------------------------------------------------------------------------------------|
// | F1   | Tab Delimited: header STUDY_ID, SAMPLE_ID, genes; one line per row; \t and \n joins     |
// | F2   | Tab Delimited: no trailing newline, nothing quoted or escaped (a spaced cell stays)    |
// | F3   | Transposed: STUDY_ID line, SAMPLE_ID line, then one line per gene with its cells       |
// | F4   | Transposed: no trailing newline, nothing quoted                                        |
// | F5   | Zero rows, plain: the header line alone                                                |
// | F6   | Zero rows, transposed: a single column STUDY_ID\nSAMPLE_ID\n<gene>…                    |
// | F7   | fileList portalFile: mutations → mutations.txt, sv → structural_variants.txt           |
// | F8   | fileList portalFile: the first discrete CNA profile in list order → cna.txt; a second → its name + ".txt" |
// | F9   | fileList portalFile: other profiles → name + ".txt"                                    |
// | F10  | fileList portalFile: a profile with no name → profile id + ".txt"                      |
// | F11  | SV matrix joins every record's events (duplicates kept, groupArray) with a single space |
// | F12  | portalDisposition: attachment; filename="<ascii>"; filename*=UTF-8''<encoded>   |
import { test } from "node:test";
import assert from "node:assert/strict";
import { portalMatrix, portalDisposition } from "../lib/views/datafiles/portal-file.ts";
import { fileList } from "../lib/views/datafiles/run.ts";
import { matrixRowSource } from "../lib/views/datafiles/tables.ts";
import type { ProfileInfo } from "../lib/profile-catalog.ts";

const genes = ["TP53", "KRAS"];
const rows = [
  { study: "brca", sample: "S1", values: ["R175H", "G12D G13D"] },
  { study: "luad", sample: "S2", values: ["", "NA"] },
];

test("F1 tab delimited: header then one line per row", () => {
  const lines = portalMatrix(genes, rows, false).split("\n");
  assert.deepEqual(lines, ["STUDY_ID\tSAMPLE_ID\tTP53\tKRAS", "brca\tS1\tR175H\tG12D G13D", "luad\tS2\t\tNA"]);
});

test("F2 tab delimited: no trailing newline, nothing quoted", () => {
  const out = portalMatrix(genes, rows, false);
  assert.equal(out, "STUDY_ID\tSAMPLE_ID\tTP53\tKRAS\nbrca\tS1\tR175H\tG12D G13D\nluad\tS2\t\tNA");
  assert.ok(!out.endsWith("\n"));
  assert.ok(!out.includes('"'));
});

test("F3 transposed: study line, sample line, one line per gene", () => {
  const lines = portalMatrix(genes, rows, true).split("\n");
  assert.deepEqual(lines, ["STUDY_ID\tbrca\tluad", "SAMPLE_ID\tS1\tS2", "TP53\tR175H\t", "KRAS\tG12D G13D\tNA"]);
});

test("F4 transposed: no trailing newline, nothing quoted", () => {
  const out = portalMatrix(genes, rows, true);
  assert.equal(out, "STUDY_ID\tbrca\tluad\nSAMPLE_ID\tS1\tS2\nTP53\tR175H\t\nKRAS\tG12D G13D\tNA");
  assert.ok(!out.includes('"'));
});

test("F5 zero rows, plain: the header line alone", () => {
  assert.equal(portalMatrix(genes, [], false), "STUDY_ID\tSAMPLE_ID\tTP53\tKRAS");
});

test("F6 zero rows, transposed: a single column", () => {
  assert.equal(portalMatrix(genes, [], true), "STUDY_ID\nSAMPLE_ID\nTP53\nKRAS");
});

const p = (profile: string, type: string, datatype: string, order: number, name = profile + " name"): ProfileInfo => ({ profile, type, datatype, name, order });
const catalog: ProfileInfo[] = [
  p("mutations", "MUTATION_EXTENDED", "MAF", 0),
  p("gistic", "COPY_NUMBER_ALTERATION", "DISCRETE", 1, "Putative copy-number alterations from GISTIC"),
  p("rae", "COPY_NUMBER_ALTERATION", "DISCRETE", 5, "Putative copy-number from RAE"),
  p("rna_z", "MRNA_EXPRESSION", "Z-SCORE", 2, "mRNA expression z-scores relative to all samples (log RNA Seq V2 RSEM)"),
  p("rppa", "PROTEIN_LEVEL", "LOG2-VALUE", 3, ""),
  p("structural_variants", "STRUCTURAL_VARIANT", "SV", 4),
];
const files = () => fileList({ a: catalog }, ["a"]) as { id: string; portalFile?: string }[];
const portalFile = (id: string) => files().find((f) => f.id === id)?.portalFile;

test("F7 portalFile: mutations and structural variants", () => {
  assert.equal(portalFile("mutations"), "mutations.txt");
  assert.equal(portalFile("sv"), "structural_variants.txt");
});

test("F8 portalFile: only the first discrete copy-number profile is cna.txt; a second is its name", () => {
  assert.equal(portalFile("profile:gistic"), "cna.txt");
  assert.equal(portalFile("profile:rae"), "Putative copy-number from RAE.txt");
});

test("F9 portalFile: any other profile is its name plus .txt", () => {
  assert.equal(portalFile("profile:rna_z"), "mRNA expression z-scores relative to all samples (log RNA Seq V2 RSEM).txt");
});

test("F10 portalFile: a profile with no name is its id plus .txt", () => {
  assert.equal(portalFile("profile:rppa"), "rppa.txt");
});

test("F11 sv matrix joins every record's event info, duplicates kept, with a single space", () => {
  const parts = [{ cohort: "C", study: "s", cohortSql: "SELECT pid, sid FROM x" }];
  const sql = matrixRowSource({ kind: "sv" }, parts, ["TP53"], "d").with;
  assert.ok(sql.includes("arrayStringConcat(arraySort(groupArray(sv_event_info)), ' ')"), sql);
});

test("F12 portalDisposition: ascii fallback and RFC 5987 filename*", () => {
  const n = "mRNA Expression, RSEM (Batch normalized from Illumina HiSeq_RNASeqV2).txt";
  assert.equal(portalDisposition(n),
    `attachment; filename="${n}"; filename*=UTF-8''mRNA%20Expression%2C%20RSEM%20%28Batch%20normalized%20from%20Illumina%20HiSeq_RNASeqV2%29.txt`);
  assert.equal(portalDisposition("Protéines.txt"), `attachment; filename="Prot_ines.txt"; filename*=UTF-8''Prot%C3%A9ines.txt`);
  assert.equal(portalDisposition(`a"b\\c'*.txt`), `attachment; filename="a_b_c'*.txt"; filename*=UTF-8''a%22b%5Cc%27%2A.txt`);
});
