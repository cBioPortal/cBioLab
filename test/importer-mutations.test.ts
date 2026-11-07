// The MAF and structural-variant importers checked against the legacy importer's rules as the
// import notes state them (docs/importer/legacy-java-importer.md §G1, G2, G5, M1–M13, V1–V4 and the
// reference-genome summary; README §A/§B). Expected values come from those notes, not from the
// code: a case the importer gets wrong is kept as a `todo` naming the rule it breaks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeCh, genes, importContext, dataFile } from "./support/fake-ch.ts";
import type { ImportContext, FileReport } from "../lib/importer/context.ts";
import type { Meta } from "../lib/importer/study.ts";
import {
  alleleCounts, annotateProteinChange, filteredClassification, filteredStatus, importMutations, mafChromosome,
  proteinChange, proteinPositions, tumorAllele, type CountColumns
} from "../lib/importer/mutations.ts";
import { mutationKeyword } from "../lib/importer/mutation-keyword.ts";
import { importStructuralVariants } from "../lib/importer/other.ts";

type Rows = Record<string, unknown>[];
type Cells = Record<string, string>;

// TP53/P53 is a unique alias; MLL2 is an alias of both KMT2D and KMT2C (ambiguous, but in the
// disambiguation file as 8085); CDKN2 is ambiguous and not in it.
const GENES: [number, string, string[]?][] = [
  [7157, "TP53", ["P53"]], [3845, "KRAS"], [7015, "TERT"], [1956, "EGFR"], [673, "BRAF"],
  [8085, "KMT2D", ["MLL2"]], [58508, "KMT2C", ["MLL2"]], [1029, "CDKN2A", ["CDKN2"]], [1030, "CDKN2B", ["CDKN2"]]
];

const MAF_BASE: Cells = {
  Hugo_Symbol: "TP53", Entrez_Gene_Id: "7157", Center: "BI", NCBI_Build: "GRCh37", Chromosome: "17",
  Start_Position: "7578406", End_Position: "7578406", Strand: "+", Variant_Classification: "Missense_Mutation",
  Reference_Allele: "C", Tumor_Seq_Allele1: "C", Tumor_Seq_Allele2: "T", Tumor_Sample_Barcode: "S1",
  Mutation_Status: "Somatic", Validation_Status: "Unknown", Sequencer: "Illumina", HGVSp_Short: "p.R175H",
  Amino_Acid_Change: "", Protein_position: "175/393"
};

function table(base: Cells, rows: Cells[], drop: string[] = []): string {
  const cols = [...new Set([...Object.keys(base), ...rows.flatMap((r) => Object.keys(r))])].filter((c) => !drop.includes(c));
  return [cols.join("\t"), ...rows.map((r) => cols.map((c) => r[c] ?? base[c] ?? "").join("\t"))].join("\n") + "\n";
}

interface Run { ctx: ImportContext; report: FileReport; mutations: Rows; events: Rows; tables: Record<string, Rows> }

async function runMaf(rows: Cells[], opts: { meta?: Meta; comments?: string[]; drop?: string[]; setup?: (ctx: ImportContext) => void; answer?: [RegExp, Rows] } = {}): Promise<Run> {
  const ch = fakeCh();
  try {
    if (opts.answer) ch.answer(...opts.answer);
    const ctx = await importContext(ch, { genes: genes(GENES) });
    opts.setup?.(ctx);
    const text = (opts.comments ?? []).map((c) => c + "\n").join("") + table(MAF_BASE, rows, opts.drop);
    await importMutations(ctx, dataFile("mutations", text, { stable_id: "mutations", ...opts.meta }), 1);
    const tables = Object.fromEntries(ch.tables().map((t) => [t, ch.rows(t)]));
    return { ctx, report: ctx.reports.at(-1)!, mutations: ch.rows("mutation"), events: ch.rows("mutation_event"), tables };
  } finally {
    ch.restore();
  }
}

/** The stored (event, mutation) pairs, joined on the event id. */
function stored(r: Run): { e: Record<string, unknown>; m: Record<string, unknown> }[] {
  return r.mutations.map((m) => ({ m, e: r.events.find((e) => e.mutation_event_id === m.mutation_event_id)! }));
}

const skippedTotal = (r: FileReport) => Object.values(r.skipped).reduce((a, b) => a + b, 0);
const skippedFor = (r: FileReport, re: RegExp) => Object.entries(r.skipped).filter(([k]) => re.test(k)).reduce((a, [, n]) => a + n, 0);

const sampleOf = (ctx: ImportContext, id: string) => ctx.samples.get(id)?.id;

// ---------------------------------------------------------------- G: MAF gene resolution

test("G1: a present, non-zero Entrez id that is unknown, non-numeric or negative drops the row (no Hugo fallback)", async () => {
  const r = await runMaf([
    { Entrez_Gene_Id: "99999999" },
    { Entrez_Gene_Id: "abc", Start_Position: "2", End_Position: "2" },
    { Entrez_Gene_Id: "-7157", Start_Position: "3", End_Position: "3" },
    { Hugo_Symbol: "EGFR", Entrez_Gene_Id: "7157", Start_Position: "4", End_Position: "4" }
  ]);
  assert.equal(r.report.read, 4);
  assert.equal(r.report.stored, 1);
  assert.equal(skippedTotal(r.report), 3);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].entrez_gene_id, 7157, "a known Entrez id wins over a disagreeing symbol");
  assert.equal(r.mutations[0].entrez_gene_id, 7157);
});

