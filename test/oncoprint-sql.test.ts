// The oncoprint's coverage and column-facts SQL: what counts as profiled, and which panels say so.
// The numbers these produce are checked against the warehouse by hand in the commit that set them;
// these pin the rules, so a later edit cannot quietly narrow them.
import test from "node:test";
import assert from "node:assert/strict";
import { columnFactsSql, coverageSql, assayHeatmapSql, normalizeSpec } from "../lib/oncoprint.ts";
import { assayTrackLabel, entityShortName } from "../lib/profile-names.ts";

test("a gene cell is profiled by a mutation, copy number or structural variant panel, as in the portal", () => {
  const sql = coverageSql(["TP53", "CDKN2A"], "s");
  assert.match(sql, /alteration_type IN \('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT'\)/);
  assert.match(sql, /pg\.gene IN \('TP53','CDKN2A'\)/, "and only for the genes that panel covers");
});

test("column facts count every sample of a column, profiled or not, and type masks follow PROFILED_TYPES", () => {
  const sql = columnFactsSql("s");
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
