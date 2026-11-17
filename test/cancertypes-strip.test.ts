// The Cancer Types Summary's profiled-data strip (figure.ts profiledStrip): which data-type rows it
// draws, and a "+" / "−" mark per group with its tooltip. Written from the case table before the code.
// Legacy (cbioportal-frontend at cd8c6df):
//   CSCt = src/pages/resultsView/cancerSummary/CancerSummaryContent.tsx (alterationTypeDataCounts)
//   CSCh = src/pages/resultsView/cancerSummary/CancerSummaryChart.tsx (the scatter under the bars)
//   ACH  = src/shared/lib/alterationCountHelpers.ts (count*AlterationOccurences, isSampleProfiledInMultiple)
// Spec: docs/legacy-spec/02-cancer-types-summary.md CTS-CH-5 (rows, glyph), CTS-CH-6 (tooltip), CTS-MD-8
// (a gene off some panels: "minus" where a group has no profiled case).
//
// Case table:
//   S1  rows top to bottom: Structural variant data, Mutation data, CNA data, mRNA data, Protein data   (CTS-CH-5)
//   S2  a row appears only when some group of `all` has its count > 0; a type no group has is left out  (CTS-CH-5)
//   S3  one mark per group of `groups`, in their order; plus = that group's count > 0                   (CTS-CH-5)
//   S4  a group with count 0 in a drawn row: a minus mark, tip "Not profiled"                          (CTS-CH-6, CTS-MD-8)
//   S5  tip "<n> patients profiled", "1 patient profiled" for n === 1                                  (CTS-CH-6)
//   S6  sample mode: "<n> samples profiled", "1 sample profiled"                                       (CTS-CH-6)
//   S7  mrna / prot are optional: absent is 0; their rows appear only when some group has them > 0    (CTS-CH-5)
//   S8  rows are decided by `all`, marks by `groups`: a subset (a gene tab, filtered groups) still
//       draws a row some other group has, with minus marks for its own groups                        (CTS-CH-5)
//   S9  a group without profiledFor counts as all 0                                                   (CTS-CH-5)
//   S10 no row anywhere (every count 0, or no profiledFor, or no group): []                            (CTS-CH-5)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { profiledStrip } from "../lib/views/cancertypes/figure.ts";
import type { CancertypesGroup } from "../lib/views/cancertypes/types.ts";

type Profiled = { mutation: number; cna: number; sv: number; mrna?: number; prot?: number };
const group = (key: string, profiledFor?: Profiled): CancertypesGroup => ({
  key, label: key, samples: 10, profiled: 10, altered: 0,
  mutation: 0, amp: 0, homdel: 0, sv: 0, multiple: 0,
  ...(profiledFor ? { profiledFor } : {}),
} as unknown as CancertypesGroup);

type Strip = { label: string; marks: { plus: boolean; tip: string }[] }[];
const labels = (rows: Strip) => rows.map((r) => r.label);
const row = (rows: Strip, label: string) => {
  const r = rows.find((x) => x.label === label);
  assert.ok(r, "no row " + label + " in " + JSON.stringify(labels(rows)));
  return r;
};