test("G2: Entrez empty or 0 falls back to the Hugo symbol (any case), then a unique alias, stored as the canonical gene", async () => {
  const r = await runMaf([
    { Hugo_Symbol: "tp53", Entrez_Gene_Id: "", Tumor_Sample_Barcode: "S1" },
    { Hugo_Symbol: "KRAS", Entrez_Gene_Id: "0", Tumor_Sample_Barcode: "S2", HGVSp_Short: "p.G12D", Chromosome: "12" },
    { Hugo_Symbol: "P53", Entrez_Gene_Id: "0", Tumor_Sample_Barcode: "S3" }
  ]);
  assert.equal(r.report.stored, 3);
  const bySample = Object.fromEntries(stored(r).map((x) => [x.m.sample_id, x.e.entrez_gene_id]));
  assert.equal(bySample[sampleOf(r.ctx, "S1")!], 7157);
  assert.equal(bySample[sampleOf(r.ctx, "S2")!], 3845);
  assert.equal(bySample[sampleOf(r.ctx, "S3")!], 7157, "a unique alias resolves to its gene's Entrez id");
});

test("G2: a numeric Hugo_Symbol with no Entrez column value is read as an Entrez id", async () => {
  const r = await runMaf([{ Hugo_Symbol: "3845", Entrez_Gene_Id: "", HGVSp_Short: "p.G12D", Chromosome: "12" }]);
  assert.equal(r.report.stored, 1);
  assert.equal(r.events[0].entrez_gene_id, 3845);
});

test("G2: an ambiguous alias drops the row unless the disambiguation file names it (case-sensitively)", async () => {
  const r = await runMaf([
    { Hugo_Symbol: "MLL2", Entrez_Gene_Id: "", Tumor_Sample_Barcode: "S1" },
    { Hugo_Symbol: "CDKN2", Entrez_Gene_Id: "", Tumor_Sample_Barcode: "S2" },
    { Hugo_Symbol: "mll2", Entrez_Gene_Id: "", Tumor_Sample_Barcode: "S3" }
  ]);
  assert.equal(r.report.stored, 1);
  assert.equal(r.events[0].entrez_gene_id, 8085);
  assert.equal(r.mutations[0].sample_id, sampleOf(r.ctx, "S1"));
  assert.equal(skippedTotal(r.report), 2);
});

test("G2: Hugo_Symbol 'Unknown' with Entrez 0 or no Entrez column is dropped and counted as IGR, whatever its classification", async () => {
  const a = await runMaf([{ Hugo_Symbol: "Unknown", Entrez_Gene_Id: "0", Variant_Classification: "Missense_Mutation" }]);
  assert.equal(a.report.stored, 0);
  assert.equal(skippedFor(a.report, /IGR|intergenic/i), 1, JSON.stringify(a.report.skipped));
  const b = await runMaf([{ Hugo_Symbol: "Unknown", Variant_Classification: "Nonsense_Mutation" }], { drop: ["Entrez_Gene_Id"] });
  assert.equal(b.report.stored, 0);
  assert.equal(skippedFor(b.report, /IGR|intergenic/i), 1, JSON.stringify(b.report.skipped));
});

// ---------------------------------------------------------------- M1–M3: which rows are kept

test("M1: default filter drops Silent/Intron/3'UTR/3'Flank/5'UTR/IGR by case-insensitive prefix; Splice_Region etc. are kept", async () => {
  const drop = ["SILENT", "Intron_Variant", "3'UTR", "3'flank", "5'UTR", "IGR"];
  const keep = ["Splice_Region", "Targeted_Region", "De_novo_Start_InFrame", "Nonsense_Mutation"];
  const r = await runMaf([...drop, ...keep].map((vc, i) => ({ Variant_Classification: vc, Start_Position: String(1000 + i), End_Position: String(1000 + i) })));
  assert.equal(r.report.read, drop.length + keep.length);
  assert.equal(r.report.stored, keep.length);
  assert.deepEqual(r.events.map((e) => e.mutation_type).sort(), [...keep].sort());
  assert.equal(skippedTotal(r.report), drop.length);
  for (const vc of ["silent_mutation", "INTRON", "igr_x"]) assert.equal(filteredClassification(vc, 1, null), true, vc);
});

test("M1: 5'Flank is kept only for TERT (Entrez 7015), stored with protein change 'Promoter'", async () => {
  const r = await runMaf([
    { Hugo_Symbol: "TERT", Entrez_Gene_Id: "7015", Chromosome: "5", Variant_Classification: "5'Flank", HGVSp_Short: "", Tumor_Sample_Barcode: "S1" },
    { Variant_Classification: "5'Flank", HGVSp_Short: "", Tumor_Sample_Barcode: "S2" }
  ]);
  assert.equal(r.report.stored, 1);
  assert.equal(r.events[0].entrez_gene_id, 7015);
  assert.equal(r.events[0].protein_change, "Promoter");
});

test("M1/M3: RNA rows are dropped", async () => {
  const r = await runMaf([{ Variant_Classification: "RNA" }, { Start_Position: "5", End_Position: "5" }]);
  assert.equal(r.report.stored, 1);
  assert.equal(skippedTotal(r.report), 1);
});

