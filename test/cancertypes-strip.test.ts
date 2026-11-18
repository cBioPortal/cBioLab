// The Cancer Types Summary's profiled-data strip (figure.ts profiledStrip): a row per data type the query
// reads (run.ts readTypes, the panel's profiledTypes), and a "+" / "−" mark per group with its tooltip.
// Written from the case table before the code.
// Legacy (cbioportal-frontend at cd8c6df):
//   CSCt = src/pages/resultsView/cancerSummary/CancerSummaryContent.tsx (alterationTypeDataCounts)
//   CSCh = src/pages/resultsView/cancerSummary/CancerSummaryChart.tsx (the scatter under the bars)
//   ACH  = src/shared/lib/alterationCountHelpers.ts (count*AlterationOccurences, isSampleProfiledInMultiple)
// Spec: docs/legacy-spec/02-cancer-types-summary.md CTS-CH-5 (rows, glyph), CTS-CH-6 (tooltip), CTS-MD-8
// (a gene off some panels: "minus" where a group has no profiled case).
//
// Case table:
//   S1  rows top to bottom: Structural variant data, Mutation data, CNA data, mRNA data, Protein data,
//       whatever the order of `types`                                                                 (CTS-CH-5)
//   S2  a row per type in `types` only: a type not in it has no row, even when groups count it > 0     (CTS-CH-5)
//   S3  one mark per group, in their order; plus = that group's count > 0                             (CTS-CH-5)
//   S4  a group with count 0: a minus mark, tip "Not profiled"                                        (CTS-CH-6, CTS-MD-8)
//   S5  tip "<n> patients profiled", "1 patient profiled"; the raw count, no thousands separator       (CTS-CH-6)
//   S6  sample mode: "<n> samples profiled", "1 sample profiled"                                       (CTS-CH-6)
//   S7  a group without profiledFor, or without the key, counts 0                                     (CTS-CH-5)
//   S8  a row of `types` every group counts 0 is still drawn, all minus                               (CTS-CH-5)
//   S9  empty `types`: []                                                                             (CTS-CH-5)
//   R1  readTypes(null): sv, mutation, cna
//   R2  a bare gene: sv, mutation, cna
//   R3  MUT, MUT_DRIVER, MUT=G12D: mutation; AMP, HOMDEL, CNA: cna; FUSION: sv
//   R4  EXP>2: mrna; PROT<-1: prot
//   R5  the union over lines, in strip order
//   F1  a gene tab with the genes-together groups all filtered out: the panel's profiledTypes still
//       draw every row for the gene's own groups, each mark's tip in its <title>                       (reviewer)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { profiledStrip, cancertypesPanelSvg } from "../lib/views/cancertypes/figure.ts";
import { readTypes } from "../lib/views/cancertypes/run.ts";
import type { CancertypesGroup, CancertypesResult } from "../lib/views/cancertypes/types.ts";

type Profiled = { mutation?: number; cna?: number; sv?: number; mrna?: number; prot?: number };
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
const ALL5 = ["sv", "mutation", "cna", "mrna", "prot"];
const FIVE = ["Structural variant data", "Mutation data", "CNA data", "mRNA data", "Protein data"];

describe("profiledStrip rows", () => {
  test("S1 all five rows in their fixed order", () => {
    const gs = [group("a", { mutation: 1, cna: 1, sv: 1, mrna: 1, prot: 1 })];
    assert.deepEqual(labels(profiledStrip(gs, ALL5, "sample")), FIVE);
  });
  test("S1 the order of `types` doesn't matter", () => {
    const gs = [group("a", { mutation: 1, cna: 1, sv: 1, mrna: 1, prot: 1 })];
    assert.deepEqual(labels(profiledStrip(gs, ["prot", "cna", "sv", "mrna", "mutation"], "sample")), FIVE);
    assert.deepEqual(labels(profiledStrip(gs, ["cna", "mutation", "sv"], "patient")), ["Structural variant data", "Mutation data", "CNA data"]);
  });
  test("S2 a type not in `types` has no row, even when groups were profiled for it", () => {
    const gs = [group("a", { mutation: 5, cna: 4, sv: 3, mrna: 2, prot: 1 })];
    assert.deepEqual(labels(profiledStrip(gs, ["mutation"], "patient")), ["Mutation data"]);
    assert.deepEqual(labels(profiledStrip(gs, ["mrna", "sv"], "patient")), ["Structural variant data", "mRNA data"]);
  });
});

