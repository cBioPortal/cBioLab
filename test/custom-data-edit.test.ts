// A stored upload edited as a table (lib/custom-data-edit.ts): what the editor would save, which the
// diff (lib/custom-data-diff.ts) then shows before it is.
import { test } from "node:test";
import assert from "node:assert/strict";

import { addColumn, addedRowProblems, addRow, columnType, dropRow, lostFrom, mergeDataset, mergeRows, setCell, setNewId, toDataset, working, type Matches } from "../lib/custom-data-edit.ts";
import { diffDatasets } from "../lib/custom-data-diff.ts";
import type { CustomDataset } from "../lib/custom-data-names.ts";

const V1: CustomDataset = {
  id: "mets", name: "Mets", level: "patient",
  columns: [{ name: "SITE", datatype: "STRING" }, { name: "KPS", datatype: "NUMBER" }],
  rows: [
    { study: "s1", patient: "P-1", values: ["Brain", "80"] },
    { study: "s1", patient: "P-2", values: ["Liver", ""] },
    { study: "s1", patient: "P-3", values: ["Bone", "90"] }
  ]
};

test("the table untouched saves the stored data", () => {
  const d = toDataset(V1, working(V1), "Mets", null);
  assert.equal(diffDatasets(V1, d).same, true);
});

test("cell edits and an added column are what the diff sees, and nothing is lost", () => {
  let w = working(V1);
  w = setCell(w, "s1:P-1", "SITE", " Lung ");
  w = setCell(w, "s1:P-2", "KPS", "70");
  w = addColumn(w, "ecog score");
  w = setCell(w, "s1:P-1", "ECOG_SCORE", "1");
  assert.throws(() => addColumn(w, "Ecog Score"), /already a column/);
  assert.throws(() => addColumn(w, "  "), /needs a name/);
  const d = toDataset(V1, w, "Mets", null);
  assert.deepEqual(d.columns, [{ name: "SITE", datatype: "STRING" }, { name: "KPS", datatype: "NUMBER" }, { name: "ECOG_SCORE", datatype: "NUMBER" }]);
  const diff = diffDatasets(V1, d);
  assert.deepEqual(diff.cases.removed, []);
  assert.deepEqual(diff.all.map((c) => [c.id, c.column, c.from, c.to]),
    [["s1:P-1", "SITE", "Brain", "Lung"], ["s1:P-1", "ECOG_SCORE", "", "1"], ["s1:P-2", "KPS", "", "70"]]);
  assert.deepEqual(diff.columns.added.map((c) => c.name), ["ECOG_SCORE"]);
  assert.deepEqual(lostFrom(V1, d), { columns: [], cases: [] });
});

test("a file merged in updates the ids it shares, adds the new ones, and leaves every other row, column and blank alone", () => {
  const file = { name: "Mets", columns: [{ name: "KPS", datatype: "NUMBER" as const }, { name: "GRADE", datatype: "STRING" as const }],
    rows: [
      { study: "s1", patient: "P-2", values: ["60", "2"] },   // KPS filled, GRADE new
      { study: "s1", patient: "P-3", values: ["", "3"] },     // blank KPS: 90 stays
      { study: "s1", patient: "P-9", values: ["100", "1"] }   // new patient
    ] };
  const d = mergeDataset(V1, file);
  assert.deepEqual(d.columns.map((c) => [c.name, c.datatype]), [["SITE", "STRING"], ["KPS", "NUMBER"], ["GRADE", "STRING"]]);
  assert.deepEqual(d.rows.map((r) => [r.patient, ...r.values]), [
    ["P-1", "Brain", "80", ""], ["P-2", "Liver", "60", "2"], ["P-3", "Bone", "90", "3"], ["P-9", "", "100", "1"]]);
  const diff = diffDatasets(V1, d);
  assert.deepEqual(diff.cases.added, ["s1:P-9"]);
  assert.deepEqual(diff.cases.removed, []);
  assert.deepEqual(diff.all.map((c) => [c.id, c.column, c.from, c.to]),
    [["s1:P-2", "KPS", "", "60"], ["s1:P-2", "GRADE", "", "2"], ["s1:P-3", "GRADE", "", "3"]]);
  assert.equal(diff.losesData, false);
  // a row the merge added can be taken out again before saving
  assert.deepEqual(toDataset(V1, dropRow(mergeRows(working(V1), "patient", file), "s1:P-9"), "Mets", null).rows.length, 3);
});

test("what a new version leaves out of the one it follows", () => {
  assert.deepEqual(lostFrom(V1, { columns: V1.columns.slice(1), rows: V1.rows.slice(1) }), { columns: ["SITE"], cases: ["s1:P-1"] });
});

test("a number typed as text makes a numeric column categorical; a categorical one stays so", () => {
  assert.equal(columnType("NUMBER", ["80", "n/a"]), "STRING");
  assert.equal(columnType("STRING", ["1", "2"]), "STRING");
  assert.equal(columnType(undefined, ["", ""]), "STRING");
  assert.equal(columnType("NUMBER", ["", ""]), "NUMBER");
});

test("an added row is saved as the case its id matched, and says what is wrong when it cannot be", () => {
  let w = addRow(addRow(addRow(working(V1), "s1"), "s1"), "s1");
  const [a, b, c] = w.rows.slice(0, 3).map((r) => r.key);
  w = setNewId(setNewId(w, a, "P-9"), b, "P-1");
  w = setCell(w, a, "SITE", "Skin");
  const matches: Matches = new Map([[a, [{ study: "s1", patient: "P-9" }]], [b, [{ study: "s1", patient: "P-1" }]]]);
  const problems = addedRowProblems(w, "patient", matches);
  assert.equal(problems.get(b), "s1:P-1 is already in the table");
  assert.equal(problems.get(c), "type its patient id");
  assert.equal(problems.has(a), false);
  const d = toDataset(V1, dropRow(dropRow(w, b), c), "Mets", matches);
  assert.deepEqual(diffDatasets(V1, d).cases.added, ["s1:P-9"]);
  assert.deepEqual(d.rows.find((r) => r.patient === "P-9")!.values, ["Skin", ""]);
});
