// Hovering a lollipop stem highlights the table's rows at that codon (MUT-LP-11, hover part), from the
// spec table's rows H1–H5: rowAtStem(hover, tableGene, row's proteinPos) decides which rows are marked.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// lib/ch.ts reads these at import; nothing leaves the machine
process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "fed_a";
process.env.CLICKHOUSE_USER = "u";
process.env.CLICKHOUSE_PASSWORD = "p";
process.env.STUDY_ID = "s1";
process.env.GENOME_NEXUS_PIN = "fixture";
process.env.GENOME_NEXUS_GRCH38_PIN = "fixture";
process.env.GENOME_NEXUS_URL = "http://127.0.0.1:9";
for (const k of ["CLICKHOUSE2_URL", "FEDERATION_PEERS", "LOOPBACK_PEER", "CH_RUN_CACHE"]) delete process.env[k];

register("./support/tsx-loader.mjs", import.meta.url);
const { rowAtStem } = await import("../lib/lollipop.ts");

const KRAS12 = { gene: "KRAS", codon: 12 };

test("H1: no hover marks no row", () => {
  assert.equal(rowAtStem(null, "KRAS", 12), false);
});

test("H2: a hover on another gene's stem marks no row in this gene's table", () => {
  assert.equal(rowAtStem(KRAS12, "NRAS", 12), false);
});

test("H3: a row at the hovered codon is marked, whether its position is a number or a string", () => {
  assert.equal(rowAtStem(KRAS12, "KRAS", 12), true);
  assert.equal(rowAtStem(KRAS12, "KRAS", "12"), true);
});

test("H4: a row at another codon, or with no position, is not marked", () => {
  for (const pos of [13, "", null, undefined]) assert.equal(rowAtStem(KRAS12, "KRAS", pos), false, JSON.stringify(pos));
});

test("H5: a blank position is not codon 0", () => {
  assert.equal(rowAtStem({ gene: "KRAS", codon: 0 }, "KRAS", ""), false);
});
