// Custom data (lib/custom-data.ts): validation, the external-table encoding, and the two
// properties everything else rests on — no custom data means the SQL is unchanged, and the
// uploaded rows go only to a connection entitled to patient-level data.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  validateCustomData, withCustomData, clinicalTable, clinicalMetaTable, customExternalsFor, encodeCustomData,
  hasCustomData, customAttr, parseCustomAttr, ATTR_NAME_RE, tsvField, LIMITS, type CustomDataset
} from "../lib/custom-data.ts";
import { compileCohortDef } from "../lib/cohort2.ts";
import { clinicalRecordedSql } from "../lib/event-names.ts";

const DS: CustomDataset = {
  id: "brain-mets", name: "Brain mets", level: "patient",
  columns: [{ name: "MET_SITE", datatype: "STRING" }, { name: "KPS", datatype: "NUMBER" }],
  rows: [
    { study: "s1", patient: "P-1", values: ["Brain", "80"] },
    { study: "s1", patient: "P-2", values: ["Primary", ""] }
  ]
};
const ctx = (datasets: CustomDataset[] = [DS]) => ({ datasets, allowedConns: new Set(["a"]), allowedDbs: new Set(["db1"]) });

describe("custom data: names", () => {
  test("a custom attribute is namespaced and round-trips", () => {
    assert.equal(customAttr("brain-mets", "MET_SITE"), "custom:brain-mets/MET_SITE");
    assert.deepEqual(parseCustomAttr("custom:brain-mets/MET_SITE"), { dataset: "brain-mets", column: "MET_SITE" });
    assert.equal(parseCustomAttr("MET_SITE"), null);
  });
  test("the shared attribute check accepts both kinds and nothing that could escape a literal", () => {
    for (const ok of ["CANCER_TYPE", "custom:brain-mets/MET_SITE", "custom:a/B_2"]) assert.ok(ATTR_NAME_RE.test(ok), ok);
    for (const bad of ["custom:Brain/X", "custom:a/b/c", "custom:a/x'y", "custom:/X", "A B", "custom:a/"]) assert.ok(!ATTR_NAME_RE.test(bad), bad);
  });
});

describe("custom data: validation", () => {
  test("a well-formed dataset passes through", () => {
    const [d] = validateCustomData([DS]);
    assert.equal(d.id, "brain-mets");
    assert.equal(d.rows.length, 2);
  });
  test("nothing is dropped silently: each defect is refused by name", () => {
    const bad = (patch: object, msg: RegExp) =>
      assert.throws(() => validateCustomData([{ ...DS, ...patch }]), msg);
    bad({ id: "Bad Id" }, /id must be/);
    bad({ level: "row" }, /level must be/);
    bad({ columns: [{ name: "a b", datatype: "STRING" }] }, /letters, digits and underscores/);
    bad({ columns: [{ name: "X", datatype: "DATE" }] }, /STRING or NUMBER/);
    bad({ rows: [{ study: "s1", patient: "P-1", values: ["only one"] }] }, /expected 2 values/);
    bad({ rows: [{ study: "s 1", patient: "P-1", values: ["a", "1"] }] }, /invalid study/);
    bad({ level: "sample" }, /needs a sample id/);
    assert.throws(() => validateCustomData([DS, DS]), /appears twice/);
    assert.throws(() => validateCustomData("x"), /must be an array/);
  });
  test("over a limit is refused with the limit named", () => {
    const many = Array.from({ length: LIMITS.datasets + 1 }, (_, i) => ({ ...DS, id: "d" + i }));
    assert.throws(() => validateCustomData(many), /at most 10 custom datasets/);
    const rows = Array.from({ length: LIMITS.cells / 2 + 1 }, (_, i) => ({ study: "s1", patient: "P" + i, values: ["a", "1"] }));
    assert.throws(() => validateCustomData([{ ...DS, rows }]), /limited to 600,000 values/);
  });
});

