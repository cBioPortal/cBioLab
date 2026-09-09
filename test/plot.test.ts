// The pure half of a plot: which shape a pair of axes draws as, what is refused, the box
// statistics, the correlation p-value, and the promise that no axis query returns a case id.
import test from "node:test";
import assert from "node:assert/strict";
import { axisKind, axisLabel, axisSelect, corrPValue, plotBinsSql, plotBoxSql, plotCountSql,
  plotShape, plotStatsSql, plotTableSql, tukey, validateAxis, CATEGORY_CAP, DEFAULT_BINS } from "../lib/plot.ts";

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
  assert.throws(() => validateAxis({ source: "alteration" } as never, "y"), /needs one gene/);
  assert.throws(() => validateAxis({ source: "clinical", attribute: "not a name!" }, "x"), /not a clinical attribute name/);
  assert.throws(() => validateAxis({ source: "alteration", gene: "TP53", by: "driver" } as never, "x"), /not supported yet/);
  validateAxis(num, "x");   // the ordinary cases do not throw
  validateAxis(mol, "y");
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
