// patientSampleAttributes (lib/patient-sample-attributes.ts), driven through a stub resolver:
// viewMeta("table:attributes") gives the attribute meta rows, rowsPage gives the patient's sample rows.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { patientSampleAttributes } from "../lib/patient-sample-attributes.ts";

type Meta = { id: string; name: string; patient: number };
type Row = { patient: string; sample: string; m: Record<string, string> };

const META: Meta[] = [
  { id: "SEX", name: "Sex", patient: 1 },
  { id: "GRADE", name: "Grade", patient: 0 },
  { id: "SITE", name: "", patient: 0 },
  { id: "AGE", name: "Age", patient: 1 },
  { id: "TYPE", name: "Type", patient: 0 },
];

function stub(opts: { meta?: () => Promise<Meta[]>; rows?: () => Promise<{ rows: Row[]; total?: number }> } = {}) {
  const calls = { rowsPage: [] as string[] };
  const res = {
    viewMeta: async (key: string) => { assert.equal(key, "table:attributes"); return opts.meta ? opts.meta() : META; },
    cohortSql: () => "SELECT 1",
    rowsPage: async (label: string) => { calls.rowsPage.push(label); return opts.rows ? opts.rows() : { rows: [] as Row[], total: 0 }; },
  };
  return { res: res as any, calls };
}

describe("patientSampleAttributes", () => {
  test("PSA1 R1: columns are the sample-level attributes in meta order, name falls back to id", async () => {
    const { res } = stub();
    const out = await patientSampleAttributes(res, "s1", "P1");
    assert.deepEqual(out.columns, [{ id: "GRADE", name: "Grade" }, { id: "SITE", name: "SITE" }, { id: "TYPE", name: "Type" }]);
  });

  test("PSA2 R2: bySample holds pairs in columns order, empties and patient-level attributes left out", async () => {
    const { res } = stub({ rows: async () => ({ rows: [
      { patient: "P1", sample: "T1", m: { TYPE: "Primary", SEX: "F", GRADE: "II", SITE: "", AGE: "50" } },
      { patient: "P1", sample: "T2", m: { SEX: "F", SITE: "Lung", TYPE: "", GRADE: "III" } },
      { patient: "P1", sample: "T3", m: { SEX: "F" } },
    ] as Row[], total: 3 }) });
    const out = await patientSampleAttributes(res, "s1", "P1");
    assert.deepEqual(out.bySample, {
      T1: [["GRADE", "II"], ["TYPE", "Primary"]],
      T2: [["GRADE", "III"], ["SITE", "Lung"]],
      T3: [],
    });
  });

  test("PSA3 R3: no sample-level attributes gives empty result without calling rowsPage", async () => {
    const { res, calls } = stub({ meta: async () => [{ id: "SEX", name: "Sex", patient: 1 }] });
    const out = await patientSampleAttributes(res, "s1", "P1");
    assert.deepEqual(out, { columns: [], bySample: {} });
    assert.equal(calls.rowsPage.length, 0);
  });

  test("PSA4 R4: rowsPage label defaults to timeline:sample-attributes", async () => {
    const { res, calls } = stub();
    await patientSampleAttributes(res, "s1", "P1");
    assert.deepEqual(calls.rowsPage, ["timeline:sample-attributes"]);
  });

  test("PSA5 R4: rowsPage uses the given label", async () => {
    const { res, calls } = stub();
    await patientSampleAttributes(res, "s1", "P1", "evolution:group-by");
    assert.deepEqual(calls.rowsPage, ["evolution:group-by"]);
  });

  test("PSA6 R5: a failing viewMeta rejects", async () => {
    const { res } = stub({ meta: async () => { throw new Error("meta boom"); } });
    await assert.rejects(patientSampleAttributes(res, "s1", "P1"), /meta boom/);
  });

  test("PSA7 R5: a failing rowsPage rejects", async () => {
    const { res } = stub({ rows: async () => { throw new Error("rows boom"); } });
    await assert.rejects(patientSampleAttributes(res, "s1", "P1"), /rows boom/);
  });
});
