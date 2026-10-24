// Compare view: telling "0% altered, fully assayed" apart from "0% altered because this whole
// alteration type was never assayed here" — the bug where a study with zero CNA data reported a
// CNA-only gene as a false negative instead of refusing/disclosing it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { missingAlterationTypes, type AlterationType } from "../lib/views/compare/run.ts";

const tc = (profiled: number, altered = 0) => ({ profiled, altered });
const cell = (mutation: ReturnType<typeof tc>, cna: ReturnType<typeof tc>, structuralVariant: ReturnType<typeof tc>) =>
  ({ byType: { mutation, cna, structuralVariant } });
const row = (...cells: ReturnType<typeof cell>[]) => ({ cells });

describe("missingAlterationTypes", () => {
  test("everything assayed: no missing types", () => {
    const rows = [row(cell(tc(444, 0), tc(444, 12), tc(444, 0)))];
    const r = missingAlterationTypes(rows);
    assert.deepEqual(r.missing, []);
    assert.deepEqual(r.assayed.sort(), ["cna", "mutation", "structuralVariant"].sort());
  });

  test("the exact sarcoma/MDM2 case: CNA never assayed study-wide, mutation and SV were", () => {
    // MDM2: profiled 444 for mutation and SV, 0 for CNA — but 0 altered doesn't itself
    // distinguish "never checked" from "checked, none found"; profiled=0 does.
    const rows = [
      row(cell(tc(444, 0), tc(0, 0), tc(444, 0))),   // MDM2
      row(cell(tc(444, 11), tc(0, 0), tc(444, 6))),  // TP53
    ];
    const r = missingAlterationTypes(rows);
    assert.deepEqual(r.missing, ["cna"]);
    assert.deepEqual(r.assayed.sort(), ["mutation", "structuralVariant"].sort());
  });

  test("a gene missing from ONE panel is not a study-wide gap — only unanimous absence counts", () => {
    // Gene A isn't on the CNA panel (0 profiled), but gene B is (12 profiled) — CNA was
    // assayed in this study, just not for every gene requested.
    const rows = [
      row(cell(tc(100, 1), tc(0, 0), tc(100, 0))),
      row(cell(tc(100, 2), tc(12, 3), tc(100, 0))),
    ];
    const r = missingAlterationTypes(rows);
    assert.deepEqual(r.missing, []);
  });

  test("nothing assayed at all: no false claim of a gap (assayed is also empty)", () => {
    const rows = [row(cell(tc(0), tc(0), tc(0)))];
    const r = missingAlterationTypes(rows);
    assert.deepEqual(r.assayed, []);
    assert.deepEqual(r.missing, ["mutation", "cna", "structuralVariant"] satisfies AlterationType[]);
    // both empty/full — the caller's `assayed.length && missing.length` guard means no note fires
  });

  test("no rows at all: reports everything missing, nothing assayed", () => {
    const r = missingAlterationTypes([]);
    assert.deepEqual(r.assayed, []);
    assert.deepEqual(r.missing.length, 3);
  });
});