test("M2: a meta variant_classification_filter (trimmed, comma-separated) replaces the default list with exact matching", async () => {
  const r = await runMaf([
    { Variant_Classification: "Silent", Start_Position: "1", End_Position: "1" },
    { Variant_Classification: "Intron", Start_Position: "2", End_Position: "2" },
    { Variant_Classification: "silent", Start_Position: "3", End_Position: "3" },
    { Variant_Classification: "IGR", Start_Position: "4", End_Position: "4" },
    { Variant_Classification: "Missense_Mutation", Start_Position: "5", End_Position: "5" }
  ], { meta: { variant_classification_filter: "Silent , Intron" } });
  assert.equal(r.report.stored, 3);
  assert.deepEqual(r.events.map((e) => e.mutation_type).sort(), ["IGR", "Missense_Mutation", "silent"]);
});

test("M2: with a meta filter, 5'Flank is kept for every gene and stored as 'Promoter'", async () => {
  const r = await runMaf([{ Variant_Classification: "5'Flank", HGVSp_Short: "" }], { meta: { variant_classification_filter: "Silent" } });
  assert.equal(r.report.stored, 1);
  assert.equal(r.events[0].entrez_gene_id, 7157);
  assert.equal(r.events[0].protein_change, "Promoter");
});

test("M3: Wildtype validation (any case), Redacted* validation and None*/LOH*/Wildtype* mutation status drop the row; Germline stays", async () => {
  const dropped: Cells[] = [
    { Validation_Status: "wildtype" }, { Validation_Status: "Redacted_by_center" },
    { Mutation_Status: "LOH" }, { Mutation_Status: "loh_region" }, { Mutation_Status: "None" }, { Mutation_Status: "Nonesuch" }, { Mutation_Status: "WILDTYPE" }
  ];
  const r = await runMaf([...dropped, { Mutation_Status: "Germline" }, { Mutation_Status: "Somatic" }]
    .map((c, i) => ({ ...c, Start_Position: String(100 + i), End_Position: String(100 + i) })));
  assert.equal(r.report.stored, 2);
  assert.equal(skippedTotal(r.report), dropped.length);
  assert.deepEqual(r.mutations.map((m) => m.mutation_status).sort(), ["Germline", "Somatic"]);
  assert.ok(filteredStatus("WildType", "Somatic"));
  assert.ok(filteredStatus("", "loh"));
  assert.equal(filteredStatus("Wildtype_partial", "Somatic"), null, "Validation_Status Wildtype is an exact (case-insensitive) match, not a prefix");
});

// ---------------------------------------------------------------- M4–M6: what a row is stored as

test("M4: protein change from HGVSp_Short, else Amino_Acid_Change, else MUTATED; trimmed and without p.", async () => {
  const r = await runMaf([
    { HGVSp_Short: " p.R175H ", Tumor_Sample_Barcode: "S1" },
    { HGVSp_Short: "NULL", Amino_Acid_Change: "p.R248Q", Protein_position: "", Tumor_Sample_Barcode: "S2" },
    { HGVSp_Short: "NA", Amino_Acid_Change: "[Not Available]", Protein_position: "", Tumor_Sample_Barcode: "S3" },
    { HGVSp_Short: "", Amino_Acid_Change: "", Protein_position: "", Tumor_Sample_Barcode: "S4", Start_Position: "9", End_Position: "9" }
  ]);
  const bySample = Object.fromEntries(stored(r).map((x) => [x.m.sample_id, x.e.protein_change]));
  assert.equal(bySample[sampleOf(r.ctx, "S1")!], "R175H");
  assert.equal(bySample[sampleOf(r.ctx, "S2")!], "R248Q");
  assert.equal(bySample[sampleOf(r.ctx, "S3")!], "MUTATED");
  assert.equal(bySample[sampleOf(r.ctx, "S4")!], "MUTATED");
  assert.equal(proteinChange("  p.G12D  ", ""), "G12D");
  assert.equal(proteinChange("null", "A146T"), "A146T", "NULL is matched without regard to case");
});

test("M5: chromosome upper-cased, chr prefix dropped, X/Y as 23/24, MT and NA accepted, other contigs refused", () => {
  assert.equal(mafChromosome("chrx"), "23");
  assert.equal(mafChromosome("CHR24"), "24");
  assert.equal(mafChromosome("1"), "1");
  assert.equal(mafChromosome("y"), "24");
  assert.notEqual(mafChromosome("MT"), null);
  assert.equal(mafChromosome("NA"), "NA");
  for (const c of ["chrM", "m", "25", "0", "1_random", "chrUn_gl000220"]) assert.equal(mafChromosome(c), null, c);
});

test("M5: rows on a refused contig are dropped; an empty Chromosome is stored as NA and kept", async () => {
  const r = await runMaf([
    { Chromosome: "chr17", Tumor_Sample_Barcode: "S1" },
    { Chromosome: "chrX", Tumor_Sample_Barcode: "S2" },
    { Chromosome: "chrM", Tumor_Sample_Barcode: "S3" },
    { Chromosome: "GL000220.1", Tumor_Sample_Barcode: "S4" },
    { Chromosome: "", Tumor_Sample_Barcode: "S5" }
  ]);
  assert.equal(r.report.stored, 3);
  assert.equal(skippedTotal(r.report), 2);
  const bySample = Object.fromEntries(stored(r).map((x) => [x.m.sample_id, x.e.chr]));
  assert.equal(bySample[sampleOf(r.ctx, "S1")!], "17");
  assert.equal(bySample[sampleOf(r.ctx, "S2")!], "23");
  assert.equal(bySample[sampleOf(r.ctx, "S5")!], "NA");
});

