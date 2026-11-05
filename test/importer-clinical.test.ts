// The importer's clinical, segment, timeline, gene panel and case list rules, written from the
// legacy-importer notes (import session: notes/README.md and legacy-java-importer.md §C, §S, §P,
// §L, §X3, §X5) rather than from the code. Each test names the rule it pins; a test marked `todo`
// records a place where the importer and the notes disagree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dataFile, fakeCh, genes, importContext, studyDir, type FakeCh } from "./support/fake-ch.ts";
import { importClinicalPatients, importClinicalSamples } from "../lib/importer/clinical.ts";
import { importGenePanelMatrix, importSegments, importTimeline, type SegmentTotals } from "../lib/importer/other.ts";
import { importGenePanel } from "../lib/importer/panels.ts";
import { readStudyFolder } from "../lib/importer/study.ts";
import { importStudy } from "../lib/importer/import-study.ts";
import type { ImportContext } from "../lib/importer/context.ts";

type Row = Record<string, unknown>;

/** A clinical file with the four `#` metadata lines; `cols` are [id, display, datatype, priority]. */
function clinical(cols: [string, string, string, string][], rows: string[][]): string {
  const meta = [cols.map((c) => c[1]), cols.map((c) => c[1] + " description"), cols.map((c) => c[2]), cols.map((c) => c[3])];
  return meta.map((m) => "#" + m.join("\t")).join("\n") + "\n" + cols.map((c) => c[0]).join("\t") + "\n" + rows.map((r) => r.join("\t")).join("\n") + "\n";
}

const PID: [string, string, string, string] = ["PATIENT_ID", "Patient Identifier", "STRING", "1"];
const SID: [string, string, string, string] = ["SAMPLE_ID", "Sample Identifier", "STRING", "1"];

/** Runs `fn` with a fresh fake ClickHouse and import context, always putting fetch back. */
async function withCtx(fn: (ch: FakeCh, ctx: ImportContext) => Promise<void>, gs = genes([])): Promise<void> {
  const ch = fakeCh();
  try { await fn(ch, await importContext(ch, { genes: gs })); } finally { ch.restore(); }
}

async function samples(ctx: ImportContext, text: string, seen = new Set<string>()): Promise<void> {
  await importClinicalSamples(ctx, dataFile("clinical_sample", text), seen);
}

async function patients(ctx: ImportContext, text: string, seen = new Set<string>()): Promise<void> {
  await importClinicalPatients(ctx, dataFile("clinical_patient", text), seen);
}

/** attr_id → attr_value of one entity's rows in a clinical table */
function attrs(rows: Row[], internalId: number | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of rows) if (r.internal_id === internalId) out[String(r.attr_id)] = r.attr_value;
  return out;
}

const metaOf = (ch: FakeCh, attr: string) => ch.rows("clinical_attribute_meta").filter((r) => r.attr_id === attr);

/** Imports a whole study folder on a fresh fake ClickHouse (no derived tables). */
async function study(files: Record<string, string>, fn: (ch: FakeCh) => void | Promise<void>, geneRows: Row[] = []): Promise<void> {
  const ch = fakeCh();
  try {
    ch.answer(/AS g FROM gene\b/, geneRows);
    // panels the study ships are inserted, then read back by stable id
    ch.answer(/AS s, internal_id AS i FROM gene_panel/, () => ch.rows("gene_panel").map((p) => ({ s: p.stable_id, i: p.internal_id })));
    await importStudy(ch.conn, "/nonexistent", studyDir(files), "st", () => {}, false, false);
    await fn(ch);
  } finally { ch.restore(); }
}

const META_STUDY = "type_of_cancer: brca\ncancer_study_identifier: st\nname: St\ndescription: d\n";
const META_CS = "cancer_study_identifier: st\ngenetic_alteration_type: CLINICAL\ndatatype: SAMPLE_ATTRIBUTES\ndata_filename: cs.txt\n";
const META_CP = "cancer_study_identifier: st\ngenetic_alteration_type: CLINICAL\ndatatype: PATIENT_ATTRIBUTES\ndata_filename: cp.txt\n";
const META_SEG = "cancer_study_identifier: st\ngenetic_alteration_type: COPY_NUMBER_ALTERATION\ndatatype: SEG\nreference_genome_id: hg19\ndescription: segs\ndata_filename: seg.txt\n";
const SEG_HEAD = "ID\tchrom\tloc.start\tloc.end\tnum.mark\tseg.mean\n";

const sampleIdOf = (ch: FakeCh, stable: string) => ch.rows("sample").find((r) => r.stable_id === stable)?.internal_id as number | undefined;
const patientIdOf = (ch: FakeCh, stable: string) => ch.rows("patient").find((r) => r.stable_id === stable)?.internal_id as number | undefined;
const listMembers = (ch: FakeCh, stable: string) => {
  const list = ch.rows("sample_list").find((r) => r.stable_id === stable);
  if (!list) return undefined;
  const byId = new Map(ch.rows("sample").map((s) => [s.internal_id, s.stable_id]));
  return ch.rows("sample_list_list").filter((r) => r.list_id === list.list_id).map((r) => byId.get(r.sample_id));
};

// ---------------------------------------------------------------- C. clinical

test("C1: NA-like tokens store no row; N/A, Unknown and . are stored", async () => {
  await withCtx(async (ch, ctx) => {
    const cols: [string, string, string, string][] = [PID, SID, ["A", "A", "STRING", "1"]];
    const values = ["", "NA", "na", "[Not Available]", "not applicable", "Completed", "NULL", "N|A", "Missing", "[Pending]", "Discrepancy", "N/A", "Unknown", "."];
    await samples(ctx, clinical(cols, values.map((v, i) => ["P" + i, "S" + i, v])));
    const stored = ch.rows("clinical_sample").filter((r) => r.attr_id === "A").map((r) => r.attr_value).sort();
    assert.deepEqual(stored, [".", "N/A", "Unknown"]);
  });
});

