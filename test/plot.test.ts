// The pure half of a plot: which shape a pair of axes draws as, what is refused, the box
// statistics, the correlation p-value, and the promise that no axis query returns a case id.
import test from "node:test";
import assert from "node:assert/strict";
import { axisKind, axisLabel, axisSelect, corrPValue, plotBinsSql, plotBoxSql, plotCountSql,
  plotShape, plotStatsSql, plotTableSql, plotPointsSql, plotViolinSql, categoryColor, isAbsent,
  tukey, validateAxis, CATEGORY_CAP, DEFAULT_BINS , coverageNote } from "../lib/plot.ts";
import { STYLE } from "../lib/oncoprint-style.ts";

const ctx = { study: "x", db: "db", unit: "sample" as const, cohortSql: "SELECT pid FROM p" };
const num = { source: "clinical" as const, attribute: "MUTATION_COUNT" };
const cat = { source: "clinical" as const, attribute: "CANCER_TYPE" };
const mol = { source: "molecular" as const, profileType: "rna_seq_mrna", gene: "TP53" };
const alt = { source: "alteration" as const, gene: "TP53", by: "mutationType" as const };

test("the axis pair decides the shape, as it does in the portal", () => {
  assert.equal(plotShape("num", "num"), "scatter");
  assert.equal(plotShape("cat", "cat"), "table");
  assert.equal(plotShape("num", "cat"), "box");
  assert.equal(plotShape("cat", "num"), "box");
  assert.equal(plotShape("none", "num"), "waterfall");
  assert.equal(plotShape("num", "none"), "waterfall");
});

test("only the study can say whether a clinical attribute is a number", () => {
  const kinds = (a: string) => a === "MUTATION_COUNT" ? "num" as const : a === "CANCER_TYPE" ? "cat" as const : undefined;
  assert.equal(axisKind(num, kinds), "num");
  assert.equal(axisKind(cat, kinds), "cat");
  assert.equal(axisKind(mol, kinds), "num", "a molecular profile value is always numeric");
  assert.equal(axisKind(alt, kinds), "cat", "an alteration is always a category");
  assert.throws(() => axisKind({ source: "clinical", attribute: "MADE_UP" }, kinds), /not declared by this study/);
});

test("an axis that would read a whole profile is refused by name", () => {
  // 630 million values live in one profile of this warehouse; a plot of "all genes" is not a plot
  assert.throws(() => validateAxis({ source: "molecular", profileType: "log2CNA" } as never, "x"),
    /needs one gene.*name the gene you mean/s);
  assert.throws(() => validateAxis({ source: "alteration" } as never, "y"), /needs a gene, a gene set, or an OQL query/);
  assert.throws(() => validateAxis({ source: "alateration", gene: "APC" } as never, "covariate 1"),
    /unknown source 'alateration' — use one of clinical, molecular, alteration, none/);
  assert.throws(() => validateAxis({ source: "clinical", attribute: "not a name!" }, "x"), /not a clinical attribute name/);
  assert.throws(() => validateAxis({ source: "alteration", gene: "TP53", by: "driver" } as never, "x"), /not supported yet/);
  validateAxis(num, "x");   // the ordinary cases do not throw
  validateAxis(mol, "y");
});

test("a gene-set alteration axis: any-of-N genes as one category, mutated only", () => {
  const geneSet = { source: "alteration" as const, genes: ["TP53", "KRAS", "APC"] };
  validateAxis(geneSet, "x");   // by defaults to "mutated" — does not throw
  validateAxis({ ...geneSet, by: "mutated" as const }, "x");
  assert.throws(() => validateAxis({ ...geneSet, by: "cna" } as never, "x"),
    /gene SET only supports by:"mutated"/);
  assert.throws(() => validateAxis({ ...geneSet, by: "mutationType" } as never, "x"),
    /gene SET only supports by:"mutated"/);
  assert.throws(() => validateAxis({ source: "alteration", genes: Array.from({ length: 21 }, (_, i) => "G" + i) } as never, "x"),
    /at most 20 genes; this asks for 21/);
  assert.throws(() => validateAxis({ source: "alteration", genes: ["TP53", "not a gene!"] } as never, "x"),
    /is not a valid gene symbol/);
});

