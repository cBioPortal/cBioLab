// cBioPortal's generic-assay frequency table (STS-OT-5; lib/assay-frequency-table.ts): which values
// are rows, the altered-only default of arm-level CNA and LOH tables, their order, the clause a
// selection adds. The counts themselves are checked against cbioportal.org in the PR (coadread, 115 rows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { freqRowKey, freqTableClause, freqTableKeeps, freqTableRows } from "../lib/assay-frequency-table.ts";

test("values that are rows: no-answer values never; a binary profile's absent values neither", () => {
  const cases: [string, boolean, boolean][] = [
    ["Loss", false, true], ["Unchanged", false, true], ["", false, false], ["NA", false, false], [" na ", false, false],
    ["1", true, true], ["0", true, false], ["absent", true, false], ["FALSE", true, false], ["n", true, false], ["Negative", true, false], ["No", true, false],
    ["no", false, true],          // only a binary profile's "no" is absence
  ];
  for (const [v, binary, want] of cases) assert.equal(freqTableKeeps(v, binary), want, JSON.stringify([v, binary]));
});

test("an arm-level CNA table: altered categories only until asked, losses then gains, then by count", () => {
  const r = (entity: string, value: string, n: number) => ({ entity, name: entity, value, n });
  const rows = [r("8q", "Gain", 270), r("1p", "Loss", 148), r("1p", "Unchanged", 330), r("18q", "Loss", 384), r("8q", "Loss", 12), r("X", "Unknown", 5)];
  assert.deepEqual(freqTableRows(rows, "ARMLEVEL_CNA", false).map(freqRowKey), ["18q::Loss", "1p::Loss", "8q::Loss", "8q::Gain"]);
  assert.deepEqual(freqTableRows(rows, "ARMLEVEL_CNA", true).map(freqRowKey), ["18q::Loss", "1p::Loss", "8q::Loss", "8q::Gain", "1p::Unchanged", "X::Unknown"]);
  // any other type: every row, by count
  assert.deepEqual(freqTableRows(rows, "GENETIC_ANCESTRY", false).map((x) => x.n), [384, 330, 270, 148, 12, 5]);
});

test("the checked rows: one genericAssay leaf per entity, any of them for several, refused past the limits", () => {
  assert.deepEqual(freqTableClause("armlevel_cna", []), { why: "no row is checked" });
  assert.deepEqual(freqTableClause("armlevel_cna", ["1p_status::Loss"]), { clauses: [{ kind: "genericAssay", profileType: "armlevel_cna", entity: "1p_status", values: ["Loss"] }] });
  assert.deepEqual(freqTableClause("armlevel_cna", ["1p_status::Loss", "8q_status::Gain", "1p_status::Unchanged"]), { clauses: [{ any: [
    { kind: "genericAssay", profileType: "armlevel_cna", entity: "1p_status", values: ["Loss", "Unchanged"] },
    { kind: "genericAssay", profileType: "armlevel_cna", entity: "8q_status", values: ["Gain"] }] }] });
  const nine = Array.from({ length: 9 }, (_, i) => "e" + i + "::Loss");
  assert.deepEqual(freqTableClause("armlevel_cna", nine), { why: "one filter holds at most 8 entities; 9 are checked" });
  // an entity id may hold the separator: the value is after the last one
  assert.deepEqual(freqTableClause("x", ["ENT_A::X::v"]), { clauses: [{ kind: "genericAssay", profileType: "x", entity: "ENT_A::X", values: ["v"] }] });
});