describe("profiledStrip marks", () => {
  test("S3 one mark per group, in the groups' order", () => {
    const gs = [group("a", { mutation: 1 }), group("b", { mutation: 2 }), group("c", { mutation: 3 })];
    assert.deepEqual(row(profiledStrip(gs, ["mutation"], "patient"), "Mutation data").marks, [
      { plus: true, tip: "1 patient profiled" },
      { plus: true, tip: "2 patients profiled" },
      { plus: true, tip: "3 patients profiled" },
    ]);
    const rev = row(profiledStrip([gs[2], gs[0]], ["mutation"], "patient"), "Mutation data").marks;
    assert.deepEqual(rev.map((m) => m.tip), ["3 patients profiled", "1 patient profiled"]);
  });
  test("S3 every row has one mark per group", () => {
    const gs = [group("a", { mutation: 1, cna: 2, sv: 3, mrna: 4, prot: 5 }), group("b", { mutation: 0, cna: 0, sv: 0 })];
    for (const r of profiledStrip(gs, ALL5, "sample")) assert.equal(r.marks.length, 2, r.label);
  });
  test("S4 count 0: minus, Not profiled (CTS-MD-8)", () => {
    const gs = [group("a", { mutation: 10, cna: 10, sv: 10 }), group("b", { mutation: 0, cna: 7, sv: 10 })];
    const rows = profiledStrip(gs, ["mutation", "cna", "sv"], "patient");
    assert.deepEqual(row(rows, "Mutation data").marks, [{ plus: true, tip: "10 patients profiled" }, { plus: false, tip: "Not profiled" }]);
    assert.deepEqual(row(rows, "CNA data").marks, [{ plus: true, tip: "10 patients profiled" }, { plus: true, tip: "7 patients profiled" }]);
    assert.deepEqual(row(rows, "Structural variant data").marks.map((m) => m.plus), [true, true]);
  });
  test("S5 singular and plural, patients; the raw count", () => {
    const gs = [group("a", { mutation: 1, cna: 2, sv: 592, mrna: 12345 })];
    const rows = profiledStrip(gs, ALL5.slice(0, 4), "patient");
    assert.equal(row(rows, "Mutation data").marks[0].tip, "1 patient profiled");
    assert.equal(row(rows, "CNA data").marks[0].tip, "2 patients profiled");
    assert.equal(row(rows, "Structural variant data").marks[0].tip, "592 patients profiled");
    assert.equal(row(rows, "mRNA data").marks[0].tip, "12345 patients profiled");
  });
  test("S6 sample mode: singular and plural, samples", () => {
    const gs = [group("a", { mutation: 1, cna: 2, sv: 0, mrna: 1, prot: 13 }), group("b", { mutation: 0, cna: 1, sv: 0 })];
    const rows = profiledStrip(gs, ["mutation", "cna", "mrna", "prot"], "sample");
    assert.deepEqual(row(rows, "Mutation data").marks, [{ plus: true, tip: "1 sample profiled" }, { plus: false, tip: "Not profiled" }]);
    assert.deepEqual(row(rows, "CNA data").marks, [{ plus: true, tip: "2 samples profiled" }, { plus: true, tip: "1 sample profiled" }]);
    assert.deepEqual(row(rows, "mRNA data").marks, [{ plus: true, tip: "1 sample profiled" }, { plus: false, tip: "Not profiled" }]);
    assert.deepEqual(row(rows, "Protein data").marks, [{ plus: true, tip: "13 samples profiled" }, { plus: false, tip: "Not profiled" }]);
    assert.equal(profiledStrip([group("c", { mutation: 12345 })], ["mutation"], "sample")[0].marks[0].tip, "12345 samples profiled");
  });
});

describe("profiledStrip with missing data", () => {
  test("S7 a group without profiledFor counts 0", () => {
    const gs = [group("bare"), group("a", { mutation: 2 })];
    assert.deepEqual(profiledStrip(gs, ["mutation"], "patient"),
      [{ label: "Mutation data", marks: [{ plus: false, tip: "Not profiled" }, { plus: true, tip: "2 patients profiled" }] }]);
  });
  test("S7 a group without the key counts 0", () => {
    const gs = [group("a", { mutation: 1, cna: 0, sv: 0 }), group("b", { mutation: 1, cna: 0, sv: 0, mrna: 3 })];
    assert.deepEqual(row(profiledStrip(gs, ["mrna"], "patient"), "mRNA data").marks,
      [{ plus: false, tip: "Not profiled" }, { plus: true, tip: "3 patients profiled" }]);
  });
  test("S8 a row every group counts 0 is still drawn, all minus", () => {
    const gs = [group("a", { mutation: 4, cna: 0, sv: 0 }), group("b")];
    const rows = profiledStrip(gs, ["mutation", "cna", "prot"], "patient");
    assert.deepEqual(labels(rows), ["Mutation data", "CNA data", "Protein data"]);
    for (const l of ["CNA data", "Protein data"])
      assert.deepEqual(row(rows, l).marks, [{ plus: false, tip: "Not profiled" }, { plus: false, tip: "Not profiled" }]);
  });
  test("S8 no group profiled for anything: every row of `types`, all minus", () => {
    const rows = profiledStrip([group("a"), group("b")], ["sv", "mutation", "cna"], "sample");
    assert.deepEqual(labels(rows), FIVE.slice(0, 3));
    for (const r of rows) assert.deepEqual(r.marks.map((m) => m.plus), [false, false], r.label);
  });
  test("S8 no groups: rows with no marks", () => {
    const rows = profiledStrip([], ["mutation", "cna"], "patient");
    assert.deepEqual(rows, [{ label: "Mutation data", marks: [] }, { label: "CNA data", marks: [] }]);
  });
  test("S9 empty `types`: []", () => {
    assert.deepEqual(profiledStrip([group("a", { mutation: 5, cna: 5, sv: 5, mrna: 5, prot: 5 })], [], "patient"), []);
    assert.deepEqual(profiledStrip([], [], "patient"), []);
  });
});

