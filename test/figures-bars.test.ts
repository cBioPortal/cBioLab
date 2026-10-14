// Layout rules of the bar, cancer-type, genome and lollipop figures: escaping once, nothing past
// the scale without a mark, nothing dropped, laid out at the width asked for.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { viewToSvg } from "../lib/view-svg.ts";
import { chromLabels } from "../lib/figures/genome.ts";
import { textWidth } from "../lib/chart/text.ts";
import { FS } from "../lib/chart/style.ts";
import type { ViewResult, CompareCell } from "../lib/types.ts";

const vb = (svg: string) => Number(/viewBox="0 0 (\d+)/.exec(svg)![1]);
const cell = (cohort: string, pct: number | null): CompareCell => ({ cohort, profiled: 100, any: pct ?? 0, driver: 0, anyPct: pct, driverPct: null,
  byType: { mutation: { profiled: 100, altered: 0 }, cna: { profiled: 100, altered: 0 }, structuralVariant: { profiled: 100, altered: 0 } } });

describe("compare", () => {
  const v: ViewResult = { kind: "compare", cohorts: ["A & B", "C"], rows: [{ gene: "KRAS", cells: [cell("A & B", 12.5), cell("C", null)], qAny: 0.01 }], note: "n" };
  test("a cohort name is escaped once, in a legend, and an unprofiled pair says so", () => {
    const svg = viewToSvg(v)!;
    assert.ok(svg.includes("A &amp; B") && !svg.includes("&amp;amp;"));
    assert.ok(svg.includes(">12.5%<") && svg.includes(">not profiled<"));
    assert.match(svg, /1 cohort–gene pair was not profiled/);
  });
  test("past six cohorts a colour is not repeated alone: the seventh is a tint", () => {
    const names = Array.from({ length: 7 }, (_, i) => "c" + i);
    const svg = viewToSvg({ kind: "compare", cohorts: names, rows: [{ gene: "TP53", cells: names.map((n) => cell(n, 10)) }] })!;
    assert.match(svg, /fill="#0072B2" opacity="0\.75"/);
  });
});

describe("clinical", () => {
  const v: ViewResult = { kind: "clinical", cohorts: ["A", "B"], note: "tests",
    clinical: [{ attribute: "AGE", per: "patient", kind: "num", cells: [], test: "Welch t", q: 0 },
      { attribute: "SEX", per: "patient", kind: "cat", cells: [], test: "chi-squared", q: 0.2 },
      { attribute: "RARE", per: "patient", kind: "cat", cells: [], skipped: "one value only" }] };
  test("a q past the axis ends in an arrow and the caption says so; an untested attribute is listed with why", () => {
    const svg = viewToSvg(v)!;
    assert.ok(svg.includes("q &lt; 1e-300") && svg.includes("1 bar runs past the axis"));
    assert.ok(svg.includes("not tested: one value only"));
  });
});

describe("cancertypes", () => {
  const grp = (i: number) => ({ key: "g" + i, label: "Group number " + i, samples: 100, profiled: 100, altered: 50 - (i % 40), mutation: 50 - (i % 40), amp: 0, homdel: 0, sv: 0, multiple: 0 });
  const v = (n: number): ViewResult => ({ kind: "cancertypes", cohorts: ["all"], cancertypes: { groupBy: "CANCER_TYPE", measure: "any", genes: ["KRAS"], minSamples: 10, show: "frequency", unit: "sample",
    panels: [{ cohort: "all", samples: 100 * n, profiled: 100 * n, altered: 10, groups: Array.from({ length: n }, (_, i) => grp(i)) }] } });
  test("a few groups fit the width asked for; a hundred grow it and scroll rather than squeeze", () => {
    const few = viewToSvg(v(10), { width: 900 })!;
    assert.equal(vb(few), 900);
    assert.ok(!few.includes("min-width"));
    const many = viewToSvg(v(110), { width: 900 })!;
    assert.ok(vb(many) > 900 && /min-width:\d+px/.test(many));
    assert.ok(many.includes("Group number 109"), "every group is named");
  });
});

describe("genome chromosome labels", () => {
  test("names every chromosome, dropping a crowded one to a second row rather than overprinting", () => {
    const chrom = ["19", "20", "21", "22", "X"].map((c, i) => ({ c, mid: 100 + i * 9 }));
    const { svg, height } = chromLabels(chrom, 0, "#000");
    for (const c of chrom) assert.ok(svg.includes(">" + c.c + "<"));
    assert.ok(height > FS.small + 6, "two rows");
    const boxes = [...svg.matchAll(/x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]+)</g)].map((m) => ({ x: +m[1], y: +m[2], w: textWidth(m[3], FS.small) }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.y === b.y) assert.ok(Math.abs(a.x - b.x) >= (a.w + b.w) / 2, "no two labels in a row touch");
    }
  });
});

describe("lollipop at the width it is given", () => {
  test("the plot fills the width, and the y axis has more than its ends", () => {
    const g = { gene: "G", mutated: 9, mutations: 9, positions: [{ pos: 50, n: 37, color: "#008000", impact: "missense", driver: true, changes: [{ change: "X50Y", n: 37, rows: 37 }] }],
      domains: [], proteinLength: 1068, lengthSource: "genome-nexus", unpositioned: 0, withheld: 0, label: { pos: 50, text: "X50Y" }, topChanges: [],
      somaticSamples: 9, cohortSamples: 90, tally: { missense: { driver: 9, vus: 0 }, truncating: { driver: 0, vus: 0 }, inframe: { driver: 0, vus: 0 }, splice: { driver: 0, vus: 0 }, fusion: { driver: 0, vus: 0 }, other: { driver: 0, vus: 0 } } };
    const svg = viewToSvg({ kind: "hotspots", cohorts: ["A"], hotspots: [g] } as any, { width: 1300 })!;
    assert.equal(vb(svg), 1300);
    assert.ok(svg.includes(">1,068aa<"));
    assert.ok((svg.match(/>(10|20|30)<\/text>/g) || []).length >= 2, "round ticks between 0 and the top");
  });
});
