// Example updates to a study in the lab_ tables (lib/importer/lab-edits.ts; docs/LOCAL.md "Live
// updates and reviews"): each edit is planned (what it would write, what of it exists) and then
// applied, skipping what exists or writing it again as a new version; generated values are a
// function of the seed; each keeps the tables as an import would leave them (counts recomputed).
// ClickHouse is test/support/fake-ch.ts, answering as a small study.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeCh, type FakeCh } from "./support/fake-ch.ts";
import { LAB_TABLES, columnsOf } from "../lib/importer/lab-schema.ts";
import { GENES, applyEdit, continuousProfiles, planEdit, rng } from "../lib/importer/lab-edits.ts";

let ch: FakeCh | null = null;
afterEach(() => { ch?.restore(); ch = null; });

type Row = Record<string, unknown>;
interface Study {
  /** sample → patient, of the study's existing samples */
  samples: [string, string][];
  /** sample ids the edit's new ids collide with */
  existing?: string[];
  hasProfile?: boolean;
  hasAttribute?: boolean;
  hasMutationProfile?: boolean;
  hasMutationCount?: boolean;
  /** samples profiled for mutations, with their panel */
  mutationSamples?: { s: string; p: string; panel: string }[];
  existingMutations?: Row[];
  continuous?: string[];
  existingValues?: string[];
}

const GENE_ROWS = [{ e: 7157, h: "TP53" }, { e: 3845, h: "KRAS" }, { e: 5290, h: "PIK3CA" }];