describe("profiledStrip rows", () => {
  test("S1/S2 the three genomic rows in their fixed order, mRNA and protein absent", () => {
    const gs = [group("a", { mutation: 5, cna: 4, sv: 3 })];
    assert.deepEqual(labels(profiledStrip(gs, gs, "patient")), ["Structural variant data", "Mutation data", "CNA data"]);
  });
  test("S1/S7 all five rows in their fixed order", () => {
    const gs = [group("a", { mutation: 1, cna: 1, sv: 1, mrna: 1, prot: 1 })];
    assert.deepEqual(labels(profiledStrip(gs, gs, "sample")),
      ["Structural variant data", "Mutation data", "CNA data", "mRNA data", "Protein data"]);
  });
  test("S2 a type no group is profiled for has no row", () => {
    const gs = [group("a", { mutation: 5, cna: 0, sv: 0 }), group("b", { mutation: 2, cna: 0, sv: 0 })];
    assert.deepEqual(labels(profiledStrip(gs, gs, "patient")), ["Mutation data"]);
  });
  test("S2 one group's count is enough for the row", () => {
    const gs = [group("a", { mutation: 5, cna: 0, sv: 0 }), group("b", { mutation: 5, cna: 0, sv: 2 })];
    assert.deepEqual(labels(profiledStrip(gs, gs, "patient")), ["Structural variant data", "Mutation data"]);
  });
  test("S7 mRNA only: its row after CNA, no protein row", () => {
    const gs = [group("a", { mutation: 3, cna: 3, sv: 0, mrna: 2 }), group("b", { mutation: 3, cna: 3, sv: 0, prot: 0 })];
    assert.deepEqual(labels(profiledStrip(gs, gs, "patient")), ["Mutation data", "CNA data", "mRNA data"]);
  });
  test("S7 protein only, on a group other than the first", () => {
    const gs = [group("a", { mutation: 3, cna: 0, sv: 0 }), group("b", { mutation: 3, cna: 0, sv: 0, prot: 4 })];
    const rows = profiledStrip(gs, gs, "patient");
    assert.deepEqual(labels(rows), ["Mutation data", "Protein data"]);
    assert.deepEqual(row(rows, "Protein data").marks.map((m: { plus: boolean }) => m.plus), [false, true]);
  });
  test("S7 mrna: 0 and prot: 0 given explicitly draw no row", () => {
    const gs = [group("a", { mutation: 1, cna: 1, sv: 1, mrna: 0, prot: 0 })];
    assert.deepEqual(labels(profiledStrip(gs, gs, "patient")), ["Structural variant data", "Mutation data", "CNA data"]);
  });
});

describe("profiledStrip marks", () => {
  test("S3 one mark per group, in the groups' order", () => {
    const gs = [group("a", { mutation: 1, cna: 0, sv: 0 }), group("b", { mutation: 2, cna: 0, sv: 0 }), group("c", { mutation: 3, cna: 0, sv: 0 })];
    const m = row(profiledStrip(gs, gs, "patient"), "Mutation data").marks;
    assert.deepEqual(m, [
      { plus: true, tip: "1 patient profiled" },
      { plus: true, tip: "2 patients profiled" },
      { plus: true, tip: "3 patients profiled" },
    ]);
  });
  test("S3 every drawn row has one mark per group", () => {
    const gs = [group("a", { mutation: 1, cna: 2, sv: 3, mrna: 4, prot: 5 }), group("b", { mutation: 0, cna: 0, sv: 0 })];
    for (const r of profiledStrip(gs, gs, "sample")) assert.equal(r.marks.length, 2, r.label);
  });
  test("S4 a group not profiled for a drawn row's type: minus, Not profiled (CTS-MD-8)", () => {
    const gs = [group("a", { mutation: 10, cna: 10, sv: 10 }), group("b", { mutation: 0, cna: 7, sv: 10 })];
    const rows = profiledStrip(gs, gs, "patient");
    assert.deepEqual(row(rows, "Mutation data").marks, [{ plus: true, tip: "10 patients profiled" }, { plus: false, tip: "Not profiled" }]);
    assert.deepEqual(row(rows, "CNA data").marks, [{ plus: true, tip: "10 patients profiled" }, { plus: true, tip: "7 patients profiled" }]);
    assert.deepEqual(row(rows, "Structural variant data").marks.map((m: { plus: boolean }) => m.plus), [true, true]);
  });
  test("S5 singular and plural, patients", () => {
    const gs = [group("a", { mutation: 1, cna: 2, sv: 592 })];
    const rows = profiledStrip(gs, gs, "patient");
    assert.equal(row(rows, "Mutation data").marks[0].tip, "1 patient profiled");
    assert.equal(row(rows, "CNA data").marks[0].tip, "2 patients profiled");
    assert.equal(row(rows, "Structural variant data").marks[0].tip, "592 patients profiled");
  });
  test("S6 sample mode: singular and plural, samples", () => {
    const gs = [group("a", { mutation: 1, cna: 2, sv: 0, mrna: 1, prot: 13 }), group("b", { mutation: 0, cna: 1, sv: 0 })];
    const rows = profiledStrip(gs, gs, "sample");
    assert.deepEqual(row(rows, "Mutation data").marks, [{ plus: true, tip: "1 sample profiled" }, { plus: false, tip: "Not profiled" }]);
    assert.deepEqual(row(rows, "CNA data").marks, [{ plus: true, tip: "2 samples profiled" }, { plus: true, tip: "1 sample profiled" }]);
    assert.deepEqual(row(rows, "mRNA data").marks, [{ plus: true, tip: "1 sample profiled" }, { plus: false, tip: "Not profiled" }]);
    assert.deepEqual(row(rows, "Protein data").marks, [{ plus: true, tip: "13 samples profiled" }, { plus: false, tip: "Not profiled" }]);
  });
  test("S7 an absent mrna on one group is a minus in the mRNA row another group draws", () => {
    const gs = [group("a", { mutation: 1, cna: 0, sv: 0 }), group("b", { mutation: 1, cna: 0, sv: 0, mrna: 3 })];
    assert.deepEqual(row(profiledStrip(gs, gs, "patient"), "mRNA data").marks,
      [{ plus: false, tip: "Not profiled" }, { plus: true, tip: "3 patients profiled" }]);
  });
});