test("a gene-set axis names itself by its genes, or by count once there are too many to list", () => {
  assert.equal(axisLabel({ source: "alteration", genes: ["TP53", "KRAS"] }), "TP53/KRAS (any) mutation status");
  assert.equal(axisLabel({ source: "alteration", genes: ["A", "B", "C", "D", "E", "F"] }), "6 genes (any) mutation status");
});

test("a gene-set axis compiles to hugo_gene_symbol IN (...), not a single =", () => {
  const sql = axisSelect({ source: "alteration", genes: ["TP53", "KRAS"] }, ctx, "cat");
  assert.match(sql, /hugo_gene_symbol IN \('TP53','KRAS'\)/);
  assert.doesNotMatch(sql, /hugo_gene_symbol = /);
});

test("an axis names itself the way the figure labels it", () => {
  assert.equal(axisLabel(num), "MUTATION_COUNT");
  assert.equal(axisLabel(mol), "TP53 rna_seq_mrna");
  assert.equal(axisLabel(alt), "TP53 mutation type");
  assert.equal(axisLabel({ source: "alteration", gene: "MDM2", by: "cna" }), "MDM2 copy number");
});

test("no plot query returns a case id: every one groups it away", () => {
  const x = axisSelect(num, ctx, "num"), y = axisSelect(cat, ctx, "cat");
  const queries = [plotCountSql(x, y, ctx.cohortSql, false), plotStatsSql(x, x, ctx.cohortSql),
    plotBinsSql(x, x, ctx.cohortSql), plotBoxSql(x, y, ctx.cohortSql), plotTableSql(y, y, ctx.cohortSql)];
  for (const sql of queries) {
    // the id exists inside, as the thing the two axes are joined on, and never survives to the
    // outermost projection — which is what makes a plot answerable by an aggregate-only site
    const outer = sql.slice(sql.lastIndexOf("SELECT "), sql.length).split(/\bFROM\b/)[0];
    assert.equal(/\bid\b/.test(outer), false, "an id reached the outer projection of: " + outer.slice(0, 90));
    assert.equal(/sample_unique_id|patient_unique_id/.test(outer), false, outer.slice(0, 90));
  }
});