describe("readTypes", () => {
  test("R1 without OQL: sv, mutation, cna", () => {
    assert.deepEqual(readTypes(null), ["sv", "mutation", "cna"]);
  });
  test("R2 a bare gene: sv, mutation, cna", () => {
    assert.deepEqual(readTypes(["KRAS"]), ["sv", "mutation", "cna"]);
  });
  test("R3 MUT in its forms: mutation", () => {
    for (const l of ["KRAS: MUT", "KRAS: MUT_DRIVER", "KRAS: MUT=G12D"]) assert.deepEqual(readTypes([l]), ["mutation"], l);
  });
  test("R3 AMP, HOMDEL, CNA: cna", () => {
    for (const l of ["KRAS: AMP", "CDKN2A: HOMDEL", "KRAS: AMP HOMDEL", "KRAS: CNA"]) assert.deepEqual(readTypes([l]), ["cna"], l);
  });
  test("R3 FUSION: sv", () => {
    for (const l of ["ERG: FUSION", "ALK: FUSION_DRIVER"]) assert.deepEqual(readTypes([l]), ["sv"], l);
  });
  test("R4 EXP: mrna; PROT: prot", () => {
    assert.deepEqual(readTypes(["KRAS: EXP>2"]), ["mrna"]);
    assert.deepEqual(readTypes(["KRAS: PROT<-1"]), ["prot"]);
  });
  test("R5 one line's specs, in strip order", () => {
    assert.deepEqual(readTypes(["KRAS: MUT FUSION AMP HOMDEL EXP>=2 EXP<=-2"]), ["sv", "mutation", "cna", "mrna"]);
    assert.deepEqual(readTypes(["KRAS: MUT=G12D EXP>=2 EXP<=-2 PROT>=2 PROT<=-2"]), ["mutation", "mrna", "prot"]);
  });
  test("R5 the union over lines, in strip order", () => {
    assert.deepEqual(readTypes(["KRAS: MUT", "EGFR: AMP EXP>2"]), ["mutation", "cna", "mrna"]);
    assert.deepEqual(readTypes(["EGFR: PROT<-1", "ERG: FUSION", "KRAS: MUT"]), ["sv", "mutation", "prot"]);
    assert.deepEqual(readTypes(["KRAS: EXP>2", "NRAS"]), ["sv", "mutation", "cna", "mrna"]);
  });
});

describe("the strip in the figure", () => {
  test("F1 a gene tab draws every profiled type although every genes-together group is filtered out", () => {
    const egfr = { ...group("lung", { mutation: 5, cna: 5, sv: 0 }), samples: 5, profiled: 5, altered: 2, mutation: 2 } as CancertypesGroup;
    const r: CancertypesResult = { groupBy: "CANCER_TYPE", measure: "any", genes: ["KRAS", "EGFR"], minSamples: 10, minAltered: 0,
      show: "frequency", unit: "sample",
      panels: [{ cohort: "all", samples: 5, profiled: 5, altered: 2, groups: [], categories: 1, minSamples: 10, filtered: true,
        profiledTypes: ["mutation", "cna", "sv"],
        perGene: [{ gene: "EGFR", altered: 2, profiled: 5, groups: [egfr], categories: 1, minSamples: 10 }] }] };
    const svg = cancertypesPanelSvg(r, 0, { gene: "EGFR" }).body;
    for (const l of ["Structural variant data", "Mutation data", "CNA data"]) assert.ok(svg.includes(l), l);
    assert.equal((svg.match(/>\+</g) || []).length, 2, "mutation and CNA");
    assert.equal((svg.match(/>−</g) || []).length, 1, "structural variant");
    assert.equal((svg.match(/<title>5 samples profiled<\/title>/g) || []).length, 2);
    assert.equal((svg.match(/<title>Not profiled<\/title>/g) || []).length, 1);
  });
});