test("M6: unparseable or negative positions are stored as 0", async () => {
  const r = await runMaf([
    { Start_Position: "abc", End_Position: "-5", Tumor_Sample_Barcode: "S1" },
    { Start_Position: "", End_Position: "", Tumor_Sample_Barcode: "S2", HGVSp_Short: "p.R248Q" }
  ]);
  assert.equal(r.report.stored, 2);
  for (const e of r.events) {
    assert.equal(e.start_position, 0);
    assert.equal(e.end_position, 0);
  }
});

test("M6: an insertion (Reference_Allele exactly '-') ends at start + 1 whatever the file says", async () => {
  const r = await runMaf([
    { Reference_Allele: "-", Tumor_Seq_Allele1: "-", Tumor_Seq_Allele2: "AT", Start_Position: "100", End_Position: "100", Variant_Classification: "Frame_Shift_Ins", HGVSp_Short: "p.P72fs" },
    { Reference_Allele: "G", Tumor_Seq_Allele1: "G", Tumor_Seq_Allele2: "A", Start_Position: "300", End_Position: "301", HGVSp_Short: "p.R248Q" }
  ]);
  const ins = r.events.find((e) => e.reference_allele === "-")!;
  assert.equal(ins.start_position, 100);
  assert.equal(ins.end_position, 101);
  assert.equal(ins.tumor_seq_allele, "AT");
  const snv = r.events.find((e) => e.reference_allele === "G")!;
  assert.equal(snv.end_position, 301, "only insertions are rewritten");
});

test("M6: the tumor allele is the one differing from the reference; '-' loses to nucleotides; else Allele1", () => {
  assert.equal(tumorAllele("G", "NA", "A"), "A");
  assert.equal(tumorAllele("G", "A", "NA"), "A");
  assert.equal(tumorAllele("G", "A", ""), "A");
  assert.equal(tumorAllele("G", "-", "A"), "A");
  assert.equal(tumorAllele("G", "A", "-"), "A");
  assert.equal(tumorAllele("G", "A", "T"), "A");
  assert.equal(tumorAllele("G", "NA", "NA"), "");
});

test("M6: protein positions from Protein_position (truncated), else from the protein change, else -1", () => {
  assert.deepEqual(proteinPositions("12-13/189", "G12_G13insA"), [12, 13]);
  assert.deepEqual(proteinPositions("12.9/189", "G12D"), [12, 12]);
  assert.deepEqual(annotateProteinChange("G12D"), [12, 12]);
  assert.deepEqual(annotateProteinChange("E746_A750del"), [746, 750]);
  const [s, e] = annotateProteinChange("R840Kfs*9");
  assert.equal(s, 840);
  assert.equal(e, s, "a frameshift starts and ends at one residue");
  assert.deepEqual(annotateProteinChange("MUTATED"), [-1, -1]);
});

test("M6: protein positions stored on the event", async () => {
  const r = await runMaf([{ Protein_position: "", HGVSp_Short: "p.E746_A750del", Variant_Classification: "In_Frame_Del" }]);
  assert.equal(r.events[0].protein_pos_start, 746);
  assert.equal(r.events[0].protein_pos_end, 750);
});

const NO_COUNTS: CountColumns = { tAlt: "", tRef: "", nAlt: "", nRef: "", tTot: "", tVar: "", nTot: "", nVar: "", tDepth: "", tVaf: "", nDepth: "", nVaf: "" };

test("M6: read counts: the count column, else VarCov/TotCov, else depth × VAF ('%' divided by 100); via Double; null when absent", () => {
  assert.deepEqual(alleleCounts({ ...NO_COUNTS, tAlt: "5", tRef: "20", nAlt: "0", nRef: "30" }),
    { tumor_alt_count: 5, tumor_ref_count: 20, normal_alt_count: 0, normal_ref_count: 30 });
  assert.deepEqual(alleleCounts({ ...NO_COUNTS, tVar: "7", tTot: "30", nVar: "1", nTot: "40" }),
    { tumor_alt_count: 7, tumor_ref_count: 23, normal_alt_count: 1, normal_ref_count: 39 });
  assert.deepEqual(alleleCounts({ ...NO_COUNTS, tDepth: "100", tVaf: "0.25", nDepth: "10", nVaf: "0.33" }),
    { tumor_alt_count: 25, tumor_ref_count: 75, normal_alt_count: 3, normal_ref_count: 7 });
  assert.equal(alleleCounts({ ...NO_COUNTS, tAlt: "12.7" }).tumor_alt_count, 12);
  assert.deepEqual(alleleCounts(NO_COUNTS), { tumor_alt_count: null, tumor_ref_count: null, normal_alt_count: null, normal_ref_count: null });
  assert.equal(alleleCounts({ ...NO_COUNTS, tAlt: "abc" }).tumor_alt_count, null);
});

test("M6: a VAF written with '%' is divided by 100 before depth × VAF", () => {
  assert.deepEqual(alleleCounts({ ...NO_COUNTS, tDepth: "100", tVaf: "25%" }),
    { tumor_alt_count: 25, tumor_ref_count: 75, normal_alt_count: null, normal_ref_count: null });
});