test("C2: OS_STATUS and DFS_STATUS patient values get the 1:/0: prefix, original casing kept", async () => {
  await withCtx(async (ch, ctx) => {
    const cols: [string, string, string, string][] = [PID, ["OS_STATUS", "OS", "STRING", "1"], ["DFS_STATUS", "DFS", "STRING", "1"], ["PFS_STATUS", "PFS", "STRING", "1"]];
    await patients(ctx, clinical(cols, [
      ["P1", "DECEASED", "Recurred/Progressed", "Progressed"],
      ["P2", "Living", "DiseaseFree", "1:Progressed"],
      ["P3", "0:LIVING", "Recurred", "Censored"],
      ["P4", "deceased", "progressed", "x"]
    ]));
    const rows = ch.rows("clinical_patient");
    assert.deepEqual(attrs(rows, ctx.patients.get("P1")), { OS_STATUS: "1:DECEASED", DFS_STATUS: "1:Recurred/Progressed", PFS_STATUS: "Progressed" });
    assert.deepEqual(attrs(rows, ctx.patients.get("P2")), { OS_STATUS: "0:Living", DFS_STATUS: "0:DiseaseFree", PFS_STATUS: "1:Progressed" });
    assert.deepEqual(attrs(rows, ctx.patients.get("P3")), { OS_STATUS: "0:LIVING", DFS_STATUS: "1:Recurred", PFS_STATUS: "Censored" });
    assert.deepEqual(attrs(rows, ctx.patients.get("P4")), { OS_STATUS: "1:deceased", DFS_STATUS: "1:progressed", PFS_STATUS: "x" });
  });
});

test("C2: an OS_STATUS column in a sample file is not prefixed (patient attributes only)", async () => {
  await withCtx(async (ch, ctx) => {
    await samples(ctx, clinical([PID, SID, ["OS_STATUS", "OS", "STRING", "1"]], [["P1", "S1", "DECEASED"]]));
    assert.deepEqual(attrs(ch.rows("clinical_sample"), ctx.samples.get("S1")?.id), { OS_STATUS: "DECEASED" });
  });
});

test("C3: attribute ids are trimmed and uppercased; datatype stored as written; priority as a string", async () => {
  await withCtx(async (ch, ctx) => {
    await samples(ctx, clinical([PID, SID, [" age ", "Age", "number", "7"]], [["P1", "S1", "50"]]));
    const meta = metaOf(ch, "AGE");
    assert.equal(meta.length, 1);
    assert.equal(meta[0].display_name, "Age");
    assert.equal(meta[0].description, "Age description");
    assert.equal(meta[0].datatype, "number");
    assert.equal(meta[0].priority, "7");
    assert.equal(meta[0].patient_attribute, 0);
    assert.deepEqual(attrs(ch.rows("clinical_sample"), ctx.samples.get("S1")?.id), { AGE: "50" });
  });
});

test("C3: PATIENT_ID and SAMPLE_ID get no attribute metadata and no value rows", async () => {
  await withCtx(async (ch, ctx) => {
    await samples(ctx, clinical([PID, SID, ["X", "X", "STRING", "1"]], [["P1", "S1", "v"]]));
    await patients(ctx, clinical([PID, ["Y", "Y", "STRING", "1"]], [["P1", "w"]]));
    const ids = ch.rows("clinical_attribute_meta").map((r) => r.attr_id).sort();
    assert.deepEqual(ids, ["X", "Y"]);
    for (const t of ["clinical_sample", "clinical_patient"]) assert.ok(ch.rows(t).every((r) => r.attr_id !== "PATIENT_ID" && r.attr_id !== "SAMPLE_ID"), t);
  });
});

test("C3: the first definition of an attribute in the study wins", async () => {
  await withCtx(async (ch, ctx) => {
    const seen = new Set<string>();
    await samples(ctx, clinical([PID, SID, ["GRADE", "Grade (first)", "STRING", "3"]], [["P1", "S1", "G1"]]), seen);
    await samples(ctx, clinical([PID, SID, ["GRADE", "Grade (second)", "NUMBER", "9"]], [["P2", "S2", "2"]]), seen);
    const meta = metaOf(ch, "GRADE");
    assert.equal(meta.length, 1);
    assert.equal(meta[0].display_name, "Grade (first)");
    assert.equal(meta[0].datatype, "STRING");
  });
});

test("C3: without the # header lines every column is a STRING attribute (named by its id; intended departure from MISSING)", async () => {
  await withCtx(async (ch, ctx) => {
    await samples(ctx, "PATIENT_ID\tSAMPLE_ID\tSUBTYPE\nP1\tS1\tLumA\n");
    const meta = metaOf(ch, "SUBTYPE");
    assert.equal(meta.length, 1);
    assert.equal(meta[0].datatype, "STRING");
    assert.equal(meta[0].display_name, "SUBTYPE");
    assert.equal(meta[0].patient_attribute, 0);
    assert.deepEqual(attrs(ch.rows("clinical_sample"), ctx.samples.get("S1")?.id), { SUBTYPE: "LumA" });
  });
});

test("C4: TCGA sample barcodes are cut to TCGA-XX-XXXX-NN and linked to the barcode's patient", async () => {
  await withCtx(async (ch, ctx) => {
    await samples(ctx, clinical([PID, SID, ["X", "X", "STRING", "1"]], [["someone-else", "TCGA-AB-1234-01A-11D-A29I-10", "v"]]));
    const s = ctx.samples.get("TCGA-AB-1234-01");
    assert.ok(s, "sample stored under its cut barcode");
    assert.equal(ctx.samples.has("TCGA-AB-1234-01A-11D-A29I-10"), false);
    assert.equal(s.patient, ctx.patients.get("TCGA-AB-1234"));
    assert.deepEqual(attrs(ch.rows("clinical_sample"), s.id), { X: "v" });
  });
});

test("C4: a duplicate TCGA sample keeps its first row", async () => {
  await withCtx(async (ch, ctx) => {
    await samples(ctx, clinical([PID, SID, ["X", "X", "STRING", "1"]], [
      ["TCGA-AB-1234", "TCGA-AB-1234-01A", "first"],
      ["TCGA-AB-1234", "TCGA-AB-1234-01B", "second"]
    ]));
    assert.equal(ctx.samples.size, 1);
    assert.deepEqual(ch.rows("clinical_sample").filter((r) => r.attr_id === "X").map((r) => r.attr_value), ["first"]);
  });
});

