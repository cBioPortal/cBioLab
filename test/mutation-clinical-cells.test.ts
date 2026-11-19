// MUT-COL-36: a clinical attribute's cell and header tooltip, as the portal draws them (cbioportal-frontend
// cd8c6df ClinicalAttributeColumnFormatter + TruncatedText, maxLength 30, buffer 2, suffix "..."): a value
// longer than 32 characters cut to its first 30 and "...", the whole value as its tip only when cut; no value
// an empty NA cell; the header's tip the attribute's description.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLINICAL_NA_TIP, clinicalCellText } from "../lib/mutation-cell-text.ts";
import { clinicalColumns } from "../lib/mutation-clinical.ts";

const NA = "Clinical attribute not available for this sample.";
const attr = (id: string, name: string, description?: string) =>
  ({ id, name, datatype: "STRING", patient: 1, priority: 1, ...(description === undefined ? {} : { description }) });

test("T1 no value: empty text, the NA tip", () => {
  assert.equal(CLINICAL_NA_TIP, NA);
  for (const v of [null, undefined, ""]) assert.deepEqual(clinicalCellText(v), { text: "", tip: NA });
});

test("T2 a 32-character value is not cut and has no tip", () => {
  const s = "a".repeat(31) + "b";
  assert.equal(s.length, 32);
  assert.deepEqual(clinicalCellText(s), { text: s, tip: null });
});

test("T3 a 33-character value is cut to 30 and '...', the whole value as its tip", () => {
  const s = "abcdefghij".repeat(3) + "XYZ";
  assert.equal(s.length, 33);
  assert.deepEqual(clinicalCellText(s), { text: s.substring(0, 30) + "...", tip: s });
});

test("T4 numbers are written as the value they hold", () => {
  assert.deepEqual(clinicalCellText(42), { text: "42", tip: null });
  assert.deepEqual(clinicalCellText(0.4881), { text: "0.4881", tip: null });
});

test("T5 a column carries its description; none or blank leaves the property out", () => {
  const cols = clinicalColumns([[attr("SEX", "Sex", "Sex of the patient"), attr("A1", "Attr 1"), attr("A2", "Attr 2", "   ")]], new Set());
  assert.equal(cols.find((c) => c.id === "SEX")!.description, "Sex of the patient");
  assert.equal("description" in cols.find((c) => c.id === "A1")!, false);
  assert.equal("description" in cols.find((c) => c.id === "A2")!, false);
});

test("T6 the first study's description wins", () => {
  const cols = clinicalColumns([[attr("X", "X", "A")], [attr("X", "X", "B")]], new Set());
  assert.equal(cols.length, 1);
  assert.equal(cols[0].description, "A");
});