test("M6: read counts from MAF columns are stored on the mutation", async () => {
  const r = await runMaf([{ t_alt_count: "12", t_ref_count: "88", n_alt_count: "0", n_ref_count: "50" }]);
  assert.equal(r.mutations[0].tumor_alt_count, 12);
  assert.equal(r.mutations[0].tumor_ref_count, 88);
  assert.equal(r.mutations[0].normal_alt_count, 0);
  assert.equal(r.mutations[0].normal_ref_count, 50);
});

test("M6: ONCOTATOR_VARIANT_CLASSIFICATION rescues a row whose Variant_Classification is not acceptable", { todo: "M6: spec says a Silent row with ONCOTATOR_VARIANT_CLASSIFICATION=Missense_Mutation is stored as Missense_Mutation; importer drops it" }, async () => {
  const r = await runMaf([{ Variant_Classification: "Silent", ONCOTATOR_VARIANT_CLASSIFICATION: "Missense_Mutation" }]);
  assert.equal(r.report.stored, 1);
  assert.equal(r.events[0].mutation_type, "Missense_Mutation");
});

test("M6: canonical_transcript is always true", async () => {
  const r = await runMaf([{}]);
  assert.ok(r.events[0].canonical_transcript === 1 || r.events[0].canonical_transcript === true);
});

// ---------------------------------------------------------------- M7–M8: duplicates and events

test("M7: rows with the same gene/chr/start/end/protein/allele/type for a sample merge, compared case-insensitively; centers sorted and ;-joined", async () => {
  const r = await runMaf([
    { Center: "WUSTL" },
    { Center: "BI", HGVSp_Short: "p.r175h", Variant_Classification: "missense_mutation" },
    { Center: "BI", Reference_Allele: "G", Tumor_Seq_Allele1: "G", Tumor_Seq_Allele2: "T" }
  ]);
  assert.equal(r.report.read, 3);
  assert.equal(r.mutations.length, 1, "the reference allele is not part of the key");
  assert.equal(r.mutations[0].center, "BI;WUSTL");
  assert.equal(r.events.length, 1);
});

test("M7: NA is dropped from merged centers when another center is present", async () => {
  const r = await runMaf([{ Center: "" }, { Center: "MSK" }]);
  assert.equal(r.mutations.length, 1);
  assert.equal(r.mutations[0].center, "MSK");
});

test("M7: rows differing in any key field, or in sample, stay separate", async () => {
  const r = await runMaf([
    {},
    { Tumor_Seq_Allele2: "G" },
    { HGVSp_Short: "p.R175L" },
    { Variant_Classification: "Nonsense_Mutation" },
    { End_Position: "7578407" },
    { Tumor_Sample_Barcode: "S2" }
  ]);
  assert.equal(r.mutations.length, 6);
});

test("M7: on a collision the first row survives unless the second is validated or germline", async () => {
  const plain = await runMaf([{ Sequencer: "first" }, { Sequencer: "second" }]);
  assert.equal(plain.mutations.length, 1);
  assert.equal(plain.mutations[0].sequencer, "first");

  const validated = await runMaf([{ Sequencer: "first" }, { Sequencer: "second", Validation_Status: "Valid" }]);
  assert.equal(validated.mutations[0].validation_status, "Valid");
  assert.equal(validated.mutations[0].sequencer, "second");

  const germline = await runMaf([{ Mutation_Status: "Somatic" }, { Mutation_Status: "Germline" }]);
  assert.equal(germline.mutations.length, 1);
  assert.equal(germline.mutations[0].mutation_status, "Germline");

  const kept = await runMaf([{ Mutation_Status: "Germline" }, { Mutation_Status: "Somatic" }]);
  assert.equal(kept.mutations[0].mutation_status, "Germline");
});

test("M8: within a file the first row creates the event and later samples reuse it", async () => {
  const r = await runMaf([
    { Tumor_Sample_Barcode: "S1", Reference_Allele: "C", RefSeq: "NM_000546" },
    { Tumor_Sample_Barcode: "S2", Reference_Allele: "C", RefSeq: "NM_other" }
  ]);
  assert.equal(r.events.length, 1);
  assert.equal(r.mutations.length, 2);
  assert.equal(r.mutations[0].mutation_event_id, r.mutations[1].mutation_event_id);
  assert.equal(r.mutations[0].mutation_event_id, r.events[0].mutation_event_id);
});

test("M8 / README B: events are per study, not reused from another study's matching event", async () => {
  const other = { ...MAF_BASE, mutation_event_id: 77, entrez_gene_id: 7157, chr: "17", start_position: 7578406, end_position: 7578406,
    protein_change: "R175H", tumor_seq_allele: "T", mutation_type: "Missense_Mutation", reference_allele: "X" };
  const r = await runMaf([{}], { answer: [/FROM\s+mutation_event/i, [other]] });
  assert.equal(r.events.length, 1, "this study writes its own event");
  assert.equal(r.events[0].reference_allele, "C");
  assert.equal(r.mutations[0].mutation_event_id, r.events[0].mutation_event_id);
  assert.notEqual(r.mutations[0].mutation_event_id, 77);
});

// ---------------------------------------------------------------- M9: keyword