describe("custom data: encoding", () => {
  test("one row per non-empty value, keyed like the study's own clinical rows", () => {
    const { clinical, meta } = encodeCustomData([DS]);
    assert.deepEqual(clinical.split("\n").slice(0, -1), [
      "s1\tpatient\tcustom:brain-mets/MET_SITE\tBrain\ts1_P-1\t",
      "s1\tpatient\tcustom:brain-mets/KPS\t80\ts1_P-1\t",
      "s1\tpatient\tcustom:brain-mets/MET_SITE\tPrimary\ts1_P-2\t"
    ]);
    assert.equal(meta.trim().split("\n").length, 2);
    assert.match(meta, /custom:brain-mets\/KPS\tKPS\tCustom data: Brain mets\tNUMBER\t1\t/);
  });
  test("a subset carries only its columns", () => {
    const { clinical } = encodeCustomData([DS], new Set(["custom:brain-mets/KPS"]));
    assert.equal(clinical, "s1\tpatient\tcustom:brain-mets/KPS\t80\ts1_P-1\t\n");
  });
  test("sample-level rows carry both ids", () => {
    const d: CustomDataset = { ...DS, level: "sample", columns: [DS.columns[0]], rows: [{ study: "s1", patient: "P-1", sample: "P-1-T01", values: ["Brain"] }] };
    assert.equal(encodeCustomData([d]).clinical, "s1\tsample\tcustom:brain-mets/MET_SITE\tBrain\ts1_P-1\ts1_P-1-T01\n");
  });
  test("a value cannot break out of its TSV field", () => {
    assert.equal(tsvField("a\tb\nc\\d"), "a\\tb\\nc\\\\d");
  });
});

const OWN = (db: string) => "(SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type\n" +
  "   FROM " + db + ".clinical_data_derived WHERE " + clinicalRecordedSql("attribute_value") + ")";

describe("custom data: the merged clinical table", () => {
  test("without custom data it is the study's own rows with a recorded value", () => {
    assert.equal(hasCustomData(), false);
    assert.equal(clinicalTable("db1", "all"), OWN("db1"));
    assert.equal(clinicalMetaTable("db1"), "db1.clinical_attribute_meta");
    const sql = compileCohortDef({ all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Glioma"] }] }, { study: "s1", db: "db1" });
    assert.ok(!sql.includes("_custom_"));
  });
  test("with it, only statements that read a custom attribute get the union", () => withCustomData(ctx(), async () => {
    assert.equal(hasCustomData(), true);
    assert.equal(clinicalTable("db1", ["CANCER_TYPE"]), OWN("db1"));
    assert.match(clinicalTable("db1", "all"), /UNION ALL[\s\S]*FROM _custom_clinical WHERE [^\n]*\)$/);
    const one = clinicalTable("db1", ["custom:brain-mets/KPS"]);
    assert.match(one, /FROM _custom_clinical_[0-9a-f]{8} WHERE [^\n]*\)$/);
    const ext = customExternalsFor("SELECT 1 FROM " + one, "a");
    assert.equal(ext.length, 1);
    assert.equal(ext[0].data, "s1\tpatient\tcustom:brain-mets/KPS\t80\ts1_P-1\t\n");
    // a database not entitled to the rows is left alone
    assert.equal(clinicalTable("other_db", "all"), OWN("other_db"));
  }));
  test("a cohort leaf on a custom attribute compiles against the merged table", () => withCustomData(ctx(), async () => {
    const sql = compileCohortDef({ all: [{ kind: "clinical", attribute: "custom:brain-mets/MET_SITE", values: ["Brain"] }] }, { study: "s1", db: "db1" });
    assert.match(sql, /_custom_clinical_[0-9a-f]{8}/);
    assert.match(sql, /attribute_name = 'custom:brain-mets\/MET_SITE'/);
  }));
  test("statements that name no custom table upload nothing", () => withCustomData(ctx(), async () => {
    assert.deepEqual(customExternalsFor("SELECT count() FROM db1.sample_derived", "a"), []);
  }));
});