test("C5: a sample whose SAMPLE_TYPE is normal is not created, its values are dropped, its patient is", { todo: "C5: spec says the patient of a normal sample is still created; importer creates neither" }, async () => {
  await withCtx(async (ch, ctx) => {
    await samples(ctx, clinical([PID, SID, ["SAMPLE_TYPE", "Type", "STRING", "1"], ["X", "X", "STRING", "1"]], [
      ["P1", "S1", "Solid Tissues Normal", "a"],
      ["P2", "S2", "blood derived normal", "b"],
      ["P3", "S3", "Primary", "c"]
    ]));
    assert.deepEqual([...ctx.samples.keys()], ["S3"]);
    assert.ok(ctx.patients.has("P1") && ctx.patients.has("P2"), "patients of normal samples are still created");
    assert.deepEqual(ch.rows("clinical_sample").filter((r) => r.attr_id === "X").map((r) => r.attr_value), ["c"]);
  });
});

test("C5: a TCGA normal barcode (sample type 10/11) is not created", async () => {
  await withCtx(async (ch, ctx) => {
    await samples(ctx, clinical([PID, SID, ["X", "X", "STRING", "1"]], [["TCGA-AB-1234", "TCGA-AB-1234-11A", "n"], ["TCGA-AB-1234", "TCGA-AB-1234-01A", "t"]]));
    assert.deepEqual([...ctx.samples.keys()], ["TCGA-AB-1234-01"]);
    assert.deepEqual(ch.rows("clinical_sample").map((r) => r.attr_value), ["t"]);
  });
});

test("C5: sample type comes from SAMPLE_TYPE or the TCGA code, defaulting to Primary Solid Tumor", async () => {
  await withCtx(async (_ch, ctx) => {
    await samples(ctx, clinical([PID, SID, ["SAMPLE_TYPE", "Type", "STRING", "1"]], [
      ["P1", "S1", "Primary"],
      ["P2", "S2", "metastatic"],
      ["P3", "S3", "Recurrent Solid Tumor"],
      ["TCGA-AB-0006", "TCGA-AB-0006-06", ""]
    ]));
    const type = (s: string) => ctx.sampleTypes.get(ctx.samples.get(s)!.id);
    assert.equal(type("S1"), "Primary Solid Tumor");
    assert.equal(type("S2"), "Metastatic");
    assert.equal(type("S3"), "Recurrent Solid Tumor");
    assert.equal(type("TCGA-AB-0006-06"), "Metastatic");
  });
});

test("C5: patients are created on first sight; a patient-file patient without samples is created with a warning", async () => {
  await withCtx(async (ch, ctx) => {
    await samples(ctx, clinical([PID, SID], [["P1", "S1"], ["P1", "S2"]]));
    assert.equal(ctx.samples.get("S1")?.patient, ctx.samples.get("S2")?.patient);
    assert.equal(ctx.patients.size, 1);
    await patients(ctx, clinical([PID, ["AGE", "Age", "NUMBER", "1"]], [["P1", "40"], ["P9", "60"]]));
    assert.ok(ctx.patients.has("P9"));
    assert.deepEqual(attrs(ch.rows("clinical_patient"), ctx.patients.get("P9")), { AGE: "60" });
    const said = ctx.warnings.join("\n") + "\n" + ctx.reports.flatMap((r) => r.notes).join("\n") + JSON.stringify(ctx.reports.map((r) => r.skipped));
    assert.match(said, /P9/);
  });
});

test("C6: SAMPLE_COUNT per patient; a patient with no samples gets none; STRING, patient-level, priority 1", async () => {
  await study({
    "meta_study.txt": META_STUDY,
    "meta_clinical_sample.txt": META_CS,
    "cs.txt": "PATIENT_ID\tSAMPLE_ID\nP1\tS1\nP1\tS2\nP2\tS3\n",
    "meta_clinical_patient.txt": META_CP,
    "cp.txt": "PATIENT_ID\tAGE\nP1\t1\nP2\t2\nP3\t3\n"
  }, (ch) => {
    const counts = ch.rows("clinical_patient").filter((r) => r.attr_id === "SAMPLE_COUNT");
    const byPatient = Object.fromEntries(counts.map((r) => [ch.rows("patient").find((p) => p.internal_id === r.internal_id)?.stable_id, r.attr_value]));
    assert.deepEqual(byPatient, { P1: "2", P2: "1" });
    const meta = metaOf(ch, "SAMPLE_COUNT");
    assert.equal(meta.length, 1);
    assert.equal(meta[0].datatype, "STRING");
    assert.equal(meta[0].patient_attribute, 1);
    assert.equal(meta[0].priority, "1");
  });
});

test("C7: NUMBER and BOOLEAN values are stored as the trimmed raw string", async () => {
  await withCtx(async (ch, ctx) => {
    await samples(ctx, clinical([PID, SID, ["AGE", "Age", "NUMBER", "1"], ["FLAG", "Flag", "BOOLEAN", "1"]], [
      ["P1", "S1", "45.0", "TRUE"],
      ["P2", "S2", ">89", " yes "],
      ["P3", "S3", "1e3", "0"]
    ]));
    const rows = ch.rows("clinical_sample");
    assert.deepEqual(attrs(rows, ctx.samples.get("S1")?.id), { AGE: "45.0", FLAG: "TRUE" });
    assert.deepEqual(attrs(rows, ctx.samples.get("S2")?.id), { AGE: ">89", FLAG: "yes" });
    assert.deepEqual(attrs(rows, ctx.samples.get("S3")?.id), { AGE: "1e3", FLAG: "0" });
  });
});

test("C8: a duplicate sample row never replaces the first value (legacy throws, or keeps the first in relaxed mode)", async () => {
  await withCtx(async (ch, ctx) => {
    let threw = false;
    try {
      await samples(ctx, clinical([PID, SID, ["X", "X", "STRING", "1"]], [["P1", "S1", "first"], ["P1", "S1", "second"]]));
    } catch { threw = true; }
    const values = ch.rows("clinical_sample").filter((r) => r.attr_id === "X").map((r) => r.attr_value);
    if (!threw) assert.deepEqual(values, ["first"]);
    else assert.ok(!values.includes("second"));
  });
});

