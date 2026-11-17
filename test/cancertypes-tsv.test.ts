// The Cancer Types Summary's "Data" download (lib/views/cancertypes/tsv.ts), driven with hand-built
// results. Each test is a row of the case table (H: the header, R: the rows), from cbioportal-frontend
// cd8c6df CancerSummaryChart.tsx getData / convertDataToDownloadData and CancerSummaryContent.tsx
// OrderedAlterationLabelMap, chartData, getYValue and xAxisString; fields formatted as d3-dsv's tsvFormatRows.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type {
  CancertypesResult, CancertypesGroup, CancertypesGroups, CancertypesPanel,
} from "../lib/views/cancertypes/types.ts";
import { cancertypesTsv } from "../lib/views/cancertypes/tsv.ts";

const zero = { mutation: 0, amp: 0, homdel: 0, sv: 0, multiple: 0 };
const grp = (key: string, profiled: number, counts: Partial<CancertypesGroup> = {}, label = key): CancertypesGroup => {
  const c = { ...zero, ...counts };
  const altered = c.mutation + c.amp + c.homdel + c.sv + c.multiple
    + (c.mrnaHigh ?? 0) + (c.mrnaLow ?? 0) + (c.protHigh ?? 0) + (c.protLow ?? 0);
  return { key, label, samples: profiled, profiled, altered, ...c };
};
const panel = (groups: CancertypesGroup[], extra: Partial<CancertypesPanel> = {}): CancertypesPanel => ({
  cohort: "c", samples: 0, profiled: 0, altered: 0,
  groups, categories: groups.length, minSamples: 0, ...extra,
});
const result = (panels: CancertypesPanel[], extra: Partial<CancertypesResult> = {}): CancertypesResult => ({
  groupBy: "CANCER_TYPE", measure: "any", genes: ["TP53"], minSamples: null, minAltered: 0,
  show: "frequency", unit: "patient", panels, ...extra,
});
const lines = (s: string) => s.split("\n");