describe("profiledStrip: rows by `all`, marks by `groups`", () => {
  const a = group("a", { mutation: 4, cna: 4, sv: 0 });
  const b = group("b", { mutation: 4, cna: 0, sv: 2, prot: 1 });
  const c = group("c", { mutation: 0, cna: 0, sv: 0 });
  test("S8 a subset draws every row `all` has, its marks its own groups'", () => {
    const rows = profiledStrip([a, c], [a, b, c], "patient");
    assert.deepEqual(labels(rows), ["Structural variant data", "Mutation data", "CNA data", "Protein data"]);
    assert.deepEqual(row(rows, "Structural variant data").marks, [{ plus: false, tip: "Not profiled" }, { plus: false, tip: "Not profiled" }]);
    assert.deepEqual(row(rows, "Mutation data").marks, [{ plus: true, tip: "4 patients profiled" }, { plus: false, tip: "Not profiled" }]);
    assert.deepEqual(row(rows, "CNA data").marks, [{ plus: true, tip: "4 patients profiled" }, { plus: false, tip: "Not profiled" }]);
    assert.deepEqual(row(rows, "Protein data").marks, [{ plus: false, tip: "Not profiled" }, { plus: false, tip: "Not profiled" }]);
  });
  test("S8 a type only `groups` would have, but `all` lacks, is not decided by `groups`", () => {
    // `all` decides: a group in `groups` and not in `all` adds no row
    const extra = group("x", { mutation: 1, cna: 0, sv: 0, mrna: 9 });
    assert.deepEqual(labels(profiledStrip([extra], [a], "patient")), ["Mutation data", "CNA data"]);
  });
  test("S8 an empty subset of a non-empty `all`: rows with no marks", () => {
    const rows = profiledStrip([], [a, b], "sample");
    assert.deepEqual(labels(rows), ["Structural variant data", "Mutation data", "CNA data", "Protein data"]);
    for (const r of rows) assert.deepEqual(r.marks, [], r.label);
  });
  test("S8 the groups' order, not `all`'s", () => {
    const rows = profiledStrip([b, a], [a, b], "patient");
    assert.deepEqual(row(rows, "Structural variant data").marks.map((m: { plus: boolean }) => m.plus), [true, false]);
    assert.deepEqual(row(rows, "CNA data").marks.map((m: { plus: boolean }) => m.plus), [false, true]);
  });
});

describe("profiledStrip with no data", () => {
  test("S9 a group without profiledFor is all minus where another group draws the row", () => {
    const bare = group("bare");
    const gs = [bare, group("a", { mutation: 2, cna: 0, sv: 0 })];
    assert.deepEqual(profiledStrip(gs, gs, "patient"),
      [{ label: "Mutation data", marks: [{ plus: false, tip: "Not profiled" }, { plus: true, tip: "2 patients profiled" }] }]);
  });
  test("S10 no group has profiledFor: []", () => {
    const gs = [group("a"), group("b")];
    assert.deepEqual(profiledStrip(gs, gs, "patient"), []);
  });
  test("S10 every count 0: []", () => {
    const gs = [group("a", { mutation: 0, cna: 0, sv: 0, mrna: 0, prot: 0 })];
    assert.deepEqual(profiledStrip(gs, gs, "sample"), []);
  });
  test("S10 no groups at all: []", () => {
    assert.deepEqual(profiledStrip([], [], "patient"), []);
  });
});