test("C8: a duplicate patient row never replaces the first value", async () => {
  await withCtx(async (ch, ctx) => {
    let threw = false;
    try {
      await patients(ctx, clinical([PID, ["X", "X", "STRING", "1"]], [["P1", "first"], ["P1", "second"]]));
    } catch { threw = true; }
    const values = ch.rows("clinical_patient").filter((r) => r.attr_id === "X").map((r) => r.attr_value);
    if (!threw) assert.deepEqual(values, ["first"]);
    else assert.ok(!values.includes("second"));
  });
});

// ---------------------------------------------------------------- S. segments

async function segments(ctx: ImportContext, body: string, meta = {}): Promise<SegmentTotals> {
  const totals: SegmentTotals = new Map();
  await importSegments(ctx, dataFile("segments", SEG_HEAD + body, meta), totals);
  return totals;
}

test("S1: chromosomes are stored as written (X stays X, 23 stays 23)", async () => {
  await withCtx(async (ch, ctx) => {
    await segments(ctx, "S1\tX\t1\t10\t3\t0.1\nS1\t23\t1\t10\t3\t0.1\nS1\t7\t1\t10\t3\t0.1\nS1\tY\t1\t10\t3\t0.1\n");
    assert.deepEqual(ch.rows("copy_number_seg").map((r) => r.chr), ["X", "23", "7", "Y"]);
  });
});

test("S1: a chromosome outside 1-24/X/Y (chr1, 25, M) is never stored", async () => {
  await withCtx(async (ch, ctx) => {
    try { await segments(ctx, "S1\tchr1\t1\t10\t3\t0.1\nS1\t25\t1\t10\t3\t0.1\nS1\tM\t1\t10\t3\t0.1\nS1\t2\t1\t10\t3\t0.1\n"); } catch { /* legacy throws on these */ }
    assert.ok(ch.rows("copy_number_seg").every((r) => r.chr === "2"));
  });
});

test("S1: start and end are truncated to integers; num_probes truncates", async () => {
  await withCtx(async (ch, ctx) => {
    await segments(ctx, "S1\t1\t100.7\t200.9\t5.9\t-0.25\n");
    const [r] = ch.rows("copy_number_seg");
    assert.equal(r.start, 100);
    assert.equal(r.end, 200);
    assert.equal(r.num_probes, 5);
    assert.equal(Number(r.segment_mean), -0.25);
  });
});

test("S1: a segment with start >= end is skipped and left out of the FGA totals", async () => {
  await withCtx(async (ch, ctx) => {
    const totals = await segments(ctx, "S1\t1\t100\t100\t5\t1\nS1\t1\t300\t200\t5\t1\nS1\t1\t0\t50\t5\t0.1\n");
    assert.equal(ch.rows("copy_number_seg").length, 1);
    assert.deepEqual(totals.get(ctx.samples.get("S1")!.id), [0, 50]);
    const r = ctx.reports.at(-1)!;
    assert.equal(r.stored, 1);
    assert.equal(Object.values(r.skipped).reduce((a, b) => a + b, 0), 2);
  });
});

test("S1: a TCGA normal sample is skipped and not created", async () => {
  await withCtx(async (ch, ctx) => {
    await segments(ctx, "TCGA-AB-1234-11\t1\t1\t10\t3\t0.5\n");
    assert.equal(ch.rows("copy_number_seg").length, 0);
    assert.equal(ctx.samples.size, 0);
  });
});

test("S1: an unknown sample is created and reported (intended departure: legacy aborts)", async () => {
  await withCtx(async (ch, ctx) => {
    await segments(ctx, "NEW1\t1\t1\t10\t3\t0.5\n");
    assert.equal(ch.rows("copy_number_seg").length, 1);
    assert.deepEqual(ctx.implicitSamples, ["NEW1"]);
  });
});

test("S2: FGA totals are length = end - start, altered when |seg_mean| >= 0.2, X and Y included", async () => {
  await withCtx(async (_ch, ctx) => {
    await samples(ctx, clinical([PID, SID], [["P1", "S1"], ["P2", "S2"]]));
    const totals = await segments(ctx, [
      "S1\t1\t0\t100\t1\t0.2", // altered (cutoff inclusive)
      "S1\t2\t0\t200\t1\t-0.2", // altered (absolute value)
      "S1\tX\t0\t300\t1\t0.19999", // not altered
      "S1\tY\t0\t400\t1\t-1.5", // altered
      "S2\t3\t1000\t2000\t1\t0"
    ].join("\n") + "\n");
    assert.deepEqual(totals.get(ctx.samples.get("S1")!.id), [700, 1000]);
    assert.deepEqual(totals.get(ctx.samples.get("S2")!.id), [0, 1000]);
  });
});

test("S2: FRACTION_GENOME_ALTERED is written as 4 decimals; NUMBER, sample-level, priority 20; none for zero length", async () => {
  await study({
    "meta_study.txt": META_STUDY,
    "meta_clinical_sample.txt": META_CS,
    "cs.txt": "PATIENT_ID\tSAMPLE_ID\nP1\tS1\nP2\tS2\nP3\tS3\n",
    "meta_cna_hg19_seg.txt": META_SEG,
    "seg.txt": SEG_HEAD + "S1\t1\t0\t100000\t10\t0.25\nS1\t2\t0\t900000\t10\t0.1\nS2\t1\t500\t500\t1\t1\nS3\t1\t0\t3\t1\t0.5\nS3\t1\t3\t6\t1\t0\nS3\t1\t6\t9\t1\t0\n"
  }, (ch) => {
    const fga = Object.fromEntries(ch.rows("clinical_sample").filter((r) => r.attr_id === "FRACTION_GENOME_ALTERED")
      .map((r) => [ch.rows("sample").find((s) => s.internal_id === r.internal_id)?.stable_id, r.attr_value]));
    assert.deepEqual(fga, { S1: "0.1000", S3: "0.3333" });
    const meta = metaOf(ch, "FRACTION_GENOME_ALTERED");
    assert.equal(meta.length, 1);
    assert.equal(meta[0].datatype, "NUMBER");
    assert.equal(meta[0].patient_attribute, 0);
    assert.equal(meta[0].priority, "20");
  });
});

