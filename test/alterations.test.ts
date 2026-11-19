// The alterations view's tables (lib/patient-alterations.ts): the portal's columns and defaults,
// column ids that cannot be mistaken for the labels every row carries, and row sources the shared
// table query (lib/table-query.ts) can search, filter, sort and page on every column.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ALTERATION_TABLES, ALTERATION_COLUMNS, ALTERATION_DEFAULT_COLUMNS, ALTERATION_PATIENT_COLUMNS, ALTERATION_PATIENT_DEFAULT_COLUMNS,
  alterationSource, alterationPatientRowSource, patientSamplesSource,
} from "../lib/patient-alterations.ts";
import { checkQuery, countsSql, pageSql, rankSql, valuesSql } from "../lib/table-query.ts";

const part = { cohort: "Prostate", study: "msk_chord_2024", cohortSql: "SELECT 'P-1' AS pid" };
/** what every row carries besides its columns: a column with one of these ids would shadow it */
const LABELS = ["cohort", "study", "patient", "ord", "sid", "total"];

describe("the alterations view's tables", () => {
  for (const t of ALTERATION_TABLES) {
    const cols = ALTERATION_COLUMNS[t];
    test(t + ": ids unique, none a row label, the defaults among them", () => {
      const ids = cols.map((c) => c.id);
      assert.equal(new Set(ids).size, ids.length);
      assert.deepEqual(ids.filter((id) => LABELS.includes(id)), []);
      assert.deepEqual(ALTERATION_DEFAULT_COLUMNS[t].filter((id) => !ids.includes(id)), []);
      assert.equal(ids[0], "samples", "the portal's tables lead with the samples");
    });
    test(t + ": every column sorts (but those the portal does not sort), filters and lists its values in SQL", () => {
      for (const pin of ["v7.5", null]) {
        const src = alterationSource(t, part, "P-1", "db", pin, ["P-1-T01", "P-1-T02"]);
        for (const c of cols) {
          const filters = { [c.id]: c.numeric ? { min: 0 } : { op: "contains" as const, value: "x" } };
          // a column the portal does not sort (SV Status, PAT-SV-3) refuses a sort, naming it
          if (c.unsorted) assert.match(checkQuery({ sort: { column: c.id }, filters }, cols) || "", new RegExp(c.id + " is not sortable"));
          const q = c.unsorted ? { filters } : { sort: { column: c.id, desc: true }, filters };
          assert.equal(checkQuery(q, cols), null);
          const sql = pageSql(src, q, ALTERATION_DEFAULT_COLUMNS[t], 25, 0);
          assert.match(sql, /ORDER BY /);
          assert.match(valuesSql(src, {}, ALTERATION_DEFAULT_COLUMNS[t], c.id), c.numeric ? /min\(v\) AS lo/ : /GROUP BY v/);
        }
        assert.match(countsSql(src, {}, ALTERATION_DEFAULT_COLUMNS[t]), /GROUP BY cohort, study/);
      }
    });
  }
  test("one patient's rows only: every table reads the patient it is given", () => {
    for (const t of ALTERATION_TABLES) {
      const sql = alterationSource(t, part, "P-0024249", "db", "v7.5", []).with;
      assert.match(sql, /P-0024249/);
    }
    assert.match(alterationSource("mutations", part, "P-1", "db", null, []).with, /NOT LIKE '%uncalled%'/, "uncalled calls are left out, as the portal leaves them out");
    assert.match(alterationSource("cna", part, "P-1", "db", null, []).with, /abs\(cna_alteration\) >= 2/, "the deep calls only");
  });
  test("PAT-STM-2: a mutation with no keyword has no Cohort %, as the portal's variant counts give it none", () => {
    // coadread TCGA-A6-2671 CPD N210_D215del, BABAM2 X261_splice, ADAM32 X720_splice: no keyword, blank on the portal
    const sql = alterationSource("mutations", part, "P-1", "db", null, []).with;
    assert.match(sql, /ifNull\(keyword, ''\) AS kw/);
    assert.match(sql, /max\(kw\) AS kw/);
    assert.match(sql, /if\(g\.kw != '' AND ifNull\(fp\.n, 0\) > 0, 100 \* ifNull\(fa\.n, 0\) \/ fp\.n, NULL\) AS freq/);
    // what the Cohort cell draws: the gene's count, the keyword's, over the samples profiled
    assert.match(sql, /kc AS \(SELECT keyword AS kw, uniqExact\(sampleId\) AS n FROM db\.mutation_derived\n {2}WHERE .*molecularProfileId NOT LIKE '%uncalled%' AND keyword IN \(SELECT kw FROM g WHERE kw != ''\) GROUP BY kw\)/);
    assert.match(sql, /toUInt64\(ifNull\(fa\.n, 0\)\) AS cohortN, toUInt64\(ifNull\(kc\.n, 0\)\) AS cohortKwN, toUInt64\(ifNull\(fp\.n, 0\)\) AS cohortOf, g\.kw AS keyword/);
    assert.match(sql, /LEFT JOIN kc ON kc\.kw = g\.kw/);
    assert.match(alterationSource("cna", part, "P-1", "db", null, []).with, /toUInt64\(ifNull\(fa\.n, 0\)\) AS cohortN, toUInt64\(ifNull\(fp\.n, 0\)\) AS cohortOf/);
    // the denominator stays the samples profiled for the gene (invariant 7)
    assert.match(sql, /fp AS \(SELECT pg\.gene AS gene/);
  });
  test("PAT-GP-2: with panel coverage worked out, each row names the samples in view whose panels leave its gene out, A to Z; without, none", () => {
    for (const t of ["mutations", "cna"] as const) {
      const sql = alterationSource(t, part, "P-1", "db", null, [], "patient", { genes: "any", inAll: true }).with;
      assert.match(sql, /arraySort\(groupArrayIf\(replaceOne\(vs\.su, 'msk_chord_2024_', ''\), vs\.su NOT IN \(SELECT su FROM pan WHERE panel = 'WES'\) AND \(gg\.gene, vs\.su\) NOT IN \(SELECT gene, su FROM cov\)\)\) AS np/, t);
      assert.match(sql, /miss AS \(SELECT gene, length\(np\) AS n, np FROM/, t);
      assert.match(sql, /AS inAll, miss\.np AS notProfiled/, t);
      assert.match(alterationSource(t, part, "P-1", "db", null, []).with, /AS inAll, CAST\(\[\] AS Array\(String\)\) AS notProfiled/, t);
      // PAT-GP-2: the Gene panel values, each sample's panel in sample order (one a sample, WES left out: N/A), asked for with panels
      const gp = alterationSource(t, part, "P-1", "db", null, ["P-1-T03", "P-1-T01"], "patient", { genes: "any", inAll: true, panels: true }).with;
      assert.match(gp, /spn AS \(SELECT CAST\(\(groupArray\(s\), groupArray\(sp\)\), 'Map\(String, String\)'\) AS m FROM \(\n {2}SELECT replaceOne\(su, 'msk_chord_2024_', ''\) AS s, min\(panel\) AS sp FROM pan WHERE panel != 'WES' GROUP BY s\)\)/, t);
      const seq = "arrayConcat\\(\\['P-1-T03', 'P-1-T01'\\], arrayFilter\\(s -> NOT has\\(\\['P-1-T03', 'P-1-T01'\\], s\\), arrayDistinct\\(arrayConcat\\(splitByString\\(', ', g\\.samples\\), miss\\.np\\)\\)\\)\\)";
      const list = (keep: string) => "arrayStringConcat\\(arrayMap\\(s -> if\\(mapContains\\(spn\\.m, s\\), spn\\.m\\[s\\], 'N\\/A'\\), arrayFilter\\(s -> " + keep + ", " + seq + "\\)\\), ', '\\)";
      // the column's value is the portal's download: carrying samples profiled for the gene; the cell adds the unprofiled
      assert.match(gp, new RegExp(list("has\\(splitByString\\(', ', g\\.samples\\), s\\) AND NOT has\\(miss\\.np, s\\)") + " AS genePanel, "), t);
      assert.match(gp, new RegExp(list("has\\(splitByString\\(', ', g\\.samples\\), s\\) OR has\\(miss\\.np, s\\)") + " AS genePanelShown"), t);
      assert.match(gp, /CROSS JOIN spn/, t);
      const bare = alterationSource(t, part, "P-1", "db", null, [], "patient", { genes: "any", inAll: true }).with;
      assert.match(bare, /'' AS genePanel, '' AS genePanelShown/, t + ": coverage without panels, no panels");
      assert.doesNotMatch(bare, /spn/, t);
    }
  });
  test("PAT-GP-2: the SV table's Gene panel column, as the portal's (StructuralVariantTableWrapper genePanelProps): each sample's structural-variant panel, site 1's gene deciding whether it was profiled", () => {
    const sv = alterationSource("sv", part, "P-1", "db", null, ["P-1-T03", "P-1-T01"], "patient", { genes: "any", inAll: false, panels: true }).with;
    assert.match(sv, /alteration_type = 'STRUCTURAL_VARIANT'/);
    assert.match(sv, /max\(tumorReadCount\) AS tumorReadCount, gene1 AS gene\n/, "site 1's gene, as the portal's data[0].entrezGeneId = site1EntrezGeneId");
    assert.match(sv, /AS genePanel, /); assert.match(sv, /AS genePanelShown FROM g LEFT JOIN miss ON miss\.gene = g\.gene CROSS JOIN spn\)/);
    const bare = alterationSource("sv", part, "P-1", "db", null, []).with;
    assert.match(bare, /'' AS genePanel, '' AS genePanelShown FROM g\)/, "not asked for, not worked out");
    assert.doesNotMatch(bare, /sample_to_gene_panel_derived|gene1 AS gene/);
  });
  test("samples: \"cohort\" reads only the cohort's samples, in every table and in the patient list's counts", () => {
    const inCohort = /IN \(SELECT sid FROM ck\)/;
    for (const t of ALTERATION_TABLES) {
      assert.doesNotMatch(alterationSource(t, part, "P-1", "db", null, []).with, /SELECT sid FROM/, t + ": every sample by default");
      const sql = alterationSource(t, part, "P-1", "db", "v7.5", [], "cohort").with;
      assert.match(sql, /ck AS \(SELECT 'P-1' AS pid\)/, t + ": the cohort is a CTE");
      assert.match(sql, inCohort, t);
    }
    // the mutations table's Copy # column reads the same samples as its rows, and so does its gene-panel check (genes profiled in all samples) when it is asked
    assert.equal(alterationSource("mutations", part, "P-1", "db", null, [], "cohort").with.match(/IN \(SELECT sid FROM ck\)/g)!.length, 2);
    assert.equal(alterationSource("mutations", part, "P-1", "db", null, [], "cohort", { genes: "any", inAll: true }).with.match(/IN \(SELECT sid FROM ck\)/g)!.length, 3);
    assert.match(patientSamplesSource(part, "P-1", "db", "cohort").with, /\) WHERE id IN \(SELECT sid FROM ck\)/);
    assert.doesNotMatch(patientSamplesSource(part, "P-1", "db").with, /SELECT sid FROM/);
    const list = alterationPatientRowSource([{ ...part, source: "here" }], "db", "cohort").with;
    assert.equal(list.match(/IN \(SELECT sid FROM c0\)/g)!.length, 4, "samples, mutations, copy number and structural variants all counted over the cohort's samples");
    assert.doesNotMatch(alterationPatientRowSource([{ ...part, source: "here" }], "db").with, /SELECT sid FROM/);
  });
  test("with no sort a gene's rows sit together, then follow the patient's sample order", () => {
    const order = ["P-1-T03", "P-1-T01"];
    for (const t of ["mutations", "cna"] as const) {
      const src = alterationSource(t, part, "P-1", "db", null, order);
      assert.match(src.defaultOrder, /^gdrv DESC, gene, so\b/, "genes with a driver first, a gene's rows together, then by sample");
      assert.match(src.with, /max\(drv\) OVER \(PARTITION BY gene\) AS gdrv/);
    }
    assert.match(alterationSource("sv", part, "P-1", "db", null, order).defaultOrder, /^gene1, so\b/);
    // the Samples column lists them in that order too, not by id
    assert.match(alterationSource("mutations", part, "P-1", "db", null, order).with, /arraySort\(x -> if\(indexOf\(\['P-1-T03', 'P-1-T01'\], x\)/);
  });
  test("OncoKB joins only when a version is pinned, by protein change or by AMPLIFICATION / DELETION", () => {
    assert.doesNotMatch(alterationSource("mutations", part, "P-1", "db", null, []).with, /annotation\.oncokb/);
    assert.match(alterationSource("mutations", part, "P-1", "db", "v7.5", []).with, /alteration_type = 'MUTATION'[\s\S]*ann\.alteration = g\.proteinChange/);
    assert.match(alterationSource("cna", part, "P-1", "db", "v7.5", []).with, /alteration_type = 'CNA'[\s\S]*'AMPLIFICATION', 'DELETION'/);
  });
});

describe("the alterations view's patient list", () => {
  test("its columns, and a rank for prev / next in the same order as its pages", () => {
    const ids = ALTERATION_PATIENT_COLUMNS.map((c) => c.id);
    assert.deepEqual(ALTERATION_PATIENT_DEFAULT_COLUMNS.filter((id) => !ids.includes(id)), []);
    const src = alterationPatientRowSource([{ ...part, source: "this portal (test)" }], "db");
    assert.match(pageSql(src, {}, ALTERATION_PATIENT_DEFAULT_COLUMNS, 25, 0), /'this portal \(test\)' AS source/, "each part names the instance that holds it: the Source column");
    const q = { sort: { column: "sv", desc: true } };
    const order = (sql: string) => /ORDER BY ([^\n)]*)/.exec(sql)![1];
    assert.equal(order(rankSql(src, q, ALTERATION_PATIENT_DEFAULT_COLUMNS, part.study, "P-1")), order(pageSql(src, q, ALTERATION_PATIENT_DEFAULT_COLUMNS, 25, 0)));
  });
  test("refuses an empty list of parts", () => {
    assert.throws(() => alterationPatientRowSource([], "db"), /at least one part/);
  });
});