test("M9: the event keyword is HUGO + the guessed keyword; truncating types share one keyword; none stored as null", async () => {
  const r = await runMaf([
    { Tumor_Sample_Barcode: "S1" },
    { Tumor_Sample_Barcode: "S2", Variant_Classification: "Nonsense_Mutation", HGVSp_Short: "p.R196*", Protein_position: "196/393" },
    { Tumor_Sample_Barcode: "S3", Variant_Classification: "In_Frame_Del", HGVSp_Short: "p.E746_A750del", Protein_position: "" },
    { Tumor_Sample_Barcode: "S4", Hugo_Symbol: "kras", Entrez_Gene_Id: "", Chromosome: "12", HGVSp_Short: "p.G12D", Protein_position: "12/189" }
  ]);
  const bySample = Object.fromEntries(stored(r).map((x) => [x.m.sample_id, x.e.keyword]));
  assert.equal(bySample[sampleOf(r.ctx, "S1")!], "TP53 R175 missense");
  assert.equal(bySample[sampleOf(r.ctx, "S2")!], "TP53 truncating");
  assert.equal(bySample[sampleOf(r.ctx, "S3")!], null);
  assert.equal(bySample[sampleOf(r.ctx, "S4")!], "KRAS G12 missense");
});

test("M9: Nonsense, Splice_Site, Frame_Shift_*, Nonstop and Translation_Start_Site are truncating", () => {
  assert.equal(mutationKeyword("TP53", "R196*", "Nonsense_Mutation"), "TP53 truncating");
  assert.equal(mutationKeyword("TP53", "X125_splice", "Splice_Site"), "TP53 truncating");
  assert.equal(mutationKeyword("TP53", "P72fs", "Frame_Shift_Del"), "TP53 truncating");
  assert.equal(mutationKeyword("TP53", "*394Kext*?", "Nonstop_Mutation"), "TP53 truncating");
  assert.equal(mutationKeyword("TP53", "M1?", "Translation_Start_Site"), "TP53 truncating");
  assert.equal(mutationKeyword("kras", "G12D", "Missense_Mutation"), "KRAS G12 missense");
});

// ---------------------------------------------------------------- M10: MUTATION_COUNT input

test("M10: MUTATION_COUNT loci are distinct (chr, start, end, ref, allele) per sample; germline excluded; two genes at one locus count once", async () => {
  const r = await runMaf([
    { Tumor_Sample_Barcode: "S1" },
    { Tumor_Sample_Barcode: "S1", Hugo_Symbol: "EGFR", Entrez_Gene_Id: "1956", HGVSp_Short: "p.X1Y" },
    { Tumor_Sample_Barcode: "S1", Start_Position: "200", End_Position: "200", HGVSp_Short: "p.R248Q" },
    { Tumor_Sample_Barcode: "S1", Start_Position: "300", End_Position: "300", HGVSp_Short: "p.R273H", Mutation_Status: "Germline" },
    { Tumor_Sample_Barcode: "S2", Mutation_Status: "Somatic" },
    { Tumor_Sample_Barcode: "S2", Mutation_Status: "Germline" },
    { Tumor_Sample_Barcode: "S3", Mutation_Status: "GERMLINE" }
  ]);
  assert.equal(r.mutations.length, 6);
  assert.equal(r.ctx.mutationLoci.get(sampleOf(r.ctx, "S1")!)?.size, 2);
  assert.equal(r.ctx.mutationLoci.get(sampleOf(r.ctx, "S2")!)?.size ?? 0, 0, "a germline survivor of a merge is not counted");
  assert.equal(r.ctx.mutationLoci.get(sampleOf(r.ctx, "S3")!)?.size ?? 0, 0);
});

test("P1 (mutations): profiled = samples with an accepted mutation plus #sequenced_samples; only-filtered samples are not", async () => {
  const r = await runMaf([
    { Tumor_Sample_Barcode: "S1" },
    { Tumor_Sample_Barcode: "S2", Variant_Classification: "Silent" }
  ], { comments: ["#sequenced_samples: S8 S9"] });
  const profiled = new Set([...r.ctx.sampleProfile.values()].filter((p) => p.profile === 1).map((p) => r.ctx.samples.keyOf(p.sample)));
  assert.deepEqual([...profiled].sort(), ["S1", "S8", "S9"]);
  for (const p of r.ctx.sampleProfile.values()) assert.equal(p.panel, null, "no gene_panel in meta: whole exome");
});

// ---------------------------------------------------------------- M11–M13

test("M11: empty string cells are stored as the literal NA", async () => {
  const r = await runMaf([{ Center: "", Strand: "", Mutation_Status: "", Validation_Status: "", NCBI_Build: "", Sequencer: "" }]);
  assert.equal(r.mutations.length, 1);
  const { m, e } = stored(r)[0];
  assert.equal(m.center, "NA");
  assert.equal(m.mutation_status, "NA");
  assert.equal(m.validation_status, "NA");
  assert.equal(m.sequencer, "NA");
  assert.equal(e.strand, "NA");
  assert.equal(e.ncbi_build, "NA");
});

test("M11: an empty Reference_Allele is stored as NA", async () => {
  const r = await runMaf([{ Reference_Allele: "", Tumor_Seq_Allele1: "", Tumor_Seq_Allele2: "T" }]);
  assert.equal(r.events[0].reference_allele, "NA");
  assert.equal(r.events[0].tumor_seq_allele, "T");
});