test("S3: the segment file's reference_genome_id is stored as given", async () => {
  await withCtx(async (ch, ctx) => {
    await segments(ctx, "S1\t1\t1\t10\t3\t0.5\n", { reference_genome_id: "hg38", description: "my segs" });
    const [f] = ch.rows("copy_number_seg_file");
    assert.equal(f.reference_genome_id, "hg38");
    assert.equal(f.description, "my segs");
  });
});

test("S3: an unknown reference_genome_id is refused", { todo: "S3: spec says an invalid reference_genome_id throws; importer stores hg99" }, async () => {
  await withCtx(async (ch, ctx) => {
    let threw = false;
    try { await segments(ctx, "S1\t1\t1\t10\t3\t0.5\n", { reference_genome_id: "hg99" }); } catch { threw = true; }
    assert.ok(threw || !ch.rows("copy_number_seg_file").some((r) => r.reference_genome_id === "hg99"));
  });
});

// ---------------------------------------------------------------- X3. timeline

const TL_HEAD = "PATIENT_ID\tSTART_DATE\tSTOP_DATE\tEVENT_TYPE\tAgent\tNOTE\n";

const eventData = (ch: FakeCh, eventId: unknown) =>
  Object.fromEntries(ch.rows("clinical_event_data").filter((r) => r.clinical_event_id === eventId).map((r) => [r.key, r.value]));

test("X3: events of known patients are stored; empty STOP_DATE is null; keys as written", async () => {
  await withCtx(async (ch, ctx) => {
    await patients(ctx, clinical([PID], [["P1"]]));
    await importTimeline(ctx, dataFile("timeline", TL_HEAD + "P1\t10\t\tTREATMENT\tCisplatin\thello\nP1\t-5\t20\tSTATUS\tx\ty\n"));
    const ev = ch.rows("clinical_event");
    assert.equal(ev.length, 2);
    assert.deepEqual(ev.map((e) => [e.patient_id, e.start_date, e.stop_date, e.event_type]), [[ctx.patients.get("P1"), 10, null, "TREATMENT"], [ctx.patients.get("P1"), -5, 20, "STATUS"]]);
    assert.deepEqual(eventData(ch, ev[0].clinical_event_id), { Agent: "Cisplatin", NOTE: "hello" });
  });
});

test("X3: empty event attributes are not stored; NA is", { todo: "X3: spec says an NA event attribute is stored (only empty ones are dropped); importer drops NA too" }, async () => {
  await withCtx(async (ch, ctx) => {
    await patients(ctx, clinical([PID], [["P1"]]));
    await importTimeline(ctx, dataFile("timeline", TL_HEAD + "P1\t10\t\tTREATMENT\t\tNA\n"));
    const [ev] = ch.rows("clinical_event");
    assert.deepEqual(eventData(ch, ev.clinical_event_id), { NOTE: "NA" });
  });
});

test("X3: trailing empty fields vanish; a line with more fields than the header is skipped", { todo: "X3: spec says a line with more fields than the header is skipped; importer stores it" }, async () => {
  await withCtx(async (ch, ctx) => {
    await patients(ctx, clinical([PID], [["P1"]]));
    await importTimeline(ctx, dataFile("timeline", TL_HEAD + "P1\t1\t\tA\tx\n" + "P1\t2\t\tB\tx\ty\textra\n" + "P1\t3\t4\tC\t\t\t\n"));
    assert.deepEqual(ch.rows("clinical_event").map((e) => e.event_type), ["A", "C"]);
  });
});

test("X3: an unknown patient is skipped and not created; TCGA ids are not rewritten", async () => {
  await withCtx(async (ch, ctx) => {
    await patients(ctx, clinical([PID], [["TCGA-AB-1234"]]));
    const before = ctx.patients.size;
    await importTimeline(ctx, dataFile("timeline", TL_HEAD + "NOBODY\t1\t\tA\tx\ty\nTCGA-AB-1234-01\t1\t\tB\tx\ty\nTCGA-AB-1234\t1\t\tC\tx\ty\n"));
    assert.deepEqual(ch.rows("clinical_event").map((e) => e.event_type), ["C"]);
    assert.equal(ctx.patients.size, before);
  });
});

test("X3: a decimal START_DATE is not stored", { todo: "X3: spec says a decimal START_DATE is rejected (Long.valueOf throws); importer stores the event" }, async () => {
  await withCtx(async (ch, ctx) => {
    await patients(ctx, clinical([PID], [["P1"]]));
    try { await importTimeline(ctx, dataFile("timeline", TL_HEAD + "P1\t1.5\t\tA\tx\ty\nP1\t2\t\tB\tx\ty\n")); } catch { /* legacy throws */ }
    assert.ok(ch.rows("clinical_event").every((e) => e.event_type !== "A"));
  });
});

// ---------------------------------------------------------------- P. gene panels

async function panel(text: string, gs = genes([[7157, "TP53"], [1956, "EGFR"], [8085, "KMT2D", ["MLL2"]], [58508, "KMT2C", ["MLL2"]]]), existing = false) {
  const ch = fakeCh();
  try {
    if (existing) ch.answer(/FROM gene_panel WHERE/, [{ "1": 1 }]);
    const r = await importGenePanel(ch.conn, gs, text);
    return { r, panel: ch.rows("gene_panel"), list: ch.rows("gene_panel_list") };
  } finally { ch.restore(); }
}

test("P5: a panel whose genes all resolve is stored with its gene list", async () => {
  const { r, panel: p, list } = await panel("stable_id: IMPACT2\ndescription: two genes\ngene_list: TP53\tEGFR\n");
  assert.equal(r.id, "IMPACT2");
  assert.equal(p.length, 1);
  assert.equal(p[0].stable_id, "IMPACT2");
  assert.equal(p[0].description, "two genes");
  assert.deepEqual(list.map((x) => x.gene_id).sort(), [1956, 7157]);
  assert.ok(list.every((x) => x.internal_id === p[0].internal_id));
});

test("P5: a panel with an unresolved gene is not imported at all, with a warning", async () => {
  const { r, panel: p, list } = await panel("stable_id: BAD\ndescription: d\ngene_list: TP53\tNOTAGENE\n");
  assert.equal(p.length, 0);
  assert.equal(list.length, 0);
  assert.ok(r.warning);
});

