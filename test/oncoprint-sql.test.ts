// The oncoprint's coverage and column-facts SQL: what counts as profiled, and which panels say so.
// The numbers these produce are checked against the warehouse by hand in the commit that set them;
// these pin the rules, so a later edit cannot quietly narrow them.
import test from "node:test";
import assert from "node:assert/strict";
import { allColumnsSql, batchStudies, clinicalSql, columnFactsSql, coverageSql, genomicEventsSql, assayHeatmapSql, normalizeSpec } from "../lib/oncoprint.ts";
import { assayTrackLabel, entityShortName } from "../lib/profile-names.ts";

test("a gene cell is profiled by a mutation, copy number or structural variant panel, as in the portal", () => {
  const sql = coverageSql(["TP53", "CDKN2A"], ["s"]);
  assert.match(sql, /alteration_type IN \('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT'\)/);
  assert.match(sql, /gene_panel_to_gene_derived WHERE gene IN \('TP53','CDKN2A'\) GROUP BY gene_panel_id/, "and only for the genes that panel covers");
  assert.match(sql, /JOIN pm ON pm\.gene_panel_id = sp\.gene_panel_id/, "each sample takes its own panels' masks");
});

test("whole-study fetches read several studies in one statement, each row led by its own study", () => {
  for (const sql of [genomicEventsSql(["TP53"], ["s1", "s2"], "db"), coverageSql(["TP53"], ["s1", "s2"], "db"), columnFactsSql(["s1", "s2"], "db"),
    clinicalSql(["SEX"], ["s1", "s2"], "db"), allColumnsSql(["s1", "s2"], "db"), clinicalSql(["SEX"], ["s1", "s2"], "db", "sample")]) {
    assert.match(sql, /^(WITH[\s\S]*\n)?SELECT (DISTINCT )?\S*cancer_study_identifier AS s, replaceOne\(\S*_unique_id, concat\(\S*cancer_study_identifier, '_'\), ''\) AS pid/m,
      "the study first, and each id stripped of its own study's prefix");
    assert.match(sql, /cancer_study_identifier IN \('s1','s2'\)/);
    assert.doesNotMatch(sql, /'s1_'|'s2_'/, "no one study's prefix is assumed");
  }
});

test("studies are batched by size: small ones share a statement, a large one has its own, never across connections", () => {
  const size: Record<string, number> = { big: 60_000, a: 10_000, b: 10_000, c: 10_000, d: 100, far: 100 };
  const conn = (s: string) => s === "far" ? "c2" : "c1";
  assert.deepEqual(batchStudies(["a", "big", "b", "c", "far", "d"], conn, (s) => size[s], 25_000), [["big"], ["a", "b"], ["c", "d"], ["far"]]);
  assert.deepEqual(batchStudies(["only"], conn, () => 0), [["only"]]);
  assert.deepEqual(batchStudies([], conn, () => 0), []);
});

test("column facts count every sample of a column, profiled or not, and type masks follow PROFILED_TYPES", () => {
  const sql = columnFactsSql(["s"]);
  assert.match(sql, /FROM \S*\.sample_derived sd\nLEFT JOIN/, "a column profiled for nothing still has a row");
  assert.match(sql, /uniqExact\(sd\.sample_unique_id\) AS samples/);
  assert.match(sql, /indexOf\(\['MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT','MRNA_EXPRESSION','PROTEIN_LEVEL'\]/);
});

test("a generic-assay heatmap reads the study's own profile, one row per (column, entity), numbers only", () => {
  const sql = assayHeatmapSql("mutational_signatures_contribution_SBS", ["mutational_signature_contribution_SBS4"], "s", "db");
  assert.match(sql, /g\.profile_type = 'mutational_signatures_contribution_SBS' AND g\.profile_stable_id = 's_mutational_signatures_contribution_SBS'/);
  assert.match(sql, /g\.entity_stable_id IN \('mutational_signature_contribution_SBS4'\)/);
  assert.match(sql, /replaceOne\(g\.patient_unique_id, 's_', ''\) AS pid,\n\s+g\.entity_stable_id AS gene, avg\(/, "patient columns average their samples");
  assert.match(sql, /isFinite\(ifNull\(toFloat64OrNull\(g\.value\), nan\)\)/);
  assert.match(assayHeatmapSql("p", ["e"], "s", "db", "sample"), /replaceOne\(g\.sample_unique_id, 's_', ''\) AS pid/);
  assert.match(assayHeatmapSql("p", ["e"], "s", "db", "sample", true), /JOIN db\.sample_derived sd ON sd\.patient_unique_id = g\.patient_unique_id/,
    "a patient-level value is given to each of the patient's samples");
});

test("a generic-assay heatmap names entities, at most 12, and they stay as written", () => {
  const { heatmap } = normalizeSpec({ genes: ["TP53"], heatmap: [{ profileType: "sig", entities: ["SBS4", "mut_SBS1"] }] });
  assert.deepEqual(heatmap[0], { profileType: "sig", reference: "cohort", assay: true, genes: ["SBS4", "mut_SBS1"] });
  assert.equal(normalizeSpec({ genes: ["TP53"], heatmap: [{ profileType: "mrna" }] }).heatmap[0].assay, false);
  assert.throws(() => normalizeSpec({ genes: ["TP53"], heatmap: [{ profileType: "sig", entities: Array.from({ length: 13 }, (_, i) => "e" + i) }] }), /at most 12 entities/);
  assert.throws(() => normalizeSpec({ genes: ["TP53"], heatmap: [{ profileType: "sig", entities: ["x'; DROP"] }] }), /is not a generic-assay entity/);
});

test("a generic-assay track's label drops the words its entity repeats from the profile", () => {
  assert.equal(assayTrackLabel("mutational_signature_contribution_SBS4", "mutational_signatures_contribution_SBS"), "SBS4 sig");
  assert.equal(assayTrackLabel("8q_status", "armlevel_cna"), "8q_status arm");
  assert.equal(assayTrackLabel("cg00032419", "methylation_hm450"), "cg00032419 meth");
  assert.equal(entityShortName("signature", "signature"), "signature", "never the last word");
});
