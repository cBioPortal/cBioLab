// The annotation database's names and shape are written in three places that must agree: what the
// app reads (lib/annotation-store.ts — the app may not import the sync, test/boundary.test.ts), what
// the sync writes (@cbiolab/annotation-sync), and the migration an administrator runs
// (packages/annotation-sync/sql/). A rename in one alone would leave the app reading an empty table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ONCOKB_TABLE, SYNC_RUN_TABLE, syncedStudiesSql } from "../lib/annotation-store.ts";
import { ANNOTATION_SOURCES, SYNC_RUN_TABLE as SYNC_RUN_WRITTEN, annotationSource, annotationStoreDdl } from "@cbiolab/annotation-sync";

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

test("the app reads the tables the sync writes", () => {
  assert.equal(ONCOKB_TABLE, annotationSource("oncokb").table);
  assert.equal(SYNC_RUN_TABLE, SYNC_RUN_WRITTEN);
  assert.ok(ANNOTATION_SOURCES.every((s) => s.table.startsWith("annotation.")), "every source's table is in the one annotation database");
});

test("the migration creates exactly what the code creates", () => {
  const sql = readFileSync("packages/annotation-sync/sql/001-annotation-database.sql", "utf8");
  const statements = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n").split(/;\s*(?:\n|$)/).map(squash).filter(Boolean);
  const creates = statements.filter((s) => s.startsWith("CREATE "));
  assert.deepEqual(creates, annotationStoreDdl().map(squash));
  // and grants nothing on the shared annotation database as a whole: OncoKB's licence is its table's
  assert.ok(!statements.some((s) => /^GRANT .* ON annotation\.\*/.test(s)));
});

test("which studies a source covers, from the shared log", () => {
  assert.equal(syncedStudiesSql("oncokb"), "SELECT DISTINCT study FROM annotation.sync_run WHERE source = 'oncokb' AND (annotated_new > 0 OR already_stored > 0)");
  assert.match(syncedStudiesSql("x'; DROP"), /source = 'x' AND/, "a source id is a bare word");
});