test("M12: TCGA barcodes are normalised to the sample id; normal-tissue barcodes are skipped without creating a sample", async () => {
  const r = await runMaf([
    { Tumor_Sample_Barcode: "TCGA-AB-1234-01A-11D-A29I-10" },
    { Tumor_Sample_Barcode: "TCGA-AB-1234-10A-01D" },
    { Tumor_Sample_Barcode: "TCGA-AB-1234-11A" }
  ]);
  assert.equal(r.report.stored, 1);
  assert.equal(r.mutations[0].sample_id, sampleOf(r.ctx, "TCGA-AB-1234-01"));
  assert.ok(!r.ctx.samples.has("TCGA-AB-1234-10"));
  assert.ok(!r.ctx.samples.has("TCGA-AB-1234-11"));
});

test("M12 (intended departure): a sample no clinical file named is created and reported instead of aborting", async () => {
  const r = await runMaf([{ Tumor_Sample_Barcode: "S1" }, { Tumor_Sample_Barcode: "NEW1" }], {
    setup: (ctx) => { ctx.samples.set("S1", { id: ctx.id("sample"), patient: ctx.patient("P1") }); }
  });
  assert.equal(r.report.stored, 2);
  assert.deepEqual(r.ctx.implicitSamples, ["NEW1"]);
  assert.ok(r.mutations.some((m) => m.sample_id === sampleOf(r.ctx, "S1")));
  assert.ok(r.mutations.some((m) => m.sample_id === sampleOf(r.ctx, "NEW1")));
});

test("M13: a driver annotation row only where cbp_driver or cbp_driver_tiers is non-empty and not 'na'", async () => {
  const r = await runMaf([
    { Tumor_Sample_Barcode: "S1", cbp_driver: "Putative_Driver", cbp_driver_tiers: "" },
    { Tumor_Sample_Barcode: "S2", cbp_driver: "", cbp_driver_tiers: "Tier 1" },
    { Tumor_Sample_Barcode: "S3", cbp_driver: "NA", cbp_driver_tiers: "na" },
    { Tumor_Sample_Barcode: "S4", cbp_driver: "", cbp_driver_tiers: "" }
  ]);
  assert.equal(r.mutations.length, 4);
  const ann = r.tables.alteration_driver_annotation ?? [];
  assert.deepEqual(ann.map((a) => a.sample_id).sort(), [sampleOf(r.ctx, "S1"), sampleOf(r.ctx, "S2")].sort());
  const s1 = ann.find((a) => a.sample_id === sampleOf(r.ctx, "S1"))!;
  assert.equal(s1.driver_filter, "Putative_Driver");
  assert.equal(s1.driver_tiers_filter, "", "an empty tier is stored as '' (NA mapped to '')");
  const s2 = ann.find((a) => a.sample_id === sampleOf(r.ctx, "S2"))!;
  assert.equal(s2.driver_tiers_filter, "Tier 1");
});

test("Reference genome: an NCBI_Build that disagrees with the study is stored as given; coordinates are not converted", async () => {
  const r = await runMaf([{ NCBI_Build: "GRCh38", Start_Position: "7675088", End_Position: "7675088" }]);
  assert.equal(r.ctx.referenceGenome, "hg19");
  assert.equal(r.report.stored, 1);
  assert.equal(r.events[0].ncbi_build, "GRCh38");
  assert.equal(r.events[0].start_position, 7675088);
});

// ---------------------------------------------------------------- V: structural variants

const SV_BASE: Cells = {
  Sample_Id: "S1", SV_Status: "SOMATIC",
  Site1_Hugo_Symbol: "EGFR", Site1_Entrez_Gene_Id: "1956", Site1_Ensembl_Transcript_Id: "ENST00000275493", Site1_Region_Number: "7",
  Site1_Region: "exon", Site1_Chromosome: "7", Site1_Position: "55241700",
  Site2_Hugo_Symbol: "KRAS", Site2_Entrez_Gene_Id: "3845", Site2_Ensembl_Transcript_Id: "ENST00000256078", Site2_Region_Number: "2",
  Site2_Region: "intron", Site2_Chromosome: "12", Site2_Position: "25398300",
  Event_Info: "EGFR-KRAS fusion", Tumor_Read_Count: "40", Tumor_Variant_Count: "12", Length: "1000"
};

async function runSv(rows: Cells[], opts: { drop?: string[]; known?: string[] } = {}) {
  const ch = fakeCh();
  try {
    const ctx = await importContext(ch, { genes: genes(GENES) });
    for (const s of opts.known ?? ["S1", "S2"]) ctx.samples.set(s, { id: ctx.id("sample"), patient: ctx.patient("P_" + s) });
    await importStructuralVariants(ctx, dataFile("sv", table(SV_BASE, rows, opts.drop)), 2);
    return { ctx, report: ctx.reports.at(-1)!, svs: ch.rows("structural_variant") };
  } finally {
    ch.restore();
  }
}

test("V1: a file without an SV_Status column stores no rows", async () => {
  const r = await runSv([{}, { Sample_Id: "S2" }], { drop: ["SV_Status"] });
  assert.equal(r.report.read, 2);
  assert.equal(r.report.stored, 0);
  assert.equal(r.svs.length, 0);
  assert.equal(skippedTotal(r.report), 2);
});