test("P5: a panel listing the same gene twice is not imported", async () => {
  const { r, panel: p } = await panel("stable_id: DUP\ndescription: d\ngene_list: TP53\t7157\n");
  assert.equal(p.length, 0);
  assert.ok(r.warning);
});

test("P5: an ambiguous alias takes the first match", async () => {
  const { panel: p, list } = await panel("stable_id: AMB\ndescription: d\ngene_list: MLL2\tTP53\n");
  assert.equal(p.length, 1);
  assert.equal(list.length, 2);
});

test("P5: a panel already in the database is kept as it is", async () => {
  const { r, panel: p, list } = await panel("stable_id: IMPACT2\ndescription: new\ngene_list: TP53\n", undefined, true);
  assert.equal(p.length, 0);
  assert.equal(list.length, 0);
  assert.ok(r.warning || r.id === "IMPACT2");
});

async function withMatrix(fn: (ctx: ImportContext, run: (text: string) => Promise<void>) => Promise<void>) {
  await withCtx(async (_ch, ctx) => {
    ctx.profiles.push({ id: 11, stableId: "test_study_mutations", type: "MUTATION_EXTENDED", datatype: "MAF", showInAnalysisTab: true });
    ctx.profiles.push({ id: 12, stableId: "test_study_gistic", type: "COPY_NUMBER_ALTERATION", datatype: "DISCRETE", showInAnalysisTab: true });
    ctx.panels.set("IMPACT468", 468);
    ctx.panels.set("IMPACT341", 341);
    await samples(ctx, clinical([PID, SID], [["P1", "S1"], ["P2", "S2"], ["P3", "S3"], ["P4", "S4"]]));
    await fn(ctx, (text) => importGenePanelMatrix(ctx, dataFile("gene_panel_matrix", text)));
  });
}

const panelOf = (ctx: ImportContext, sample: string, profile: number) => ctx.sampleProfile.get(ctx.samples.get(sample)!.id + ":" + profile)?.panel;

test("P2: a matrix panel overrides the data-derived panel and adds samples without data", async () => {
  await withMatrix(async (ctx, run) => {
    ctx.profiled(ctx.samples.get("S1")!.id, 11, null);
    await run("SAMPLE_ID\tmutations\tgistic\nS1\tIMPACT468\tIMPACT341\nS2\tIMPACT341\tNA\n");
    assert.equal(panelOf(ctx, "S1", 11), 468);
    assert.equal(panelOf(ctx, "S1", 12), 341);
    assert.equal(panelOf(ctx, "S2", 11), 341);
  });
});

test("P2: NA adds nothing and keeps a data-derived entry (exact, case-sensitive)", async () => {
  await withMatrix(async (ctx, run) => {
    ctx.profiled(ctx.samples.get("S1")!.id, 11, 341);
    await run("SAMPLE_ID\tmutations\nS1\tNA\nS2\tNA\n");
    assert.equal(panelOf(ctx, "S1", 11), 341);
    assert.equal(ctx.sampleProfile.has(ctx.samples.get("S2")!.id + ":11"), false);
  });
});

test("P2: WXS, WGS and WXS/WGS mean a null panel (whole exome/genome)", async () => {
  await withMatrix(async (ctx, run) => {
    ctx.profiled(ctx.samples.get("S1")!.id, 11, 341);
    await run("SAMPLE_ID\tmutations\nS1\tWXS\nS2\tWGS\nS3\tWXS/WGS\n");
    for (const s of ["S1", "S2", "S3"]) {
      assert.ok(ctx.sampleProfile.has(ctx.samples.get(s)!.id + ":11"), s);
      assert.equal(panelOf(ctx, s, 11), null, s);
    }
  });
});

test("P2: matrix columns name profiles with or without the study prefix", async () => {
  await withMatrix(async (ctx, run) => {
    await run("SAMPLE_ID\ttest_study_mutations\tgistic\nS1\tIMPACT468\tIMPACT468\n");
    assert.equal(panelOf(ctx, "S1", 11), 468);
    assert.equal(panelOf(ctx, "S1", 12), 468);
  });
});

test("P2: an unknown panel id never becomes a sample_profile entry", async () => {
  await withMatrix(async (ctx, run) => {
    try { await run("SAMPLE_ID\tmutations\nS1\tNO_SUCH_PANEL\n"); } catch { /* legacy throws */ }
    assert.equal(ctx.sampleProfile.has(ctx.samples.get("S1")!.id + ":11"), false);
  });
});

const MAF_HEAD = "Hugo_Symbol\tEntrez_Gene_Id\tTumor_Sample_Barcode\tVariant_Classification\tChromosome\tStart_Position\tEnd_Position\tReference_Allele\tTumor_Seq_Allele2\tHGVSp_Short\n";
const META_MUT = "cancer_study_identifier: st\ngenetic_alteration_type: MUTATION_EXTENDED\ndatatype: MAF\nstable_id: mutations\nshow_profile_in_analysis_tab: true\nprofile_name: Mutations\nprofile_description: m\ndata_filename: m.txt\n";
const TP53 = [{ e: 7157, h: "TP53", t: "protein-coding", g: 1 }];

const profiledSamples = (ch: FakeCh, profileStable: string) => {
  const p = ch.rows("genetic_profile").find((r) => r.stable_id === profileStable);
  const byId = new Map(ch.rows("sample").map((s) => [s.internal_id, s.stable_id]));
  return Object.fromEntries(ch.rows("sample_profile").filter((r) => r.genetic_profile_id === p?.genetic_profile_id).map((r) => [byId.get(r.sample_id), r.panel_id]));
};

test("P1/P3: mutation profiling = samples with an accepted mutation or in #sequenced_samples; no panel means null", async () => {
  await study({
    "meta_study.txt": META_STUDY,
    "meta_clinical_sample.txt": META_CS,
    "cs.txt": "PATIENT_ID\tSAMPLE_ID\nP1\tS1\nP2\tS2\nP3\tS3\nP4\tS4\n",
    "meta_mutations.txt": META_MUT,
    "m.txt": "#sequenced_samples: S3\n" + MAF_HEAD + "TP53\t7157\tS1\tMissense_Mutation\t17\t100\t100\tC\tT\tp.R1H\nTP53\t7157\tS2\tSilent\t17\t200\t200\tC\tT\tp.R2R\n"
  }, (ch) => {
    assert.deepEqual(profiledSamples(ch, "st_mutations"), { S1: null, S3: null });
  }, TP53);
});