function database(s: Study): FakeCh {
  const c = fakeCh();
  ch = c;
  const bool = (b: boolean | undefined) => [{ n: b ? 1 : 0 }];
  c.answer(/AND NOT startsWith\(sample_id/, (sql) => {
    const n = Number(/LIMIT (\d+)\s+FORMAT/.exec(sql)![1]);
    return s.samples.slice(0, n).map(([sm, p]) => ({ s: sm, p }));
  });
  c.answer(/SELECT sample_id AS x FROM lab_sample FINAL WHERE study_id = 'st' AND sample_id IN/, () => (s.existing ?? []).map((x) => ({ x })));
  c.answer(/max\(sv_index\) \+ 1/, [{ n: 7 }]);
  c.answer(/SELECT profile_id AS x FROM lab_profile FINAL WHERE study_id = 'st' AND profile_id = /, () => s.hasProfile ? [{ x: "st_demo_expression" }] : []);
  c.answer(/SELECT count\(\) AS n FROM lab_profile FINAL WHERE study_id = 'st' AND profile_id = 'st_demo/, () => bool(s.hasProfile));
  c.answer(/SELECT count\(\) AS n FROM lab_profile FINAL WHERE study_id = 'st' AND profile_id = 'st_mutations'/, () => bool(s.hasMutationProfile));
  c.answer(/SELECT attr_id AS x FROM lab_clinical_attribute FINAL/, () => s.hasAttribute ? [{ x: "DEMO_RESPONSE" }] : []);
  c.answer(/FROM lab_clinical_attribute FINAL WHERE study_id = 'st' AND attr_id = 'MUTATION_COUNT'/, () => bool(s.hasMutationCount));
  c.answer(/FROM lab_clinical_attribute FINAL WHERE study_id = 'st' AND attr_id = /, () => bool(s.hasAttribute));
  c.answer(/FROM gene\s+WHERE entrez_gene_id > 0/, (sql) => GENE_ROWS.slice(0, Number(/LIMIT (\d+)\s+FORMAT/.exec(sql)![1])));
  c.answer(/AS panel\s+FROM lab_sample_profile/, () => s.mutationSamples ?? []);
  c.answer(/any\(r\.chr\) AS chr/, [{ e: 7157, h: "TP53", t: "protein-coding", chr: "17", start: 7_500_000 }, { e: 3845, h: "KRAS", t: "protein-coding", chr: null, start: null }]);
  c.answer(/concat\(gp\.stable_id, '\|', g\.hugo_gene_symbol\)/, [{ x: "IMPACT|TP53" }]);
  c.answer(/FROM lab_mutation FINAL WHERE study_id = 'st' LIMIT 1/, [{ center: "MSK", mutation_status: "SOMATIC" }]);
  c.answer(/FROM lab_mutation FINAL\s+WHERE study_id = 'st' AND profile_id = 'st_mutations' AND \(sample_id/, () => s.existingMutations ?? []);
  c.answer(/SELECT profile_id AS x FROM lab_profile FINAL WHERE study_id = 'st' AND datatype != 'DISCRETE'/, () => (s.continuous ?? []).map((x) => ({ x })));
  c.answer(/SELECT sample_id AS x FROM lab_sample_profile FINAL/, (sql) => s.samples.slice(0, Number(/LIMIT (\d+)\s+FORMAT/.exec(sql)![1])).map(([x]) => ({ x })));
  c.answer(/concat\(hugo_gene_symbol, ' in ', sample_id/, () => (s.existingValues ?? []).map((x) => ({ x })));
  c.answer(/SELECT count\(\) AS n FROM lab_(sample|patient) FINAL WHERE study_id = 'st'$/m, () => [{ n: s.samples.length }]);
  c.answer(/SELECT count\(\) AS n FROM/, [{ n: 3 }]);
  return c;
}

const SAMPLES: [string, string][] = [["A1", "PA"], ["B1", "PB"], ["C1", "PC"]];
const inserts = (c: FakeCh, table: string) => c.statements.filter((s) => new RegExp("^INSERT INTO " + table + "\\b").test(s));

test("rng is deterministic per seed and stays in [0, 1)", () => {
  const a = rng(42), b = rng(42), c = rng(43);
  const xs = Array.from({ length: 200 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 200 }, () => b()));
  assert.notDeepEqual(xs.slice(0, 5), Array.from({ length: 5 }, () => c()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.ok(new Set(xs).size > 190, "values do not repeat early");
});

test("planning new samples: ids from the prefix, one template per patient, and the rows each table would get", async () => {
  const c = database({ samples: SAMPLES, existing: ["X-S2"] });
  const plan = await planEdit(c.conn, "st", { kind: "samples", count: 2, prefix: "X!" });
  assert.match(plan.summary, /^2 new samples \(X-S1 … X-S2\), each a copy of an existing sample of another patient/);
  assert.deepEqual(plan.conflicts, [{ what: "samples already in the study", count: 1, examples: ["X-S2"] }]);
  const sampleTables = Object.keys(LAB_TABLES).filter((t) => columnsOf(t).includes("sample_id") || columnsOf(t).includes("patient_id"));
  assert.deepEqual(Object.keys(plan.rows).sort(), sampleTables.sort());
  assert.ok(Object.values(plan.rows).every((n) => n === 3));
  assert.ok(c.statements.some((s) => /NOT startsWith\(sample_id, 'X-'\)/.test(s) && /LIMIT 1 BY patient_id LIMIT 2\s+FORMAT/.test(s)), "templates exclude earlier copies, one per patient");
  assert.ok(!c.statements.some((s) => s.startsWith("INSERT")), "planning writes nothing");
});

test("new samples need as many patients to copy from", async () => {
  const c = database({ samples: SAMPLES });
  await assert.rejects(planEdit(c.conn, "st", { kind: "samples", count: 5 }), /st has 3 patients to copy samples from; 5 new samples need as many/);
});

test("applying new samples copies each template's rows under the new ids, skipping ids that exist, and recomputes the counts", async () => {
  const c = database({ samples: SAMPLES, existing: ["DEMO-S1"] });
  const r = await applyEdit(c.conn, "st", { kind: "samples", count: 2 }, "skip", false);
  const [sample] = inserts(c, "lab_sample");
  // DEMO-S1 exists: only DEMO-S2 (of patient DEMO-P2, from template B1 of PB) is written
  assert.ok(sample.includes("transform(src.sample_id, ['B1'], ['DEMO-S2'], src.sample_id) AS sample_id"));
  assert.ok(sample.includes("transform(src.sample_id, ['B1'], ['DEMO-P2'], src.patient_id) AS patient_id"));
  const clinical = inserts(c, "lab_clinical").find((s) => /transform/.test(s))!;
  assert.match(clinical, /if\(src\.sample_id = '', '', transform/, "a patient's clinical row stays a patient row");
  assert.match(clinical, /\(sample_id IN \('B1'\) OR \(sample_id = '' AND patient_id IN \('PB'\)\)\)/);
  const sv = inserts(c, "lab_structural_variant")[0];
  assert.match(sv, /toUInt32\(7 \+ rowNumberInAllBlocks\(\)\) AS sv_index/, "copied SVs are numbered after the study's");
  const patient = inserts(c, "lab_patient")[0];
  assert.ok(patient.includes("transform(src.patient_id, ['PB'], ['DEMO-P2'], src.patient_id) AS patient_id"));
  assert.ok(!c.statements.some((s) => / 1 FROM lab_\w+ FINAL\s+WHERE/.test(s) && /, 1 FROM/.test(s)), "skip writes no deletion markers");
  assert.ok(inserts(c, "lab_study").length === 1, "the study's counts are recomputed");
  assert.ok(c.statements.some((s) => /'SAMPLE_COUNT'/.test(s) && /patient_id IN \('DEMO-P2'\)/.test(s)));
  assert.equal(r.rows.lab_sample, 3);
  assert.deepEqual(r.merged, []);
});

test("applying new samples as an update first marks the existing copies deleted, then writes them again", async () => {
  const c = database({ samples: SAMPLES, existing: ["DEMO-S1"] });
  await applyEdit(c.conn, "st", { kind: "samples", count: 2 }, "update", false);
  const del = c.statements.find((s) => /^INSERT INTO lab_sample \(/.test(s) && /, 1 FROM lab_sample FINAL/.test(s))!;
  assert.match(del, /sample_id IN \('DEMO-S1'\)/);
  const delClinical = c.statements.find((s) => /^INSERT INTO lab_clinical \(/.test(s) && /, 1 FROM lab_clinical FINAL/.test(s))!;
  assert.match(delClinical, /\(sample_id IN \('DEMO-S1'\) OR \(sample_id = '' AND patient_id IN \('DEMO-P1'\)\)\)/);
  assert.ok(c.statements.indexOf(del) < c.statements.findIndex((s) => s.includes("['DEMO-S1', 'DEMO-S2']")), "deletions before the new versions");
});

test("new samples that all exist, skipped, write nothing", async () => {
  const c = database({ samples: SAMPLES, existing: ["DEMO-S1"] });
  const r = await applyEdit(c.conn, "st", { kind: "samples", count: 1 }, "skip", false);
  assert.deepEqual(r.rows, {});
  assert.ok(!c.statements.some((s) => s.startsWith("INSERT")));
});

test("a new profile: planned per sample and gene; applied with its profile row, every sample profiled, and generated values", async () => {
  const c = database({ samples: SAMPLES });
  const plan = await planEdit(c.conn, "st", { kind: "profile", profileKind: "methylation", genes: 2 });
  assert.match(plan.summary, /a new METHYLATION profile st_demo_methylation \("Demo methylation \(beta values\)"\): values for 2 genes in all 3 samples/);
  assert.deepEqual(plan.rows, { lab_profile: 1, lab_sample_profile: 3, lab_profile_value: 6 });
  assert.deepEqual(plan.conflicts, []);
  const r = await applyEdit(c.conn, "st", { kind: "profile", genes: 2, seed: 9 }, "skip", false);
  const [p] = c.rows("lab_profile");
  assert.deepEqual([p.profile_id, p.alteration_type, p.datatype, p.show_in_analysis_tab, p.is_deleted], ["st_demo_expression", "MRNA_EXPRESSION", "Z-SCORE", 1, 0]);
  assert.match(inserts(c, "lab_sample_profile")[0], /'st_demo_expression', 'MRNA_EXPRESSION', ''/);
  const values = inserts(c, "lab_profile_value")[0];
  assert.ok(values.includes("[(7157, 'TP53'), (3845, 'KRAS')]"));
  assert.match(values, /sipHash64\(9, 1, s\.sample_id, g\.e\)/, "values are a function of the seed");
  assert.deepEqual(Object.keys(r.rows), ["lab_profile", "lab_sample_profile", "lab_profile_value"]);
});

test("an existing profile is left alone when skipping, and replaced (old values marked deleted) when updating", async () => {
  const c = database({ samples: SAMPLES, hasProfile: true });
  const plan = await planEdit(c.conn, "st", { kind: "profile" });
  assert.deepEqual(plan.conflicts, [{ what: "profile already in the study", count: 1, examples: ["st_demo_expression"] }]);
  assert.deepEqual((await applyEdit(c.conn, "st", { kind: "profile" }, "skip", false)).rows, {});
  assert.equal(c.rows("lab_profile").length, 0);
  await applyEdit(c.conn, "st", { kind: "profile", profileKind: "protein" }, "update", false);
  assert.ok(c.statements.some((s) => /^INSERT INTO lab_profile_value SELECT \* REPLACE \(\d+ AS version, 1 AS is_deleted\)/.test(s)));
  assert.ok(c.statements.some((s) => /^INSERT INTO lab_sample_profile SELECT \* REPLACE \(\d+ AS version, 1 AS is_deleted\)/.test(s)));
  assert.equal(c.rows("lab_profile")[0].alteration_type, "PROTEIN_LEVEL");
});

test("a new clinical attribute: its id normalized, a value for every sample or patient, about one in ten empty", async () => {
  const c = database({ samples: SAMPLES });
  const plan = await planEdit(c.conn, "st", { kind: "clinical", attribute: "my-score", level: "patient", datatype: "NUMBER" });
  assert.match(plan.summary, /^a new patient attribute MY_SCORE \(NUMBER\) with a value for every patient/);
  assert.deepEqual(plan.rows, { lab_clinical_attribute: 1, lab_clinical: 3 });
  await applyEdit(c.conn, "st", { kind: "clinical", attribute: "my-score", level: "patient", datatype: "NUMBER" }, "skip", false);
  const [a] = c.rows("lab_clinical_attribute");
  assert.deepEqual([a.attr_id, a.display_name, a.datatype, a.patient_attribute], ["MY_SCORE", "My Score", "NUMBER", 1]);
  const ins = inserts(c, "lab_clinical")[0];
  assert.match(ins, /FROM lab_patient FINAL/);
  assert.match(ins, /SELECT study_id, patient_id, '', 'MY_SCORE'/, "a patient attribute's rows have no sample");
  assert.match(ins, /% 10 = 0, ''/);
  assert.match(ins, /toString\(round\(/, "a NUMBER attribute gets numbers");
});

test("a sample STRING attribute draws from response categories; an existing one is skipped", async () => {
  const c = database({ samples: SAMPLES });
  await applyEdit(c.conn, "st", { kind: "clinical" }, "update", false);
  const ins = inserts(c, "lab_clinical")[0];
  assert.match(ins, /FROM lab_sample FINAL/);
  assert.ok(ins.includes("'Complete response', 'Partial response', 'Stable disease', 'Progressive disease'"));
  assert.equal(c.rows("lab_clinical_attribute")[0].attr_id, "DEMO_RESPONSE");
  ch!.restore();
  const d = database({ samples: SAMPLES, hasAttribute: true });
  const plan = await planEdit(d.conn, "st", { kind: "clinical" });
  assert.deepEqual(plan.conflicts, [{ what: "attribute already in the study", count: 1, examples: ["DEMO_RESPONSE"] }]);
  assert.deepEqual((await applyEdit(d.conn, "st", { kind: "clinical" }, "skip", false)).rows, {});
  assert.equal(d.rows("lab_clinical_attribute").length, 0);
});

const MUT_SAMPLES = [{ s: "A1", p: "PA", panel: "IMPACT" }, { s: "B1", p: "PB", panel: "" }];

test("mutations need the study's mutation profile", async () => {
  const c = database({ samples: SAMPLES, hasMutationProfile: false });
  await assert.rejects(planEdit(c.conn, "st", { kind: "mutations" }), /st has no mutation profile \(st_mutations\) to add mutations to/);
});

test("generated mutations: missense, in GENES, with their sample's patient and panel, the same for the same seed", async () => {
  const c = database({ samples: SAMPLES, hasMutationProfile: true, mutationSamples: MUT_SAMPLES });
  const plan = await planEdit(c.conn, "st", { kind: "mutations", count: 2, perSample: 3, seed: 5 });
  assert.equal(plan.summary, `6 missense mutations in 2 samples profiled for st_mutations, in ${GENES.length} cancer genes`);
  assert.deepEqual(plan.rows, { lab_mutation: 6, lab_clinical: 2 });
  await applyEdit(c.conn, "st", { kind: "mutations", count: 2, perSample: 3, seed: 5 }, "skip", false);
  const rows = c.rows("lab_mutation");
  assert.equal(rows.length, 6);
  for (const m of rows) {
    assert.equal(m.mutation_type, "Missense_Mutation");
    assert.equal(m.center, "MSK", "other fields come from an existing mutation of the study");
    assert.match(String(m.protein_change), /^[ACDEFGHIKLMNPQRSTVWY]\d+[ACDEFGHIKLMNPQRSTVWY]$/);
    assert.equal(m.patient_id, m.sample_id === "A1" ? "PA" : "PB");
    // on IMPACT only TP53 is listed; no panel is whole exome
    assert.equal(m.off_panel, m.panel_id === "IMPACT" && m.hugo_gene_symbol !== "TP53" ? 1 : 0);
    if (m.hugo_gene_symbol === "KRAS") assert.equal(m.chr, "1", "a gene without a locus is placed on chr 1");
  }
  c.restore();
  const again = database({ samples: SAMPLES, hasMutationProfile: true, mutationSamples: MUT_SAMPLES });
  await applyEdit(again.conn, "st", { kind: "mutations", count: 2, perSample: 3, seed: 5 }, "skip", false);
  const strip = (xs: Row[]) => xs.map(({ version: _v, ...r }) => r);
  assert.deepEqual(strip(again.rows("lab_mutation")), strip(rows));
});

test("recorded mutations are skipped, or rewritten with new read counts on update; MUTATION_COUNT is recomputed when the study has it", async () => {
  const probe = database({ samples: SAMPLES, hasMutationProfile: true, mutationSamples: MUT_SAMPLES.slice(1) });
  await applyEdit(probe.conn, "st", { kind: "mutations", count: 1, perSample: 1 }, "skip", false);
  const [first] = probe.rows("lab_mutation");
  probe.restore();
  const recorded: Record<string, unknown> = { ...first, tumor_alt_count: 1, tumor_ref_count: 1 };
  delete recorded.version; delete recorded.is_deleted;
  const c = database({ samples: SAMPLES, hasMutationProfile: true, mutationSamples: MUT_SAMPLES.slice(1), existingMutations: [recorded], hasMutationCount: true });
  const plan = await planEdit(c.conn, "st", { kind: "mutations", count: 1, perSample: 1 });
  assert.deepEqual(plan.conflicts, [{ what: "mutations already recorded (same sample, gene and protein change)", count: 1,
    examples: [`B1 ${String(first.hugo_gene_symbol)} ${String(first.protein_change)}`] }]);
  const skipped = await applyEdit(c.conn, "st", { kind: "mutations", count: 1, perSample: 1 }, "skip", false);
  assert.equal(skipped.rows.lab_mutation, 0);
  assert.equal(c.rows("lab_mutation").length, 0);
  assert.ok(!c.statements.some((s) => /'MUTATION_COUNT', toString\(count\(\)\)/.test(s)), "nothing written, nothing to recount");
  const updated = await applyEdit(c.conn, "st", { kind: "mutations", count: 1, perSample: 1 }, "update", false);
  assert.equal(updated.rows.lab_mutation, 1);
  const [m] = c.rows("lab_mutation");
  assert.equal(m.protein_change, first.protein_change);
  assert.ok(Number(m.tumor_alt_count) >= 5, "new read counts");
  assert.ok(c.statements.some((s) => /'MUTATION_COUNT', toString\(count\(\)\)/.test(s) && /sample_id IN \('B1'\)/.test(s)));
  assert.equal(updated.rows.lab_clinical, 3);
});

test("expression values need a continuous profile, and go to the one named if the study has it", async () => {
  const none = database({ samples: SAMPLES, continuous: [] });
  await assert.rejects(planEdit(none.conn, "st", { kind: "expression" }), /st has no continuous profile/);
  none.restore();
  const c = database({ samples: SAMPLES, continuous: ["st_mrna", "st_rppa"], existingValues: ["TP53 in A1 = 0.3"] });
  assert.deepEqual(await continuousProfiles(c.conn, "st"), ["st_mrna", "st_rppa"]);
  const plan = await planEdit(c.conn, "st", { kind: "expression", profile: "st_rppa", count: 2, genes: 3 });
  assert.equal(plan.summary, "6 values of st_rppa: 2 samples × 3 genes");
  assert.deepEqual(plan.conflicts, [{ what: "values already set", count: 1, examples: ["TP53 in A1 = 0.3"] }]);
  const other = await planEdit(c.conn, "st", { kind: "expression", profile: "st_nope", count: 1, genes: 1 });
  assert.match(other.summary, /of st_mrna:/, "an unknown profile falls back to the first");
});

test("applying expression values skips cells already set unless updating", async () => {
  const c = database({ samples: SAMPLES, continuous: ["st_mrna"] });
  await applyEdit(c.conn, "st", { kind: "expression", count: 2, genes: 2 }, "skip", false);
  const skip = inserts(c, "lab_profile_value")[0];
  assert.ok(skip.includes("arrayJoin(['A1', 'B1'])"));
  assert.match(skip, /NOT IN \(SELECT sample_id, entrez_gene_id FROM lab_profile_value FINAL/);
  assert.match(skip, /value NOT IN \('', 'NA'\)/, "an empty or NA cell is not a value");
  c.clear();
  const r = await applyEdit(c.conn, "st", { kind: "expression", count: 2, genes: 2 }, "update", true);
  assert.doesNotMatch(inserts(c, "lab_profile_value")[0], /NOT IN/);
  assert.equal(r.rows.lab_profile_value, 3);
  assert.ok(c.statements.some((s) => /FROM system\.parts/.test(s)), "merge compacts the study");
  assert.ok(r.seconds >= 0);
});