describe("cancertypesTsv (Cancer Types Summary data download)", () => {
  test("H1: header row — category label by groupBy, y label by show", async () => {
    const p = [panel([])];
    assert.equal(cancertypesTsv(result(p, { groupBy: "study" }), 0, null),
      "Cancer Study\tAlteration Frequency\tAlteration Type\tAlteration Count");
    assert.equal(cancertypesTsv(result(p, { groupBy: "CANCER_TYPE" }), 0, null),
      "Cancer Type\tAlteration Frequency\tAlteration Type\tAlteration Count");
    assert.equal(cancertypesTsv(result(p, { groupBy: "CANCER_TYPE_DETAILED", show: "count" }), 0, null),
      "Cancer Type Detailed\tAbsolute Counts\tAlteration Type\tAlteration Count");
    assert.equal(cancertypesTsv(result(p, { groupBy: "ONCOTREE_CODE", show: "count" }), 0, null),
      "ONCOTREE_CODE\tAbsolute Counts\tAlteration Type\tAlteration Count");
  });

  test("R1: row order — groups in panel order, types in the portal's map order", async () => {
    const a = grp("A", 10, {
      mutation: 1, sv: 1, amp: 1, homdel: 1, mrnaHigh: 1, mrnaLow: 1, protHigh: 1, protLow: 1, multiple: 1,
    });
    const b = grp("B", 10, { mutation: 2, multiple: 7 });
    const out = cancertypesTsv(result([panel([b, a])], { show: "count" }), 0, null);
    assert.deepEqual(lines(out).slice(1), [
      "B\t7\tmultiple\t7",
      "B\t2\tmutated\t2",
      "A\t1\tmultiple\t1",
      "A\t1\tprotExpressionLow\t1",
      "A\t1\tprotExpressionHigh\t1",
      "A\t1\tmrnaExpressionLow\t1",
      "A\t1\tmrnaExpressionHigh\t1",
      "A\t1\thomdel\t1",
      "A\t1\tamp\t1",
      "A\t1\tstructuralVariant\t1",
      "A\t1\tmutated\t1",
    ]);
  });

  test("R2: a type with count 0 in a group has no row", async () => {
    const out = cancertypesTsv(result([panel([grp("A", 10, { amp: 3, mutation: 0, homdel: 0 })])], { show: "count" }), 0, null);
    assert.deepEqual(lines(out).slice(1), ["A\t3\tamp\t3"]);
  });

  test("R3: frequency y is (count / profiled) * 100, unrounded", async () => {
    const out = cancertypesTsv(result([panel([grp("A", 982, { mutation: 888 }), grp("B", 3, { amp: 1 })])]), 0, null);
    assert.deepEqual(lines(out).slice(1), [
      "A\t90.4276985743381\tmutated\t888",
      "B\t33.33333333333333\tamp\t1",
    ]);
  });

  test("R4: count y is the count", async () => {
    const out = cancertypesTsv(result([panel([grp("A", 982, { mutation: 888 })])], { show: "count" }), 0, null);
    assert.deepEqual(lines(out).slice(1), ["A\t888\tmutated\t888"]);
  });

  test("R5: the count column is the integer count", async () => {
    const out = cancertypesTsv(result([panel([grp("A", 1000, { mutation: 888 })])]), 0, null);
    assert.deepEqual(lines(out).slice(1), ["A\t88.8\tmutated\t888"]);
  });

  test("R6: the group column is the label as drawn, not the key", async () => {
    const g = grp("brca_tcga_pan_can_atlas_2018", 4, { mutation: 3 }, "Breast Invasive Carcinoma (TCGA PanCancer)");
    const out = cancertypesTsv(result([panel([g])], { groupBy: "study" }), 0, null);
    assert.equal(out,
      "Cancer Study\tAlteration Frequency\tAlteration Type\tAlteration Count\n"
      + "Breast Invasive Carcinoma (TCGA PanCancer)\t75\tmutated\t3");
  });

  test("R7: groups hidden by the filters (not in groups) have no rows", async () => {
    const p = panel([grp("Shown", 10, { mutation: 2 })], { categories: 3, minSamples: 10, filtered: true });
    const out = cancertypesTsv(result([p], { show: "count" }), 0, null);
    assert.deepEqual(lines(out).slice(1), ["Shown\t2\tmutated\t2"]);
  });

  test("R8: a gene tab uses that gene's perGene groups and counts", async () => {
    const kras: CancertypesGroups & { gene: string; altered: number } = {
      gene: "KRAS", altered: 1, groups: [grp("Lung", 10, { amp: 1 })], categories: 1, minSamples: 0,
    };
    const tp53: CancertypesGroups & { gene: string; altered: number } = {
      gene: "TP53", altered: 8, groups: [grp("Colon", 4, { mutation: 1 }), grp("Lung", 10, { mutation: 7 })], categories: 2, minSamples: 0,
    };
    const p = panel([grp("Lung", 10, { mutation: 7, amp: 1 })], { perGene: [kras, tp53] });
    const r = result([p], { genes: ["TP53", "KRAS"] });
    assert.deepEqual(lines(cancertypesTsv(r, 0, "TP53")).slice(1), [
      "Colon\t25\tmutated\t1",
      "Lung\t70\tmutated\t7",
    ]);
    assert.deepEqual(lines(cancertypesTsv(r, 0, "KRAS")).slice(1), ["Lung\t10\tamp\t1"]);
    assert.deepEqual(lines(cancertypesTsv(r, 0, null)).slice(1), [
      "Lung\t10\tamp\t1",
      "Lung\t70\tmutated\t7",
    ]);
  });

  test("R9: fields with a tab, newline or double quote are quoted as d3-dsv does", async () => {
    const out = cancertypesTsv(result([panel([
      grp("q", 10, { mutation: 1 }, 'Foo "bar"'),
      grp("t", 10, { mutation: 1 }, "a\tb"),
      grp("n", 10, { mutation: 1 }, "c\nd"),
    ])], { show: "count" }), 0, null);
    assert.equal(out,
      "Cancer Type\tAbsolute Counts\tAlteration Type\tAlteration Count\n"
      + "\"Foo \"\"bar\"\"\"\t1\tmutated\t1\n"
      + "\"a\tb\"\t1\tmutated\t1\n"
      + "\"c\nd\"\t1\tmutated\t1");
  });

  test("R10: lines joined by \\n, no trailing newline", async () => {
    const out = cancertypesTsv(result([panel([grp("A", 2, { mutation: 1 })])]), 0, null);
    assert.equal(out, "Cancer Type\tAlteration Frequency\tAlteration Type\tAlteration Count\nA\t50\tmutated\t1");
    assert.ok(!out.endsWith("\n"));
    assert.ok(!out.includes("\r"));
  });

  test("R11: no group shown gives the header row alone", async () => {
    const p = panel([], { categories: 4, minSamples: 10, filtered: true });
    assert.equal(cancertypesTsv(result([panel([grp("X", 5, { mutation: 1 })]), p]), 1, null),
      "Cancer Type\tAlteration Frequency\tAlteration Type\tAlteration Count");
  });
});