test("P1: the meta file's gene_panel is every profiled sample's panel", async () => {
  await study({
    "meta_study.txt": META_STUDY,
    "meta_clinical_sample.txt": META_CS,
    "cs.txt": "PATIENT_ID\tSAMPLE_ID\nP1\tS1\n",
    "meta_mutations.txt": META_MUT + "gene_panel: IMPACT2\n",
    "m.txt": MAF_HEAD + "TP53\t7157\tS1\tMissense_Mutation\t17\t100\t100\tC\tT\tp.R1H\n",
    "data_gene_panel_impact2.txt": "stable_id: IMPACT2\ndescription: d\ngene_list: TP53\n"
  }, (ch) => {
    const panelId = ch.rows("gene_panel").find((p) => p.stable_id === "IMPACT2")?.internal_id;
    assert.ok(panelId !== undefined, "panel shipped with the study is imported");
    assert.deepEqual(profiledSamples(ch, "st_mutations"), { S1: panelId });
  }, TP53);
});

test("P1: a tab-delimited profile marks every header sample profiled, values or not", async () => {
  await study({
    "meta_study.txt": META_STUDY,
    "meta_clinical_sample.txt": META_CS,
    "cs.txt": "PATIENT_ID\tSAMPLE_ID\nP1\tS1\nP2\tS2\n",
    "meta_cna.txt": "cancer_study_identifier: st\ngenetic_alteration_type: COPY_NUMBER_ALTERATION\ndatatype: DISCRETE\nstable_id: gistic\nshow_profile_in_analysis_tab: true\nprofile_name: CNA\nprofile_description: c\ndata_filename: cna.txt\n",
    "cna.txt": "Hugo_Symbol\tEntrez_Gene_Id\tS1\tS2\nTP53\t7157\t0\tNA\n"
  }, (ch) => {
    assert.deepEqual(profiledSamples(ch, "st_gistic"), { S1: null, S2: null });
  }, TP53);
});

test("P2 (via the study): the matrix adds a sample with no mutations, which then gets MUTATION_COUNT 0", async () => {
  await study({
    "meta_study.txt": META_STUDY,
    "meta_clinical_sample.txt": META_CS,
    "cs.txt": "PATIENT_ID\tSAMPLE_ID\nP1\tS1\nP2\tS2\n",
    "meta_mutations.txt": META_MUT,
    "m.txt": MAF_HEAD + "TP53\t7157\tS1\tMissense_Mutation\t17\t100\t100\tC\tT\tp.R1H\n",
    "data_gene_panel_impact2.txt": "stable_id: IMPACT2\ndescription: d\ngene_list: TP53\n",
    "meta_gene_panel_matrix.txt": "cancer_study_identifier: st\ngenetic_alteration_type: GENE_PANEL_MATRIX\ndatatype: GENE_PANEL_MATRIX\ndata_filename: gpm.txt\n",
    "gpm.txt": "SAMPLE_ID\tmutations\nS1\tWXS\nS2\tIMPACT2\n"
  }, (ch) => {
    const panelId = ch.rows("gene_panel").find((p) => p.stable_id === "IMPACT2")?.internal_id;
    assert.deepEqual(profiledSamples(ch, "st_mutations"), { S1: null, S2: panelId });
    const mc = ch.rows("clinical_sample").filter((r) => r.attr_id === "MUTATION_COUNT" && r.internal_id === sampleIdOf(ch, "S2"));
    assert.deepEqual(mc.map((r) => r.attr_value), ["0"]);
  }, TP53);
});

// ---------------------------------------------------------------- L. case lists

test("L1: case_list_ids split on tabs only; an empty category becomes other", async () => {
  const dir = studyDir({
    "meta_study.txt": META_STUDY,
    "case_lists/cases_a.txt": "cancer_study_identifier: st\nstable_id: st_a\ncase_list_name: A\ncase_list_description: a\ncase_list_category:\ncase_list_ids: S1\tS2 S3\tS4,S5\n"
  });
  const s = await readStudyFolder(dir, "st");
  const list = s.caseLists.find((c) => c.stableId === "st_a");
  assert.ok(list);
  assert.deepEqual(list.ids, ["S1", "S2 S3", "S4,S5"]);
  assert.equal(list.category, "other");
  assert.equal(list.name, "A");
  assert.equal(list.description, "a");
});

test("L1: a patient id adds all its samples; unknown ids drop; duplicates collapse in first-seen order; ids not prefixed", async () => {
  await study({
    "meta_study.txt": META_STUDY,
    "meta_clinical_sample.txt": META_CS,
    "cs.txt": "PATIENT_ID\tSAMPLE_ID\nP-001\tP-001-T01\nP-001\tP-001-T02\nP-002\tS9\nTCGA-AB-1234\tTCGA-AB-1234-01\n",
    "case_lists/cases_x.txt": "cancer_study_identifier: st\nstable_id: my_list\ncase_list_name: X\ncase_list_description: x\ncase_list_category: all_cases_with_mutation_data\n" +
      "case_list_ids: S9\tGHOST\tP-001\tS9\tP-001-T01\tTCGA-AB-1234-01A-11D\n"
  }, (ch) => {
    assert.deepEqual(listMembers(ch, "my_list"), ["S9", "P-001-T01", "P-001-T02", "TCGA-AB-1234-01"]);
    assert.equal(ch.rows("sample_list").find((r) => r.stable_id === "my_list")?.category, "all_cases_with_mutation_data");
  });
});

test("L2: <study>_all holds every sample in the study, including ones a data file created", async () => {
  await study({
    "meta_study.txt": META_STUDY,
    "meta_clinical_sample.txt": META_CS,
    "cs.txt": "PATIENT_ID\tSAMPLE_ID\nP1\tS1\nP2\tS2\n",
    "meta_cna_hg19_seg.txt": META_SEG,
    "seg.txt": SEG_HEAD + "S3\t1\t0\t10\t1\t0.5\n"
  }, (ch) => {
    assert.deepEqual(listMembers(ch, "st_all")?.sort(), ["S1", "S2", "S3"]);
    assert.ok(patientIdOf(ch, "S3") !== undefined, "an implicit sample gets a patient of the same id");
  });
});

