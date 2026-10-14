// Layout rules of the sequence, attrition, overlap and pathways figures: what each does when its
// input is larger than the width it is given — wraps, pools with a disclosure, or labels what fits
// and says how many it did not — rather than running past the frame or overprinting.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { viewToSvg } from "../lib/view-svg.ts";
import { placeLabels } from "../lib/figures/sequence.ts";
import { attritionColumns, clauseLines } from "../lib/figures/attrition.ts";
import { upsetColumns, UPSET_MIN_COL } from "../lib/figures/overlap.ts";
import { packLines } from "../lib/chart/text.ts";
import { tileLines } from "../lib/figures/pathways.ts";
import { textWidth, FS } from "../lib/svg-kit.ts";
import type { ViewResult } from "../lib/types.ts";

const viewBoxW = (svg: string) => Number(/viewBox="0 0 (\d+)/.exec(svg)![1]);

describe("sequence", () => {
  test("labels never overlap, the biggest node is labelled first, and a crowded one is left out", () => {
    const at = placeLabels([{ y: 0, h: 100 }, { y: 106, h: 1 }, { y: 108, h: 1 }, { y: 110, h: 1 }, { y: 200, h: 40 }]);
    assert.equal(at[0], 50);
    assert.equal(at[4], 220);
    const placed = at.filter((c): c is number => c != null).sort((a, b) => a - b);
    for (let i = 1; i < placed.length; i++) assert.ok(placed[i] - placed[i - 1] >= FS.small + 2, "labels clear each other");
    assert.ok(at.slice(1, 4).some((c) => c == null), "three 1px nodes 2px apart cannot all be labelled");
  });

  const regimens = Array.from({ length: 14 }, (_, i) => "Regimen " + i);
  const v: ViewResult = { kind: "sequence", cohorts: ["A"], caveat: "Lines of therapy.",
    sequence: { labelKey: "SUBTYPE", lineGap: 90, steps: 2, foldedLabels: 9, truncated: false, panels: [{
      cohort: "A", started: 1000, censored: 400,
      nodes: [...regimens.map((l, i) => ({ column: 1, label: l, n: 200 - i * 14, kind: "regimen" as const })),
        { column: 1, label: "other", n: 30, kind: "regimen" as const },
        { column: 2, label: "Regimen 0", n: 300, kind: "regimen" as const },
        { column: 2, label: "", n: 200, kind: "stopped" as const }, { column: 2, label: "", n: 400, kind: "censored" as const }],
      flows: regimens.map((l, i) => ({ column: 1, from: l, to: "", n: 200 - i * 14, kind: "censored" as const })) }] } } as ViewResult;

  test("the key has every regimen the engine kept, 'other' with what it pools, and both endings", () => {
    const svg = viewToSvg(v, { width: 900 })!;
    for (const r of regimens) assert.ok(svg.includes(">" + r + "<"), r + " is in the key");
    assert.match(svg, /9 less common regimens/);
    assert.match(svg, /watched, none started/);
    assert.match(svg, /nothing can be concluded/);
  });

  test("past six regimens a colour returns lighter, never as an exact repeat", () => {
    const svg = viewToSvg(v, { width: 900 })!;
    const swatches = [...svg.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="10" height="10" rx="2" fill="(#[0-9A-Fa-f]{6})"( opacity="([\d.]+)")?/g)]
      .map((m) => m[1] + "@" + (m[3] || "1"));
    assert.equal(new Set(swatches).size, swatches.length, "every key swatch differs: " + swatches.join(" "));
  });

  test("the caption says how many nodes are not labelled, and every node names itself on hover", () => {
    const svg = viewToSvg(v, { width: 900 })!;
    const nodes = (svg.match(/width="13" height="[\d.]+" rx="2"/g) || []).length;
    const m = /(\d+) of (\d+) nodes are too small to label/.exec(svg);
    if (m) assert.equal(Number(m[2]), nodes);
    assert.equal((svg.match(/<title>[^<]*\(line \d\)<\/title><\/rect>/g) || []).length, nodes);
  });

  test("columns spread across the width given", () => {
    const xs = (w: number) => Math.max(...[...viewToSvg(v, { width: w })!.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="13"/g)].map((m) => +m[1]));
    assert.ok(xs(1400) > xs(800) + 400, "the second column moves out with the width");
  });
});