test("V1: rows with an empty or NA SV_Status are dropped; others stored", async () => {
  const r = await runSv([{ SV_Status: "" }, { SV_Status: "NA", Event_Info: "b" }, { SV_Status: "GERMLINE", Event_Info: "c" }]);
  assert.equal(r.svs.length, 1);
  assert.equal(r.svs[0].sv_status, "GERMLINE");
  assert.equal(skippedTotal(r.report), 2);
});

test("V2: a row whose sample is unknown is skipped, not stored", { todo: "V2: spec says a row with an unknown sample is skipped; importer creates the sample (implicitSamples) and stores the row" }, async () => {
  const r = await runSv([{ Sample_Id: "GHOST" }, {}], { known: ["S1"] });
  assert.equal(r.svs.length, 1);
  assert.equal(r.svs[0].sample_id, sampleOf(r.ctx, "S1"));
  assert.ok(!r.ctx.samples.has("GHOST"));
  assert.equal(skippedTotal(r.report), 1);
});

test("G5/V3: an unknown site Entrez id falls back to the non-ambiguous symbol, and the resolved id is stored", async () => {
  const r = await runSv([
    { Site1_Entrez_Gene_Id: "99999999", Site1_Hugo_Symbol: "EGFR" },
    { Sample_Id: "S2", Site1_Entrez_Gene_Id: "", Site1_Hugo_Symbol: "MLL2", Site2_Entrez_Gene_Id: "", Site2_Hugo_Symbol: "p53" }
  ]);
  assert.equal(r.svs.length, 2);
  const s1 = r.svs.find((s) => s.sample_id === sampleOf(r.ctx, "S1"))!;
  assert.equal(s1.site1_entrez_gene_id, 1956);
  const s2 = r.svs.find((s) => s.sample_id === sampleOf(r.ctx, "S2"))!;
  assert.equal(s2.site1_entrez_gene_id, 8085, "the disambiguation file applies to SVs");
  assert.equal(s2.site2_entrez_gene_id, 7157, "a unique alias resolves");
});

test("V3: a site whose gene does not resolve is stored with a null Entrez id; neither resolving drops the row", async () => {
  const r = await runSv([
    { Site2_Hugo_Symbol: "NOTAGENE", Site2_Entrez_Gene_Id: "" },
    { Sample_Id: "S2", Site1_Hugo_Symbol: "NOTAGENE", Site1_Entrez_Gene_Id: "", Site2_Hugo_Symbol: "CDKN2", Site2_Entrez_Gene_Id: "" },
    { Sample_Id: "S2", Site1_Hugo_Symbol: "", Site1_Entrez_Gene_Id: "", Site2_Hugo_Symbol: "", Site2_Entrez_Gene_Id: "", Event_Info: "none" }
  ]);
  assert.equal(r.report.read, 3);
  assert.equal(r.svs.length, 1);
  assert.equal(r.svs[0].site1_entrez_gene_id, 1956);
  assert.equal(r.svs[0].site2_entrez_gene_id, null);
  assert.equal(skippedTotal(r.report), 2);
});

test("V4: in-file duplicates (sample, both sites' entrez/chr/pos/region number/transcript, event info) keep the first", async () => {
  const r = await runSv([
    { Tumor_Read_Count: "40" },
    { Tumor_Read_Count: "99" },
    { Site1_Hugo_Symbol: "", Tumor_Read_Count: "77" },
    { Event_Info: "other event" },
    { Site1_Position: "55241701" },
    { Site2_Region_Number: "3" },
    { Site1_Ensembl_Transcript_Id: "ENST_other" },
    { Sample_Id: "S2" }
  ]);
  assert.equal(r.report.read, 8);
  assert.equal(r.svs.length, 6);
  const firsts = r.svs.filter((s) => s.sample_id === sampleOf(r.ctx, "S1") && s.event_info === "EGFR-KRAS fusion" && s.site1_position === 55241700
    && s.site2_region_number === 2 && s.site1_ensembl_transcript_id === "ENST00000275493");
  assert.equal(firsts.length, 1);
  assert.equal(firsts[0].tumor_read_count, 40);
});

test("V4: missing, empty or NA integers become -1; empty strings become NA; chromosomes are stored raw", async () => {
  const r = await runSv([{ Site1_Position: "", Site2_Position: "NA", Tumor_Read_Count: "", Length: "NA", Site1_Region: "", Site1_Chromosome: "chr7", Site2_Chromosome: "X" }]);
  assert.equal(r.svs.length, 1);
  const s = r.svs[0];
  assert.equal(s.site1_position, -1);
  assert.equal(s.site2_position, -1);
  assert.equal(s.tumor_read_count, -1);
  assert.equal(s.length, -1);
  assert.equal(s.normal_read_count, -1, "an absent column is -1 too");
  assert.equal(s.site1_region, "NA");
  assert.equal(s.site1_contig, "NA");
  assert.equal(s.site1_chromosome, "chr7");
  assert.equal(s.site2_chromosome, "X");
  assert.equal(s.tumor_variant_count, 12);
});

test("V4/P1: only samples with at least one stored SV are profiled", async () => {
  const r = await runSv([{}, { Sample_Id: "S2", SV_Status: "" }]);
  const profiled = [...r.ctx.sampleProfile.values()].filter((p) => p.profile === 2).map((p) => r.ctx.samples.keyOf(p.sample));
  assert.deepEqual(profiled, ["S1"]);
});
