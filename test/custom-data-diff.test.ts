// What a new version of an upload changes (lib/custom-data-diff.ts): the summary a reader confirms
// before overwriting, so every change it misses is a change saved unseen.
import { test } from "node:test";
import assert from "node:assert/strict";

import { diffDatasets, diffSentences, diffToTsv } from "../lib/custom-data-diff.ts";
import type { CustomDataset } from "../lib/custom-data-names.ts";

const V1: CustomDataset = {
  id: "mets", name: "Mets", level: "patient",
  columns: [{ name: "SITE", datatype: "STRING" }, { name: "KPS", datatype: "NUMBER" }, { name: "NOTE", datatype: "STRING" }],
  rows: [
    { study: "s1", patient: "P-1", values: ["Brain", "80", "a"] },
    { study: "s1", patient: "P-2", values: ["Liver", "", "b"] },
    { study: "s1", patient: "P-3", values: ["Bone", "90", "c"] },
    { study: "s1", patient: "P-4", values: ["Lung", "70", ""] }
  ]
};

test("identical data, rows in another order, numbers written differently: no change", () => {
  const v2 = { ...V1, rows: [...V1.rows].reverse().map((r) => r.patient === "P-1" ? { ...r, values: ["Brain", "80.0", "a"] } : r) };
  const d = diffDatasets(V1, v2);
  assert.equal(d.same, true);
  assert.equal(d.losesData, false);
  assert.deepEqual(diffSentences(d, "patient"), ["No changes: the data is identical to the saved version."]);
});

test("every kind of change is counted, and the ones that lose data say so", () => {
  const v2: CustomDataset = {
    ...V1, name: "Mets (curated)",
    columns: [{ name: "SITE", datatype: "STRING" }, { name: "KPS", datatype: "STRING" }, { name: "GRADE", datatype: "NUMBER" }],
    rows: [
      { study: "s1", patient: "P-1", values: ["Brain", "80", "1"] },     // unchanged (KPS compared as text now, same text)
      { study: "s1", patient: "P-2", values: ["Liver", "60", "2"] },     // KPS filled
      { study: "s1", patient: "P-3", values: ["Brain", "", "3"] },       // SITE changed, KPS cleared
      { study: "s2", patient: "P-9", values: ["Skin", "100", "1"] }      // added, in a new study
    ]                                                                     // P-4 removed
  };
  const d = diffDatasets(V1, v2);
  assert.equal(d.same, false);
  assert.equal(d.losesData, true);
  assert.deepEqual(d.name, { from: "Mets", to: "Mets (curated)" });
  assert.deepEqual(d.columns.added.map((c) => c.name), ["GRADE"]);
  assert.deepEqual(d.columns.removed.map((c) => c.name), ["NOTE"]);
  assert.deepEqual(d.columns.retyped, [{ name: "KPS", from: "NUMBER", to: "STRING" }]);
  assert.deepEqual(d.cases, { added: ["s2:P-9"], removed: ["s1:P-4"], kept: 3, before: 4, after: 4 });
  assert.deepEqual(d.studies, { added: ["s2"], removed: [] });
  // GRADE is new, so each kept case's value in it is filled in
  assert.deepEqual(d.values.map((v) => [v.column, v.changed, v.filled, v.cleared]), [["SITE", 1, 0, 0], ["KPS", 0, 1, 1], ["GRADE", 0, 3, 0]]);
  assert.deepEqual(d.all.map((v) => [v.id, v.column, v.from, v.to]),
    [["s1:P-1", "GRADE", "", "1"], ["s1:P-2", "KPS", "", "60"], ["s1:P-2", "GRADE", "", "2"],
     ["s1:P-3", "SITE", "Bone", "Brain"], ["s1:P-3", "KPS", "90", ""], ["s1:P-3", "GRADE", "", "3"]]);
  const s = diffSentences(d, "patient");
  assert.equal(s[0], "1 patient removed (of 4)");
  assert.ok(s.includes("1 column removed: NOTE"));
  assert.ok(s.includes("KPS changes type: numeric → categorical"));
  assert.ok(s.includes("KPS: 1 value cleared, 1 value filled in"));
  assert.ok(s.includes("GRADE: 3 values filled in"));
  assert.ok(s.includes("renamed “Mets” → “Mets (curated)”"));
  const tsv = diffToTsv(d).trim().split("\n");
  assert.equal(tsv.length, 1 + 1 + 1 + 1 + 1 + 1 + 6);
  assert.ok(tsv.includes("value changed\ts1:P-3\tSITE\tBone\tBrain"));
});

test("only additions do not lose data", () => {
  const v2: CustomDataset = { ...V1, rows: [...V1.rows, { study: "s1", patient: "P-5", values: ["Brain", "", ""] }] };
  const d = diffDatasets(V1, v2);
  assert.equal(d.losesData, false);
  assert.deepEqual(diffSentences(d, "patient"), ["1 patient added"]);
});

test("sample-level cases are keyed by sample, so two samples of one patient are two cases", () => {
  const base: CustomDataset = { id: "x", name: "X", level: "sample", columns: [{ name: "A", datatype: "STRING" }],
    rows: [{ study: "s", patient: "P", sample: "S1", values: ["1"] }, { study: "s", patient: "P", sample: "S2", values: ["2"] }] };
  const d = diffDatasets(base, { ...base, rows: [base.rows[0]] });
  assert.deepEqual(d.cases.removed, ["s:S2"]);
  assert.throws(() => diffDatasets(base, { ...base, level: "patient" }), /sample-level dataset cannot be compared with a patient-level/);
});