describe("attrition", () => {
  test("as many columns as fit at a readable width, each no wider than a box should be", () => {
    assert.deepEqual(attritionColumns(5, 1340).perRow, 5);
    assert.equal(attritionColumns(5, 930).perRow, 4);
    assert.ok(attritionColumns(2, 1340).col <= 340);
    assert.equal(attritionColumns(1, 100).col, 200);
  });
  test("a long clause wraps to the box and past four lines is cut, saying so", () => {
    const short = clauseLines("OQL[TP53: MUT]", 180);
    assert.deepEqual(short, { lines: ["OQL[TP53: MUT]"], cut: false });
    const long = clauseLines("CANCER_TYPE in [" + Array.from({ length: 30 }, (_, i) => "Cancer type " + i).join(", ") + "]", 180);
    assert.equal(long.lines.length, 4);
    assert.ok(long.cut && long.lines[3].endsWith("…"));
    for (const l of long.lines) assert.ok(textWidth(l, FS.body) <= 180, l);
  });
});

describe("overlap", () => {
  const sets = ["A", "B", "C", "D", "E", "F"].map((name, i) => ({ name, size: 1000 - i * 50 }));
  const inter: { members: string[]; n: number }[] = [];
  for (let m = 1; m < 64; m++) inter.push({ members: sets.filter((_, i) => m & (1 << i)).map((s) => s.name), n: 64 - m });
  inter.sort((a, b) => b.n - a.n);
  const v: ViewResult = { kind: "overlap", cohorts: sets.map((s) => s.name), caveat: "c",
    overlap: { union: 3000, sets, intersections: inter } };

  test("columns never narrower than the minimum; the rest pooled into one", () => {
    const all = upsetColumns(63, 63 * UPSET_MIN_COL);
    assert.deepEqual([all.shown, all.pooled], [63, false]);
    const some = upsetColumns(63, 40 * UPSET_MIN_COL);
    assert.deepEqual([some.shown, some.pooled, some.cols], [39, true, 40]);
    assert.ok(some.pitch >= UPSET_MIN_COL);
  });

  test("63 combinations at a narrow width: the rest are pooled and the caption says how many and how large", () => {
    const svg = viewToSvg(v, { width: 700 })!;
    assert.equal(viewBoxW(svg), 700);
    assert.match(svg, /\+\d+ more/);
    assert.match(svg, /are pooled in the last, grey column \([\d,]+ patients/);
    assert.match(svg, /63 non-empty combinations of 63/);
  });

  test("at a width that holds them, every combination is drawn on its own", () => {
    const svg = viewToSvg(v, { width: 1500 })!;
    assert.doesNotMatch(svg, /pooled/);
  });

  test("items too small to label pack into lines, whole, within the width", () => {
    const lines = packLines(["A ∩ B: 12", "A ∩ C: 1,234", "B ∩ C: 5", "A ∩ B ∩ C: 9"], 90, FS.small);
    assert.ok(lines.length > 1);
    assert.equal(lines.join(" · ").split(" · ").length, 4, "no item is split across lines");
  });
});

describe("pathways", () => {
  test("tiles wrap onto a further line when the next would pass the room", () => {
    assert.deepEqual(tileLines([80, 80, 80, 80], 260), [0, 0, 0, 1]);
    assert.deepEqual(tileLines([80, 80, 120], 280), [0, 0, 1]);
  });

  const cell = (cohort: string, pct: number) => ({ cohort, profiled: 1000, altered: pct * 10, pct });
  const cohorts = ["A", "B", "C", "D"];
  const v: ViewResult = { kind: "pathways", cohorts, caveat: "c", pathways: { measure: "driver", rows: [{
    name: "RTK-RAS", source: "Sanchez-Vega 2018", genes: 85, profiledGenes: 58, cells: cohorts.map((c) => cell(c, 30.2)),
    top: Array.from({ length: 12 }, (_, i) => ({ gene: "GENE" + i, role: "OG" as const, cells: cohorts.map((c, ci) => cell(c, 30 - i - ci)) })),
    otherAltered: 33, notProfiled: Array.from({ length: 27 }, (_, i) => "X" + i) }] } };

  test("at a narrow width nothing passes the frame, and the pooled members are still counted", () => {
    const svg = viewToSvg(v, { width: 700 })!;
    const W = viewBoxW(svg);
    assert.equal(W, 700);
    for (const m of svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)) assert.ok(+m[1] + +m[2] <= W + 0.5, "rect at " + m[1]);
    assert.ok(svg.includes("+33 more altered") && svg.includes("27 never profiled"));
  });

  test("each cohort's percentage in a tile is its own text, never run together with the next", () => {
    const svg = viewToSvg(v, { width: 1200 })!;
    assert.ok(svg.includes(">30.0%<") && svg.includes(">29.0%<") && svg.includes(">28.0%<") && svg.includes(">27.0%<"));
    assert.doesNotMatch(svg, /%\d/);
  });
});
