// The Clinical Data tab's tables on their side (lib/views/table/transpose.ts): the patient table's
// numbers as the portal's ClinicalInformationPatientTable writes them, the samples table's as stored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { transposedRows } from "../lib/views/table/transpose.ts";

const col = (id: string, name = id) => ({ id, name, numeric: false });

test("PTB-STM-11: the patient table writes a non-integer number to one decimal (coadread TCGA-A6-2671, as the portal shows it)", () => {
  const ids = ["patient", "OS_MONTHS", "PFS_MONTHS", "WEIGHT", "AGE", "TINY", "ZERO", "SEX", "EMPTY"];
  const t = { unit: "patient" as const, columns: ids.map((i) => col(i)),
    rows: [{ patient: "TCGA-A6-2671", values: ["TCGA-A6-2671", "43.75842457", "17.58884834", "67.2", "85", "0.04", "0.0", "Male", ""] }] };
  const { heads, rows } = transposedRows(t as never);
  assert.deepEqual(heads, ["TCGA-A6-2671"]);
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.values[0]])),
    { OS_MONTHS: "43.8", PFS_MONTHS: "17.6", WEIGHT: "67.2", AGE: "85", TINY: "< 0.1", ZERO: "0.0", SEX: "Male" });
});

test("PTB-CD-3, PTB-STM-11: the samples table writes values as stored, n/a where a sample has none, its own attributes only", () => {
  const t = { unit: "sample" as const, columns: [col("patient"), col("sample"), col("PURITY"), col("SEX"), col("TMB")], patientAttrs: ["SEX"],
    rows: [{ patient: "P04", sample: "P04_Pri", values: ["P04", "P04_Pri", "0.4881", "Male", ""] }, { patient: "P04", sample: "P04_Rec1", values: ["P04", "P04_Rec1", "", "Male", ""] }] };
  const { heads, rows } = transposedRows(t as never);
  assert.deepEqual(heads, ["P04_Pri", "P04_Rec1"]);
  assert.deepEqual(rows.map((r) => [r.id, r.values]), [["PURITY", ["0.4881", "n/a"]]]);
});

test("PTB-CD-3: the samples follow the page's sample order (sampleManager's, the numbered markers), not their ids", () => {
  const row = (s: string, v: string) => ({ patient: "P1", sample: s, values: ["P1", s, v] });
  const t = { unit: "sample" as const, columns: [col("patient"), col("sample"), col("TYPE")], patientAttrs: [],
    rows: [row("P1-A", "Metastasis"), row("P1-B", "Primary"), row("P1-C", "Recurrence")] };
  const cases: [string[] | undefined, string[], string[]][] = [
    [undefined, ["P1-A", "P1-B", "P1-C"], ["Metastasis", "Primary", "Recurrence"]],
    [["P1-B", "P1-C", "P1-A"], ["P1-B", "P1-C", "P1-A"], ["Primary", "Recurrence", "Metastasis"]],
    // a sample the order does not name comes after, in the table's order
    [["P1-C"], ["P1-C", "P1-A", "P1-B"], ["Recurrence", "Metastasis", "Primary"]],
  ];
  for (const [order, heads, values] of cases) {
    const r = transposedRows(t as never, order);
    assert.deepEqual(r.heads, heads, String(order));
    assert.deepEqual(r.rows[0].values, values, String(order));
  }
  // the patient table has no sample columns to order
  const p = transposedRows({ unit: "patient" as const, columns: [col("patient"), col("SEX")], rows: [{ patient: "P1", sample: "", values: ["P1", "Male"] }] } as never, ["x"]);
  assert.deepEqual(p.heads, ["P1"]);
});
