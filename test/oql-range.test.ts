// OQL's protein position range modifier, as cBioPortal documents and implements it:
// (a-b) overlaps, (a-b*) fully contained, (a-) and (-b) open-ended, joined to a mutation by "_".
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseOql, oqlLeafSql } from "../lib/oql.ts";

const spec = (q: string) => parseOql(q)[0].specs[0];

describe("OQL position range: parsing", () => {
  test("open-ended start on a mutation class", () => {
    assert.deepEqual(spec("APC: TRUNC_(1400-)"), { type: "MUT", cls: "trunc", driver: false, range: { start: 1400, contained: false } });
  });
  test("open-ended end, closed, and fully contained", () => {
    assert.deepEqual(spec("TP53: MUT_(-500)").range, { end: 500, contained: false });
    assert.deepEqual(spec("KRAS: MUT_(12-13)").range, { start: 12, end: 13, contained: false });
    assert.deepEqual(spec("TP53: MISSENSE_(100-300*)").range, { start: 100, end: 300, contained: true });
  });
  test("a range alone is any mutation in it", () => {
    assert.deepEqual(spec("APC: (1400-)"), { type: "MUT", driver: false, range: { start: 1400, contained: false } });
  });
  test("modifiers in any order around the mutation, DRIVER included", () => {
    for (const q of ["TP53: INFRAME_(1-100*)_DRIVER", "TP53: DRIVER_INFRAME_(1-100*)", "TP53: INFRAME_DRIVER_(1-100*)"])
      assert.deepEqual(spec(q), { type: "MUT", cls: "inframe", driver: true, range: { start: 1, end: 100, contained: true } }, q);
    assert.deepEqual(spec("APC: (1400-)_DRIVER"), { type: "MUT", driver: true, range: { start: 1400, contained: false } });
  });
  test("the documented MUT= form", () => {
    assert.deepEqual(spec("EGFR: MUT=(712-979)_DRIVER"), { type: "MUT", driver: true, range: { start: 712, end: 979, contained: false } });
    assert.deepEqual(spec("EGFR: MUT=(712-979)"), { type: "MUT", driver: false, range: { start: 712, end: 979, contained: false } });
  });
  test("a range with a protein change keeps both", () => {
    assert.deepEqual(spec("KRAS: MUT=G12C_(12-12)"), { type: "MUT", pchange: "G12C", driver: false, range: { start: 12, end: 12, contained: false } });
  });
});

describe("OQL position range: refused loudly", () => {
  test("on anything but a mutation", () => {
    assert.throws(() => parseOql("ERBB2: AMP_(1-100)"), /applies only to mutations/);
    assert.throws(() => parseOql("ALK: FUSION_(1-100)"), /applies only to mutations/);
  });
  test("no bounds, reversed bounds, two ranges, malformed", () => {
    assert.throws(() => parseOql("APC: MUT_(-)"), /needs a start, an end, or both/);
    assert.throws(() => parseOql("APC: MUT_(1500-1400)"), /starts after it ends/);
    assert.throws(() => parseOql("APC: MUT_(1-5)_(10-20)"), /at most one position range/);
    assert.throws(() => parseOql("APC: MUT_(1400)"), /a position range is written/);
    assert.throws(() => parseOql("APC: MUT_(a-b)"), /a position range is written/);
  });
});

describe("OQL position range: SQL", () => {
  const sql = (q: string) => oqlLeafSql(q, { study: "s1", db: "db", oncokbPin: "v1" });
  test("reads positions from mutation_derived, restricted to the study and gene", () => {
    const s = sql("APC: TRUNC_(1400-)");
    assert.match(s, /FROM \(SELECT .* FROM db\.mutation_derived WHERE studyId = 's1' AND `GENE\.hugoGeneSymbol` = 'APC'\) g/s);
    assert.doesNotMatch(s, /genomic_event_derived/);
    assert.match(s, /NOT IN \('missense', 'inframe'\)/);
  });
  test("overlap by default: the mutation ends at or after the start, starts at or before the end", () => {
    const s = sql("KRAS: MUT_(12-13)");
    assert.match(s, /g\.pos_end >= 12/);
    assert.match(s, /g\.pos_start <= 13/);
  });
  test("contained with *: the mutation lies inside the range", () => {
    const s = sql("KRAS: MUT_(12-13*)");
    assert.match(s, /g\.pos_start >= 12/);
    assert.match(s, /g\.pos_end <= 13/);
  });
  test("a mutation without a usable position never matches (the portal's mut_position)", () => {
    assert.match(sql("APC: MUT_(1400-)"), /g\.pos_start IS NOT NULL AND g\.pos_end IS NOT NULL AND g\.pos_start != -1 AND g\.pos_end != -1 AND g\.pos_start <= g\.pos_end/);
  });
  test("DRIVER still joins the pinned OncoKB store", () => {
    assert.match(sql("APC: TRUNC_(1400-)_DRIVER"), /oncokb_annotation\.variant_annotation ann/);
  });
  test("an entry without a range is unchanged", () => {
    assert.match(sql("APC: TRUNC"), /FROM db\.genomic_event_derived g/);
  });
});