test("L2: a study-supplied _all list is kept, not regenerated", async () => {
  await study({
    "meta_study.txt": META_STUDY,
    "meta_clinical_sample.txt": META_CS,
    "cs.txt": "PATIENT_ID\tSAMPLE_ID\nP1\tS1\nP2\tS2\n",
    "case_lists/cases_all.txt": "cancer_study_identifier: st\nstable_id: st_all\ncase_list_name: Mine\ncase_list_description: mine\ncase_list_category: all_cases_in_study\ncase_list_ids: S1\n"
  }, (ch) => {
    const all = ch.rows("sample_list").filter((r) => r.stable_id === "st_all");
    assert.equal(all.length, 1);
    assert.equal(all[0].name, "Mine");
    assert.deepEqual(listMembers(ch, "st_all"), ["S1"]);
  });
});

test("L2: the generated _all list is named and described as cBioPortal's", { todo: "L2: spec says name/description 'All cases in study', category 'other'; importer writes 'All samples', '... (generated by cBioLab)', 'all_cases_in_study'" }, async () => {
  await study({ "meta_study.txt": META_STUDY, "meta_clinical_sample.txt": META_CS, "cs.txt": "PATIENT_ID\tSAMPLE_ID\nP1\tS1\n" }, (ch) => {
    const all = ch.rows("sample_list").find((r) => r.stable_id === "st_all");
    assert.equal(all?.name, "All cases in study");
    assert.equal(all?.description, "All cases in study");
    assert.equal(all?.category, "other");
  });
});

// ---------------------------------------------------------------- X5. study and profile metadata

test("X5: type_of_cancer is lowercased", { todo: "X5: spec says type_of_cancer is lowercased; importer stores 'BRCA' as written" }, async () => {
  await study({ "meta_study.txt": META_STUDY.replace("brca", "BRCA"), "meta_clinical_sample.txt": META_CS, "cs.txt": "PATIENT_ID\tSAMPLE_ID\nP1\tS1\n" }, (ch) => {
    assert.equal(ch.rows("cancer_study")[0].type_of_cancer_id, "brca");
  });
});

test("X5: groups are uppercased; access defaults to public; reference genome defaults to hg19", { todo: "X5: spec says groups are uppercased; importer stores 'pub;Lab' as written" }, async () => {
  const ch = fakeCh();
  try {
    ch.answer(/FROM reference_genome WHERE name = 'hg19'/, [{ i: 1 }]);
    await importStudy(ch.conn, "/nonexistent", studyDir({
      "meta_study.txt": META_STUDY + "groups: pub;Lab\n", "meta_clinical_sample.txt": META_CS, "cs.txt": "PATIENT_ID\tSAMPLE_ID\nP1\tS1\n"
    }), "st", () => {}, false, false);
    const [cs] = ch.rows("cancer_study");
    assert.equal(cs.public, 1);
    assert.equal(cs.reference_genome_id, 1);
    assert.equal(String(cs.groups).toUpperCase(), cs.groups);
    assert.deepEqual(String(cs.groups).split(";"), ["PUB", "LAB"]);
  } finally { ch.restore(); }
});

test("X5: a profile stable_id gets the study prefix only when it lacks it", { todo: "X5: spec says the prefix is added only if missing; importer turns st_mutations into st_st_mutations" }, async () => {
  await study({
    "meta_study.txt": META_STUDY,
    "meta_clinical_sample.txt": META_CS,
    "cs.txt": "PATIENT_ID\tSAMPLE_ID\nP1\tS1\n",
    "meta_mutations.txt": META_MUT.replace("stable_id: mutations", "stable_id: st_mutations"),
    "m.txt": MAF_HEAD
  }, (ch) => {
    assert.deepEqual(ch.rows("genetic_profile").map((p) => p.stable_id), ["st_mutations"]);
  }, TP53);
});

const META_CNA_BARE = "cancer_study_identifier: st\ngenetic_alteration_type: COPY_NUMBER_ALTERATION\ndatatype: DISCRETE\nstable_id: gistic\nshow_profile_in_analysis_tab: true\ndata_filename: cna.txt\n";

test("X5: a profile stable_id without the study prefix gets it", async () => {
  await study({ "meta_study.txt": META_STUDY, "meta_clinical_sample.txt": META_CS, "cs.txt": "PATIENT_ID\tSAMPLE_ID\nP1\tS1\n", "meta_cna.txt": META_CNA_BARE, "cna.txt": "Hugo_Symbol\tS1\nTP53\t0\n" }, (ch) => {
    assert.deepEqual(ch.rows("genetic_profile").map((p) => p.stable_id), ["st_gistic"]);
  }, TP53);
});

test("X5: a missing profile_name and profile_description default to the alteration type", { todo: "X5: spec says name/description default to the alteration type; importer uses the stable id as name and leaves description null" }, async () => {
  await study({ "meta_study.txt": META_STUDY, "meta_clinical_sample.txt": META_CS, "cs.txt": "PATIENT_ID\tSAMPLE_ID\nP1\tS1\n", "meta_cna.txt": META_CNA_BARE, "cna.txt": "Hugo_Symbol\tS1\nTP53\t0\n" }, (ch) => {
    const [cna] = ch.rows("genetic_profile");
    assert.equal(cna.name, "COPY_NUMBER_ALTERATION");
    assert.equal(cna.description, "COPY_NUMBER_ALTERATION");
  }, TP53);
});

test("X5: tabs in a profile description become spaces", { todo: "X5: spec says tabs in the description become spaces; importer stores a literal backslash-t" }, async () => {
  await study({
    "meta_study.txt": META_STUDY,
    "meta_clinical_sample.txt": META_CS,
    "cs.txt": "PATIENT_ID\tSAMPLE_ID\nP1\tS1\n",
    "meta_mutations.txt": META_MUT.replace("profile_description: m", "profile_description: a\tb"),
    "m.txt": MAF_HEAD
  }, (ch) => {
    assert.equal(ch.rows("genetic_profile")[0].description, "a b");
  }, TP53);
});