test("the grid is what bounds a scatter, not the cohort", () => {
  const x = axisSelect(num, ctx, "num");
  const sql = plotBinsSql(x, x, ctx.cohortSql, [40, 30]);
  assert.match(sql, /least\(39,/);
  assert.match(sql, /least\(29,/);
  // a grid nobody could draw is clamped rather than accepted
  assert.match(plotBinsSql(x, x, ctx.cohortSql, [9999, 1]), /least\(599,/);
  assert.deepEqual(DEFAULT_BINS, [240, 160]);
});

test("a categorical axis is capped, because a truncated contingency table is a wrong one", () => {
  assert.equal(CATEGORY_CAP, 150);
  assert.match(plotBoxSql("a", "b", "c"), new RegExp("LIMIT " + (CATEGORY_CAP + 1)));
});

test("Tukey's fences reach the furthest value inside 1.5 x IQR", () => {
  // q1 10, q3 20, so the fences are at -5 and 35: the whiskers stop at the data
  assert.deepEqual(tukey(10, 20, 0, 30), { loWhisker: 0, hiWhisker: 30, iqr: 10 });
  // an outlier at 100 is beyond the fence, so the whisker stops at the fence
  assert.deepEqual(tukey(10, 20, 0, 100), { loWhisker: 0, hiWhisker: 35, iqr: 10 });
  assert.deepEqual(tukey(10, 20, -50, 30), { loWhisker: -5, hiWhisker: 30, iqr: 10 });
});

test("the correlation p-value is Student's t on n-2, as the portal's is", () => {
  // r = 0.5 over 100 cases is decisive; r = 0.05 over 30 is nothing
  assert.ok(corrPValue(0.5, 100)! < 1e-6);
  assert.ok(Math.abs(corrPValue(0.05, 30)! - 0.7930) < 0.001);
  assert.equal(corrPValue(1, 50), 0, "a perfect correlation has no p-value to compute");
  assert.equal(corrPValue(0.9, 2), null, "two points define a line and prove nothing");
  assert.equal(corrPValue(null, 100), null);
  assert.ok(Math.abs(corrPValue(0, 50)! - 1) < 1e-9);
});

test("sample mode and patient mode ask different questions of the same table", () => {
  const asSample = axisSelect(num, ctx, "num");
  const asPatient = axisSelect(num, { ...ctx, unit: "patient" }, "num");
  assert.match(asSample, /sample_unique_id/);
  assert.match(asPatient, /patient_unique_id/);
  // a numeric axis casts, a categorical one does not
  assert.match(asSample, /toFloat64OrNull/);
  assert.equal(/toFloat64OrNull/.test(axisSelect(cat, ctx, "cat")), false);
});

test("an alteration axis answers for every case in the cohort, not only the altered ones", () => {
  const sql = axisSelect(alt, ctx, "cat");
  assert.match(sql, /LEFT JOIN/, "a case with no mutation still has an answer: 'Not mutated'");
  assert.match(sql, /Not mutated/);
  assert.match(sql, /Multiple/, "a case with two classes is its own category rather than being picked between");
  assert.match(axisSelect({ source: "alteration", gene: "MDM2", by: "cna" }, ctx, "cat"), /Amplification|Deep deletion/);
});

test("a category takes the colour the oncoprint gives it, so the two figures agree", () => {
  // the mutation classes and copy-number states come from the shared style module
  assert.equal(categoryColor("Missense"), STYLE.glyph.mutation.priority.find((m) => /Missense/.test(m.label))!.color);
  assert.equal(categoryColor("Truncating"), STYLE.glyph.mutation.priority.find((m) => /Truncating/.test(m.label))!.color);
  assert.equal(categoryColor("Amplification"), STYLE.glyph.cna.options.find((o) => /Amplification/.test(o.label))!.color);
  // anything else cycles the shared categorical palette rather than inventing a colour
  assert.equal(categoryColor("Stage 4", 1), STYLE.palette.categorical[1]);
  // "nothing here" is neutral, and visible on white — the oncoprint's unaltered fill is not
  assert.equal(categoryColor("Not mutated"), STYLE.palette.groupLine);
  assert.notEqual(categoryColor("Not mutated"), STYLE.palette.unaltered);
});

test("absence is neutral and never a ring", () => {
  for (const l of ["Not mutated", "neutral", "No data", "wild type", "none", ""]) assert.equal(isAbsent(l), true, l);
  for (const l of ["Missense", "Amplification", "Multiple", "Stage 4"]) assert.equal(isAbsent(l), false, l);
});

test("colour reaches the query only when it was asked for", () => {
  const numSel = "SELECT 1 AS id, 1 AS v", catSel = "SELECT 1 AS id, 'g' AS v", colSel = "SELECT 1 AS id, 'c' AS v";
  const plain = plotPointsSql(numSel, catSel, "SELECT '' AS pid");
  assert.equal(/ AS c\b/.test(plain), false);
  const coloured = plotPointsSql(numSel, catSel, "SELECT '' AS pid", 100, colSel, colSel);
  assert.match(coloured, /cs\.v AS c/);
  assert.match(coloured, /rs\.v AS r/);
  assert.match(coloured, /LEFT JOIN/, "a case with no value for the colour is still a point");
  // the density gains a dimension, not a row per case
  assert.match(plotViolinSql(numSel, catSel, "SELECT '' AS pid", 40, colSel), /GROUP BY g, b, c/);
  // and it is cut over the middle 99%, so one outlier cannot put every value in one bin
  assert.match(plotViolinSql(numSel, catSel, "SELECT '' AS pid"), /quantileExact\(0\.005\)/);
});

test("a plot says how many cases the pair left out, and on which axis", () => {
  const d: any = { shape: "box", n: 145220, x: { label: "CANCER_TYPE", kind: "cat" }, y: { label: "FRACTION_GENOME_ALTERED", kind: "num" },
    coverage: { total: 289869, nx: 282755, ny: 151504 } };
  assert.equal(coverageNote(d, "sample"),
    "145,220 of 289,869 samples have a value on both axes (7,114 have no CANCER_TYPE; 138,365 have no FRACTION_GENOME_ALTERED); only those are drawn.");
  assert.equal(coverageNote({ ...d, n: 289869, coverage: { total: 289869, nx: 289869, ny: 289869 } }, "sample"), "", "nothing left out, nothing said");
  assert.equal(coverageNote({ ...d, coverage: undefined }, "patient"), "", "no coverage known, no claim made");
});

test("log: true reads log10(v + 1), leaves out what has no such log, and says so in the label", () => {
  const ctx = { study: "s", db: "db", unit: "sample" as const, cohortSql: "SELECT '' AS pid" };
  const clin = axisSelect({ source: "clinical", attribute: "MUTATION_COUNT", log: true }, ctx, "num");
  assert.match(clin, /if\(toFloat64OrNull\(attribute_value\) >= 0, log10\(toFloat64OrNull\(attribute_value\) \+ 1\), NULL\) IS NOT NULL/);
  assert.doesNotMatch(axisSelect({ source: "clinical", attribute: "MUTATION_COUNT" }, ctx, "num"), /log10/);
  const mol = axisSelect({ source: "molecular", profileType: "mrna", gene: "ESR1", log: true }, ctx, "num");
  assert.match(mol, /^SELECT id, v FROM \(/);
  assert.match(mol, /\) WHERE v IS NOT NULL$/);
  assert.equal(axisLabel({ source: "clinical", attribute: "MUTATION_COUNT", log: true }), "log10(MUTATION_COUNT + 1)");
  assert.equal(axisLabel({ source: "molecular", profileType: "mrna", gene: "ESR1", log: true }), "log10(ESR1 mrna + 1)");
});

test("an OQL axis: each case is Altered when it matches any entry, Unaltered otherwise", () => {
  const oql = { source: "alteration" as const, oql: "KRAS: G12C; STK11: MUT" };
  validateAxis(oql, "x");
  assert.equal(axisKind(oql), "cat");
  assert.equal(axisLabel(oql), "KRAS: G12C; STK11: MUT (OQL)");
  const sql = axisSelect(oql, ctx, "cat");
  // every case of the cohort is a row, so the unaltered are counted, not missing
  assert.match(sql, /FROM db\.sample_derived sd/);
  assert.match(sql, /'Altered', 'Unaltered'\) AS v/);
  assert.match(sql, /hugo_gene_symbol = 'KRAS'/);
  assert.match(sql, /hugo_gene_symbol = 'STK11'/);
});

test("an OQL axis matches samples in sample mode and patients in patient mode", () => {
  const oql = { source: "alteration" as const, oql: "TP53: TRUNC" };
  assert.match(axisSelect(oql, ctx, "cat"), /replaceOne\(g\.sample_unique_id/);
  assert.match(axisSelect(oql, { ...ctx, unit: "patient" }, "cat"), /replaceOne\(g\.patient_unique_id/);
});

test("an OQL axis is refused when its query is, and says which axis", () => {
  assert.throws(() => validateAxis({ source: "alteration", oql: "KRAS: GAIN" }, "y"), /^Error: y axis: OQL 'KRAS: GAIN': GAIN is not supported/);
  assert.throws(() => validateAxis({ source: "alteration", oql: "" }, "x"), /x axis: empty OQL/);
  assert.throws(() => validateAxis({ source: "alteration", oql: "KRAS", gene: "KRAS" } as never, "x"), /the query alone/);
  // DRIVER needs the pinned OncoKB store, as the cohort leaf does; with it, the join is there
  const drv = { source: "alteration" as const, oql: "KRAS: DRIVER" };
  assert.throws(() => axisSelect(drv, ctx, "cat"), /DRIVER requires the OncoKB annotation store/);
  assert.match(axisSelect(drv, { ...ctx, oncokbPin: "v7.4" }, "cat"), /oncokb_version = 'v7\.4'/);
});

test("unaltered is absence: neutral, and never a ring", () => {
  assert.equal(isAbsent("Unaltered"), true);
  assert.equal(isAbsent("Altered"), false);
});
