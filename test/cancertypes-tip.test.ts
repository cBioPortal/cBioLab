// The Cancer Types Summary bar's popover (lib/views/cancertypes/tip.ts) and portalRound2 (lib/chart/format.ts),
// driven with hand-built results. Each test is a row of the case table (R: rounding, T: the tip), from
// cbioportal-frontend cd8c6df CancerSummaryChart.tsx percentageRounder, formatGeneAlteredText,
// formatFrequencyText and the popover's alteration table (reverse stack order, rows with count > 0).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type {
  CancertypesResult, CancertypesGroup, CancertypesPanel,
} from "../lib/views/cancertypes/types.ts";

import { portalRound2 } from "../lib/chart/format.ts";
import { cancertypesTip } from "../lib/views/cancertypes/tip.ts";

const zero = { mutation: 0, amp: 0, homdel: 0, sv: 0, multiple: 0 };
const grp = (key: string, profiled: number, altered: number, counts: Partial<CancertypesGroup> = {}, label = key): CancertypesGroup =>
  ({ key, label, samples: profiled, profiled, altered, ...zero, ...counts });

const crc = grp("Colorectal Cancer", 982, 911, { mutation: 888, sv: 3, amp: 1, homdel: 1, multiple: 18 });

const panel = (groups: CancertypesGroup[], perGene?: CancertypesPanel["perGene"]): CancertypesPanel => ({
  cohort: "c", samples: 0, profiled: 0, altered: 0, groups, categories: groups.length, minSamples: 0, perGene,
});
const result = (panels: CancertypesPanel[], o: Partial<CancertypesResult> = {}): CancertypesResult => ({
  groupBy: "CANCER_TYPE", measure: "any", genes: ["KRAS", "TP53"], minSamples: null, minAltered: 0,
  show: "frequency", unit: "patient", panels, ...o,
});

describe("portalRound2", () => {
  test("R1: 0.9042769857433809 * 100 rounds to 90.43", async () => {
    assert.equal(portalRound2(0.9042769857433809 * 100), 90.43);
  });
  test("R2: 1.005 rounds to 1.01 (lodash's exponent shift)", async () => {
    assert.equal(portalRound2(1.005), 1.01);
  });
  test("R3: 0.1 stays 0.1", async () => {
    assert.equal(portalRound2(0.1), 0.1);
  });
  test("R4: 100 stays 100", async () => {
    assert.equal(portalRound2(100), 100);
  });
});

describe("cancertypesTip", () => {
  test("T1: by CANCER_TYPE, patients", async () => {
    const tip = cancertypesTip(result([panel([crc])]), 0, null, "Colorectal Cancer");
    assert.deepEqual(tip, {
      header: "Summary for Colorectal Cancer",
      study: null,
      altered: "Gene altered in 92.77% of 982 patients",
      rows: [
        ["Mutation", "90.43% (888 patients)"],
        ["Structural Variant", "0.31% (3 patients)"],
        ["Amplification", "0.1% (1 patient)"],
        ["Deep Deletion", "0.1% (1 patient)"],
        ["Multiple Alterations", "1.83% (18 patients)"],
      ],
    });
  });
  test("T2: by CANCER_TYPE, samples", async () => {
    const tip = cancertypesTip(result([panel([crc])], { unit: "sample" }), 0, null, "Colorectal Cancer");
    assert.deepEqual(tip, {
      header: "Summary for Colorectal Cancer",
      study: null,
      altered: "Gene altered in 92.77% of 982 samples",
      rows: [
        ["Mutation", "90.43% (888 samples)"],
        ["Structural Variant", "0.31% (3 samples)"],
        ["Amplification", "0.1% (1 sample)"],
        ["Deep Deletion", "0.1% (1 sample)"],
        ["Multiple Alterations", "1.83% (18 samples)"],
      ],
    });
  });
  test("T3: a type with count 0 has no row", async () => {
    const g = grp("Glioma", 50, 10, { mutation: 10 });
    const tip = cancertypesTip(result([panel([g])]), 0, null, "Glioma");
    assert.deepEqual(tip?.rows, [["Mutation", "20% (10 patients)"]]);
  });
  test("T4: by study, two groups drawn: the label as header, the key as study", async () => {
    const a = grp("coadread_tcga", 100, 40, { mutation: 40 }, "Colorectal (TCGA)");
    const b = grp("brca_tcga", 200, 20, { amp: 20 }, "Breast (TCGA)");
    const tip = cancertypesTip(result([panel([a, b])], { groupBy: "study" }), 0, null, "coadread_tcga");
    assert.deepEqual(tip, {
      header: "Colorectal (TCGA)",
      study: "coadread_tcga",
      altered: "Gene altered in 40% of 100 patients",
      rows: [["Mutation", "40% (40 patients)"]],
    });
  });
  test("T5: by study, one group drawn: Summary for, no study", async () => {
    const a = grp("coadread_tcga", 100, 40, { mutation: 40 }, "Colorectal (TCGA)");
    const tip = cancertypesTip(result([panel([a])], { groupBy: "study" }), 0, null, "coadread_tcga");
    assert.equal(tip?.header, "Summary for Colorectal (TCGA)");
    assert.equal(tip?.study, null);
  });
  test("T6: a gene tab reads that tab's counts", async () => {
    const kras = grp("Colorectal Cancer", 982, 400, { mutation: 400 });
    const tip = cancertypesTip(
      result([panel([crc], [{ gene: "KRAS", groups: [kras], categories: 1, minSamples: 0 }])]), 0, "KRAS", "Colorectal Cancer");
    assert.deepEqual(tip, {
      header: "Summary for Colorectal Cancer",
      study: null,
      altered: "Gene altered in 40.73% of 982 patients",
      rows: [["Mutation", "40.73% (400 patients)"]],
    });
  });
  test("T7: mRNA and protein rows in reverse stack order", async () => {
    const g = grp("Colorectal Cancer", 982, 914, { mutation: 888, sv: 3, amp: 1, homdel: 1, multiple: 18, mrnaHigh: 2, protLow: 1 });
    const tip = cancertypesTip(result([panel([g])]), 0, null, "Colorectal Cancer");
    assert.deepEqual(tip?.rows, [
      ["Mutation", "90.43% (888 patients)"],
      ["Structural Variant", "0.31% (3 patients)"],
      ["Amplification", "0.1% (1 patient)"],
      ["Deep Deletion", "0.1% (1 patient)"],
      ["mRNA High", "0.2% (2 patients)"],
      ["Protein Low", "0.1% (1 patient)"],
      ["Multiple Alterations", "1.83% (18 patients)"],
    ]);
  });
  test("T8: a key not drawn in the panel gives null", async () => {
    const tip = cancertypesTip(result([panel([crc])]), 0, null, "Glioma");
    assert.equal(tip, null);
  });
});