describe("custom data: patient-data boundary", () => {
  test("the rows are refused by a connection not entitled to them", () => withCustomData(ctx(), async () => {
    const sql = "SELECT 1 FROM " + clinicalTable("db1", "all");
    assert.throws(() => customExternalsFor(sql, "b"), /patient-level and cannot be sent to instance 'b'/);
    assert.throws(() => customExternalsFor("SELECT * FROM " + clinicalMetaTable("db1"), "peer"), /cannot be sent/);
  }));
  test("outside the request that carried them they do not exist", async () => {
    await withCustomData(ctx(), async () => assert.equal(hasCustomData(), true));
    assert.equal(hasCustomData(), false);
    assert.deepEqual(customExternalsFor("SELECT 1 FROM _custom_clinical", "a"), []);
  });
});

describe("custom data: a document that names an upload it was not sent with", () => {
  const doc = (attribute: string) => ({ study: "s1", cohorts: { a: { all: [{ kind: "clinical", attribute, values: ["Brain"] }] } }, views: [] });
  test("is refused by name, not answered as if nobody had a value", async () => {
    const { assertCustomDataPresent } = await import("../lib/custom-data.ts");
    assert.throws(() => assertCustomDataPresent(doc("custom:brain-mets/MET_SITE")), /custom data that was not sent with it: 'brain-mets'/);
    assert.doesNotThrow(() => assertCustomDataPresent(doc("CANCER_TYPE")));
    await withCustomData(ctx(), async () => {
      assert.doesNotThrow(() => assertCustomDataPresent(doc("custom:brain-mets/MET_SITE")));
      assert.throws(() => assertCustomDataPresent(doc("custom:brain-mets/NOPE")), /no column custom:brain-mets\/NOPE; its columns are custom:brain-mets\/MET_SITE/);
    });
  });
});

describe("custom data: the upload clause", () => {
  const upload = { kind: "upload" as const, dataset: "custom:brain-mets" };
  test("selects the samples with a row of any of the upload's columns, or every sample of a patient with one", () => withCustomData(ctx(), async () => {
    const sql = compileCohortDef({ all: [upload] }, { study: "s1", db: "db1" });
    assert.match(sql, /_custom_clinical_[0-9a-f]{8}/);
    assert.match(sql, /attribute_name IN \('custom:brain-mets\/MET_SITE','custom:brain-mets\/KPS'\)/);
    // patient and sample rows alike, each at its own level
    assert.match(sql, /SELECT DISTINCT type AS lvl, if\(type = 'sample'/);
    assert.doesNotMatch(sql, /AND type = /);
  }));
  test("names the upload as the document's other mentions of it do", async () => {
    const { assertCustomDataPresent } = await import("../lib/custom-data.ts");
    const { referencedDatasets } = await import("../app/lab/custom-data-client.ts");
    const doc = { study: "s1", cohorts: { a: { all: [upload] } }, views: [] };
    assert.deepEqual(referencedDatasets(doc), ["brain-mets"]);
    assert.throws(() => assertCustomDataPresent(doc), /custom data that was not sent with it: 'brain-mets'/);
    await withCustomData(ctx(), async () => assert.doesNotThrow(() => assertCustomDataPresent(doc)));
  });
  test("refuses a dataset that is not an upload's name", () => withCustomData(ctx(), async () => {
    assert.throws(() => compileCohortDef({ all: [{ kind: "upload", dataset: "brain-mets" }] }, { study: "s1", db: "db1" }), /dataset:"custom:<name>"/);
  }));
});

describe("custom data: every reader of the clinical tables goes through the merge", () => {
  test("no engine module names clinical_data_derived or clinical_attribute_meta in SQL directly", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = new URL("../lib/", import.meta.url);
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts") || f === "custom-data.ts") continue;
      const src = readFileSync(new URL(f, dir), "utf8");
      // a table reference in SQL is `<db> + ".clinical_..."`; prose and docs mention the names freely
      if (/\+\s*"\.clinical_(data_derived|attribute_meta)\b/.test(src)) offenders.push(f);
    }
    assert.deepEqual(offenders, [], "read these through clinicalTable()/clinicalMetaTable(), or uploads are silently ignored there");
  });
});
