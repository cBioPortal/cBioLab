// The annotation database's names and shape are written in three places that must agree: what the
// app reads (lib/annotation-store.ts — the app may not import the sync, test/boundary.test.ts), what
// the sync writes (@cbiolab/annotation-sync), and the migration an administrator runs
// (packages/annotation-sync/sql/). A rename in one alone would leave the app reading an empty table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { GENOME_NEXUS_SOURCES, ONCOKB_TABLE, SYNC_RUN_TABLE, VARIANT_TABLE, syncedStudiesSql } from "../lib/annotation-store.ts";
import { ANNOTATION_SOURCES, SYNC_RUN_TABLE as SYNC_RUN_WRITTEN, VARIANT_TABLE as VARIANT_WRITTEN, annotationSource, annotationStoreDdl } from "@cbiolab/annotation-sync";

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

test("the app reads the tables the sync writes", () => {
  assert.equal(ONCOKB_TABLE, annotationSource("oncokb").table);
  assert.equal(SYNC_RUN_TABLE, SYNC_RUN_WRITTEN);
  assert.equal(VARIANT_TABLE, VARIANT_WRITTEN);
  assert.ok(ANNOTATION_SOURCES.every((s) => s.table.startsWith("annotation.")), "every source's table is in the one annotation database");
});

const MIGRATIONS = "packages/annotation-sync/sql/";
/** a migration's statements, its comments dropped */
const statementsOf = (file: string) =>
  readFileSync(MIGRATIONS + file, "utf8").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n").split(/;\s*(?:\n|$)/).map(squash).filter(Boolean);

test("the migrations, run in order, create exactly what the code creates", () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  assert.deepEqual(files, ["001-annotation-database.sql", "002-annotation-variant.sql"]);
  const statements = files.flatMap(statementsOf);
  const creates = statements.filter((s) => /^CREATE (DATABASE|TABLE) /.test(s));
  assert.deepEqual(creates, annotationStoreDdl().map(squash));
  // and grant nothing on the shared annotation database as a whole: OncoKB's licence is its table's
  assert.ok(!statements.some((s) => /^GRANT .* ON annotation\.\*/.test(s)));
  // the public sources' writer never reaches the licensed table
  assert.ok(!statements.some((s) => /^GRANT .* ON annotation\.oncokb TO annotation_writer/.test(s)));
});

test("the public sources write as one writer, the app reads what they write", () => {
  for (const id of ["genome_nexus", "genome_nexus_grch38"]) {
    const s = annotationSource(id);
    assert.equal(s.table, VARIANT_TABLE);
    assert.equal(s.writer, "annotation");
  }
  assert.deepEqual(Object.values(GENOME_NEXUS_SOURCES), ["genome_nexus", "genome_nexus_grch38"]);
  const grants = statementsOf("002-annotation-variant.sql").filter((s) => s.startsWith("GRANT "));
  assert.deepEqual(grants, ["GRANT SELECT, INSERT ON annotation.variant TO annotation_writer", "GRANT SELECT, INSERT ON annotation.sync_run TO annotation_writer",
    "GRANT SELECT ON cbioportal_public_librechat_blue.* TO annotation_writer", "GRANT SELECT ON annotation.variant TO cohort_lab_ro"]);
});

test("which studies a source covers, from the shared log", () => {
  assert.equal(syncedStudiesSql("oncokb"), "SELECT DISTINCT study FROM annotation.sync_run WHERE source = 'oncokb' AND (annotated_new > 0 OR already_stored > 0)");
  assert.match(syncedStudiesSql("x'; DROP"), /source = 'x' AND/, "a source id is a bare word");
  assert.match(syncedStudiesSql("genome_nexus_grch38"), /source = 'genome_nexus_grch38' AND/, "digits and all");
});
