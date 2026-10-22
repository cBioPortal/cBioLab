// OQL mutation classes as cBioPortal defines them: one mapping from raw mutation types to classes
// (cbioportal-frontend getSimplifiedMutationType), and TRUNC as every class but missense and in-frame.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseOql, oqlLeafSql } from "../lib/oql.ts";
import { genomicEventsSql, vafSql } from "../lib/oncoprint.ts";
import { axisSelect } from "../lib/plot.ts";

const spec = (q: string) => parseOql(q)[0].specs[0];
const sql = (q: string) => oqlLeafSql(q, { study: "s1", db: "db", oncokbPin: "v1" });

describe("OQL mutation classes: the portal's nine", () => {
  test("each class keyword parses to its class, alone, after MUT= and with DRIVER", () => {
    const want: Record<string, string> = { MISSENSE: "missense", NONSENSE: "nonsense", NONSTART: "nonstart", NONSTOP: "nonstop",
      FRAMESHIFT: "frameshift", INFRAME: "inframe", SPLICE: "splice", PROMOTER: "promoter", TRUNC: "trunc" };
    for (const [kw, cls] of Object.entries(want)) {
      assert.deepEqual(spec("TP53: " + kw), { type: "MUT", cls, driver: false }, kw);
      assert.deepEqual(spec("TP53: MUT=" + kw), { type: "MUT", cls, driver: false }, "MUT=" + kw);
      assert.deepEqual(spec("TP53: " + kw + "_DRIVER"), { type: "MUT", cls, driver: true }, kw + "_DRIVER");
    }
  });
  test("NONSTART, NONSTOP and FRAMESHIFT are classes, not protein changes that match nothing", () => {
    for (const kw of ["NONSTART", "NONSTOP", "FRAMESHIFT"]) assert.equal(spec("TP53: " + kw).pchange, undefined, kw);
  });
  test("PROMOTER is a class now, not a refusal", () => {
    assert.doesNotThrow(() => parseOql("TERT: PROMOTER"));
  });
});

describe("OQL mutation classes: SQL", () => {
  test("a class reads the portal's mapping of the stored type, never a type prefix", () => {
    const s = sql("TP53: SPLICE");
    assert.match(s, /lower\(g\.mutation_type\) IN \('splice_site', 'splice', 'splice site', 'splicing', 'splice_site_snp', 'splice_site_del', 'splice_site_indel', 'splice_region'\), 'splice'/);
    assert.match(s, /, 'other'\) = 'splice'/);
    assert.doesNotMatch(s, /LIKE/);
  });
  test("a protein change of Promoter is a promoter mutation whatever its type", () => {
    assert.match(sql("TERT: PROMOTER"), /lower\(g\.mutation_variant\) = 'promoter', 'promoter'/);
  });
  test("TRUNC is every class but missense and in-frame, splice and promoter included", () => {
    assert.match(sql("APC: TRUNC"), /, 'other'\) NOT IN \('missense', 'inframe'\)/);
  });
  test("a class and a position range are tested on the same mutation", () => {
    const s = sql("APC: TRUNC_(1400-)");
    assert.match(s, /mutation_derived/);
    assert.match(s, /NOT IN \('missense', 'inframe'\)/);
    assert.match(s, /g\.pos_end >= 1400/);
  });
});

describe("uncalled mutations are read support, not alterations", () => {
  // a variant called in one of a patient's samples, looked up in the others below the caller's
  // thresholds (mutation_status UNCALLED); the portal never counts one
  const leaf = (q: string) => oqlLeafSql(q, { study: "s1", db: "db", oncokbPin: "v1" });
  for (const q of ["TP53: MUT", "TP53", "TP53: DRIVER", "TP53: MISSENSE", "APC: TRUNC_(1400-)", "KRAS: G12C"]) {
    test(q + " leaves them out", () => assert.match(leaf(q), /g\.mutation_status != 'UNCALLED'/));
  }
  test("the position table carries the same status, so a range query leaves them out too", () => {
    assert.match(leaf("APC: TRUNC_(1400-)"), /ifNull\(mutationStatus, ''\) AS mutation_status/);
  });
  test("the oncoprint's cells and VAF, and a plot's alteration axis, leave them out", () => {
    assert.match(genomicEventsSql(["TP53"], "s1", "db"), /AND mutation_status != 'UNCALLED'/);
    assert.match(vafSql(["TP53"], "s1", "db"), /molecularProfileId NOT LIKE '%uncalled%'/);
    assert.match(axisSelect({ source: "alteration", genes: ["TP53"] }, { study: "s1", db: "db", unit: "sample", cohortSql: "SELECT 1" }, "cat"),
      /AND mutation_status != 'UNCALLED'/);
  });
});
