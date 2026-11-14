// Written from docs/legacy-spec/parity/binner-cases.md (one test per row, named by its id) and the
// legacy source it cites, without reference to the implementation.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { dataBins, recountBins, type BinInput, type BinSettings } from "../lib/data-binner.ts";
import { looksLogarithmic, logScaleOffered, binEdges, parseEdges, parseGenerate } from "../lib/study-view-bins.ts";
import { INITIAL_BIN_EDGES, chartBinSettings } from "../lib/study-view-config.ts";
import type { NumericBin } from "../lib/types.ts";

// ---- helpers ----

/** the integers a..b, one sample each */
const ints = (a: number, b: number): BinInput[] => {
  const out: BinInput[] = [];
  for (let i = a; i <= b; i++) out.push({ value: String(i), count: 1 });
  return out;
};
const v = (value: string | number, count = 1): BinInput => ({ value: String(value), count });

/** a compact text form of a bar list: `≤5:5 (5,10]:5 7:1 >15:5 Unknown:3` */
const fmt = (bins: NumericBin[]): string =>
  bins
    .map((b) => {
      if (b.value !== undefined) return `${b.value}:${b.count}`;
      if (b.special === "<=") return `≤${b.end}:${b.count}`;
      if (b.special === ">") return `>${b.start}:${b.count}`;
      if (b.start === b.end) return `${b.start}:${b.count}`;
      return `(${b.start},${b.end}]:${b.count}`;
    })
    .join(" ");

/** asserts both the full bar objects and (for a readable failure) their compact form */
const bars = (actual: NumericBin[], expected: NumericBin[]) => {
  assert.equal(fmt(actual), fmt(expected));
  assert.deepEqual(actual, expected);
};

// bar constructors
const le = (end: number, count: number): NumericBin => ({ special: "<=", end, count });
const gt = (start: number, count: number): NumericBin => ({ special: ">", start, count });
const iv = (start: number, end: number, count: number): NumericBin => ({ start, end, count });
const one = (x: number, count: number): NumericBin => ({ start: x, end: x, count });
const word = (value: string, count: number): NumericBin => ({ value, count });

const median: BinSettings = { bins: { method: "median" } };
const quartile: BinSettings = { bins: { method: "quartile" } };
const custom = (edges: number[]): BinSettings => ({ bins: { method: "custom", edges } });
const generate = (size: number, anchor: number): BinSettings => ({ bins: { method: "generate", size, anchor } });

/** 1..30 with recorded bounds "<3" × 2 and ">25" × 3 (M5, C8, C9) */
const bounded = (): BinInput[] => [...ints(1, 30), v("<3", 2), v(">25", 3)];

/** 0, 100, 200, … 3000: box range above 1000 (L1–L3) */
const wide = (): BinInput[] => {
  const out: BinInput[] = [];
  for (let x = 0; x <= 3000; x += 100) out.push(v(x));
  return out;
};

const interior = (bins: NumericBin[]) =>
  bins.filter((b) => b.value === undefined && b.special === undefined && b.start !== b.end);

// ---- The order a chart's bars are decided in ----

describe("order of decision", () => {
  test("D1 10 distinct values: one bar per value, the method is ignored", () => {
    const expected = Array.from({ length: 10 }, (_, i) => one(i + 1, 1));
    for (const s of [median, quartile, custom([5])]) bars(dataBins(ints(1, 10), undefined, s), expected);
  });

  test("D2 11 distinct values: the median split applies", () => {
    bars(dataBins(ints(1, 11), undefined, median), [le(6, 6), gt(6, 5)]);
  });

  test("D3 no numeric values: no bars", () => {
    for (const s of [undefined, median, quartile, custom([5]), generate(5, 0)]) {
      bars(dataBins([], undefined, s), []);
    }
  });

  test("D4 bins absent or null: the default bars", () => {
    const def = dataBins(ints(1, 20));
    assert.ok(def.length > 0);
    bars(dataBins(ints(1, 20), undefined, {}), def);
    bars(dataBins(ints(1, 20), undefined, { bins: null }), def);
  });

  test("D5 disableLog with a box range ≤ 1000 changes nothing", () => {
    bars(dataBins(ints(1, 20), undefined, { disableLog: true }), dataBins(ints(1, 20)));
  });
});

// ---- Median split ----

describe("median split", () => {
  test("M1 n even: median is the mean of the middle two", () => {
    bars(dataBins(ints(1, 20), undefined, median), [le(10.5, 10), gt(10.5, 10)]);
  });

  test("M2 n odd: the middle value goes to ≤", () => {
    bars(dataBins(ints(1, 21), undefined, median), [le(11, 11), gt(11, 10)]);
  });

  test("M3 1..10 and 11 × 10 samples", () => {
    bars(dataBins([...ints(1, 10), v(11, 10)], undefined, median), [le(10.5, 10), one(11, 10)]);
  });

  test("M4 repeats weigh in the median", () => {
    bars(dataBins([...ints(1, 15), v(1, 10)], undefined, median), [le(3, 13), gt(3, 12)]);
  });

  test("M5 the median overrides recorded bounds", () => {
    bars(dataBins(bounded(), undefined, median), [le(15.5, 17), gt(15.5, 18)]);
  });
});

// ---- Quartiles ----

describe("quartiles", () => {
  test("Q1 1..20", () => {
    bars(dataBins(ints(1, 20), undefined, quartile), [le(5.5, 5), iv(5.5, 10.5, 5), iv(10.5, 15.5, 5), gt(15.5, 5)]);
  });

  test("Q2 1..21: odd n skips the middle", () => {
    bars(dataBins(ints(1, 21), undefined, quartile), [le(5.5, 5), iv(5.5, 11, 6), iv(11, 16.5, 5), gt(16.5, 5)]);
  });

  test("Q3 equal Q2 and Q3: the one bar of 20 becomes a value bar", () => {
    bars(dataBins([...ints(1, 10), v(20, 30)], undefined, quartile), [le(15, 10), one(20, 30)]);
  });

  test("Q4 all quartiles equal: falls back to the median split", () => {
    bars(dataBins([...ints(1, 4), v(5, 50), ...ints(6, 12)], undefined, quartile), [le(5, 54), gt(5, 7)]);
  });

  test("Q5 all quartiles equal the maximum: median fallback, the empty >11 bar is not drawn", () => {
    bars(dataBins([...ints(1, 10), v(11, 40)], undefined, quartile), [le(11, 50)]);
  });
});

// ---- Custom bins ----

describe("custom bins", () => {
  test("C1 edges [5, 10, 15]", () => {
    bars(dataBins(ints(1, 20), undefined, custom([5, 10, 15])), [le(5, 5), iv(5, 10, 5), iv(10, 15, 5), gt(15, 5)]);
  });

  test("C2 one edge splits in two", () => {
    bars(dataBins(ints(1, 20), undefined, custom([10])), [le(10, 10), gt(10, 10)]);
  });

  test("C3 edges typed out of order: the box sorts them", () => {
    const p = parseEdges("15, 5, 10");
    assert.ok("edges" in p && p.edges);
    assert.deepEqual(p.edges, [5, 10, 15]);
    bars(dataBins(ints(1, 20), undefined, custom(p.edges)), [le(5, 5), iv(5, 10, 5), iv(10, 15, 5), gt(15, 5)]);
  });

  test("C4 an edge on the maximum: no empty >20 bar", () => {
    bars(dataBins(ints(1, 20), undefined, custom([10, 20])), [le(10, 10), iv(10, 20, 10)]);
  });

  test("C5 edges all below the data: the empty bar is trimmed", () => {
    bars(dataBins(ints(1, 20), undefined, custom([-10, -5])), [gt(-5, 20)]);
  });

  test("C6 edges all above the data: the trailing empty bar is trimmed", () => {
    bars(dataBins(ints(1, 20), undefined, custom([100, 200])), [le(100, 20)]);
  });

  test("C7 non-integer edges kept as typed", () => {
    bars(dataBins(ints(1, 20), undefined, custom([2.5, 7.5, 12.5])), [
      le(2.5, 2),
      iv(2.5, 7.5, 5),
      iv(7.5, 12.5, 5),
      gt(12.5, 8),
    ]);
  });

  test("C8 edges outside recorded bounds are replaced by the bounds", () => {
    bars(dataBins(bounded(), undefined, custom([1, 5, 10, 28])), [
      le(3, 5),
      iv(3, 5, 2),
      iv(5, 10, 5),
      iv(10, 25, 15),
      gt(25, 8),
    ]);
  });

  test("C9 a single edge below the lower bound becomes the bound", () => {
    bars(dataBins(bounded(), undefined, custom([1])), [le(3, 5), gt(3, 30)]);
  });

  test("C10 2.0E-4 is a number", () => {
    bars(dataBins([...ints(1, 11), v("2.0E-4")], undefined, custom([5])), [le(5, 6), gt(5, 6)]);
  });

  test("C11 ⚠ an edge typed twice counts once", () => {
    bars(dataBins(ints(1, 20), undefined, custom([5, 5, 10])), [le(5, 5), iv(5, 10, 5), gt(10, 10)]);
  });
});

// ---- Generate bins ----

describe("generate bins", () => {
  const g2 = [le(3, 3), iv(3, 8, 5), iv(8, 13, 5), iv(13, 18, 5), gt(18, 2)];

  test("G1 size 5, anchor 0", () => {
    bars(dataBins(ints(1, 20), undefined, generate(5, 0)), [le(5, 5), iv(5, 10, 5), iv(10, 15, 5), gt(15, 5)]);
  });

  test("G2 size 5, anchor 3", () => {
    bars(dataBins(ints(1, 20), undefined, generate(5, 3)), g2);
  });

  test("G3 anchor above the data: as G2", () => {
    bars(dataBins(ints(1, 20), undefined, generate(5, 103)), g2);
  });

  test("G4 anchor below the data: as G2", () => {
    bars(dataBins(ints(1, 20), undefined, generate(5, -7)), g2);
  });

  test("G5 one generated edge is not a split: 1:1 only", () => {
    bars(dataBins(ints(1, 20), undefined, generate(10, 0)), [one(1, 1)]);
  });

  test("G6 no edge below the maximum: 1:1 only", () => {
    bars(dataBins(ints(1, 20), undefined, generate(100, 0)), [one(1, 1)]);
  });

  test("G7 size 2.5, anchor 0", () => {
    bars(dataBins(ints(1, 20), undefined, generate(2.5, 0)), [
      le(2.5, 2),
      iv(2.5, 5, 3),
      iv(5, 7.5, 2),
      iv(7.5, 10, 3),
      iv(10, 12.5, 2),
      iv(12.5, 15, 3),
      iv(15, 17.5, 2),
      gt(17.5, 3),
    ]);
  });
});

// ---- Log scale ----

describe("log scale", () => {
  /** floor(10^(k/2)) for k = 0..12: 1, 3, 10, 31, 100, 316, 1000, 3162, … */
  const halfSteps = new Set(Array.from({ length: 13 }, (_, k) => Math.floor(10 ** (k / 2))));

  test("L1 box range above 1000: log bars on powers of ten in half steps", () => {
    const b = dataBins(wide());
    const inner = interior(b);
    assert.ok(inner.length >= 3, fmt(b));
    for (const bar of inner) {
      for (const e of [bar.start!, bar.end!]) {
        assert.ok(e === 0 || halfSteps.has(e), `edge ${e} not a half-step power of ten: ${fmt(b)}`);
      }
    }
    assert.equal(b.reduce((s, x) => s + x.count, 0), 31);
  });

  test("L2 disableLog: linear bars, every interior bar the same width", () => {
    const b = dataBins(wide(), undefined, { disableLog: true });
    const inner = interior(b);
    assert.ok(inner.length >= 2, fmt(b));
    const widths = new Set(inner.map((x) => x.end! - x.start!));
    assert.equal(widths.size, 1, fmt(b));
    assert.equal(b.reduce((s, x) => s + x.count, 0), 31);
  });

  test("L3 disableLog with a method: the method decides", () => {
    const expected = [le(1500, 16), gt(1500, 15)];
    bars(dataBins(wide(), undefined, { bins: { method: "median" }, disableLog: true }), expected);
    bars(dataBins(wide(), undefined, median), expected);
  });
});

// ---- STATIC: bars laid out once, counted again ----

describe("recount", () => {
  test("S1 a bar the selection empties stays, at 0", () => {
    bars(recountBins(dataBins(ints(1, 20), undefined, median), ints(1, 5)), [le(10.5, 5), gt(10.5, 0)]);
  });

  test("S2 a recorded >25 goes to the upper bar", () => {
    const laid = dataBins(ints(1, 20), undefined, custom([5, 10, 15]));
    bars(recountBins(laid, [v(12), v(13), v(">25")]), [le(5, 0), iv(5, 10, 0), iv(10, 15, 2), gt(15, 1)]);
  });
});

// ---- Words and NA ----

describe("words and NA", () => {
  test("W1 words are one bar, case aside, first spelling", () => {
    bars(dataBins([...ints(1, 20), v("Unknown", 2), v("unknown", 1)], undefined, median), [
      le(10.5, 10),
      gt(10.5, 10),
      word("Unknown", 3),
    ]);
  });

  test("W2 ⚠ NA spellings are never a bar", () => {
    bars(dataBins([...ints(1, 20), v("NA"), v("nan"), v("N/A")], undefined, custom([10])), [le(10, 10), gt(10, 10)]);
  });

  test("W3 a range written as text is a word bar", () => {
    bars(dataBins([...ints(1, 20), v("9-10")], undefined, median), [le(10.5, 10), gt(10.5, 10), word("9-10", 1)]);
  });
});

// ---- Spellings of one value ----

describe("spellings", () => {
  test("V1 ⚠ 1 and 1.0 are one value", () => {
    bars(dataBins([v("1", 2), v("1.0", 3), ...ints(2, 9)]), [one(1, 5), ...Array.from({ length: 8 }, (_, i) => one(i + 2, 1))]);
  });

  test("V2 a value compares by its number", () => {
    const vals = ints(1, 20).map((x) => (x.value === "5" ? v("5.0") : x));
    bars(dataBins(vals, undefined, median), [le(10.5, 10), gt(10.5, 10)]);
  });
});

// ---- The chart menu ----

describe("chart menu", () => {
  const notLog = [iv(50, 100, 4)];

  test("F1 (0,1], (1,3], (3,10], (10,31] is log-looking", () => {
    const b = [iv(0, 1, 1), iv(1, 3, 1), iv(3, 10, 1), iv(10, 31, 1)];
    assert.equal(looksLogarithmic(b), true);
    assert.equal(logScaleOffered(b, undefined), true);
  });

  test("F2 (50, 100] is not log-looking", () => {
    assert.equal(looksLogarithmic(notLog), false);
    assert.equal(logScaleOffered(notLog, undefined), false);
  });

  test("F3 (10, 32] is log-looking", () => {
    assert.equal(looksLogarithmic([iv(10, 32, 1)]), true);
  });

  test("F4 (0.1, 1] is not log-looking", () => {
    assert.equal(looksLogarithmic([iv(0.1, 1, 1)]), false);
  });

  test("F5 value bars only: not log-looking", () => {
    assert.equal(looksLogarithmic([one(1, 3), one(10, 2)]), false);
  });

  test("F6 outlier bars are left out", () => {
    assert.equal(looksLogarithmic([le(10, 1), iv(10, 100, 1), gt(100, 1)]), true);
  });

  test("F7 no bars: not log-looking", () => {
    assert.equal(looksLogarithmic([]), false);
    assert.equal(looksLogarithmic(undefined), false);
    assert.equal(logScaleOffered(undefined, undefined), false);
  });

  test("F8 Log Scale switched off stays offered", () => {
    assert.equal(logScaleOffered(notLog, { disableLog: true }), true);
  });

  test("F9 custom box start: every numeric edge once, words left out", () => {
    const b = [le(35, 1), iv(35, 40, 1), iv(40, 45, 1), iv(45, 50, 1), gt(50, 1), word("Unknown", 1)];
    assert.deepEqual(binEdges(b), [35, 40, 45, 50]);
  });

  test("F10 ⚠ custom box start keeps an edge at 0", () => {
    assert.deepEqual(binEdges([le(0, 1), iv(0, 10, 1), iv(10, 20, 1)]), [0, 10, 20]);
  });

  test("F11 box text is sorted", () => {
    assert.deepEqual(parseEdges("60, 40, 80.5"), { edges: [40, 60, 80.5] });
  });

  test("F12 box empty or blank: the default bars", () => {
    assert.deepEqual(parseEdges(""), { edges: null });
    assert.deepEqual(parseEdges("   "), { edges: null });
  });

  test("F13 ⚠ a blank between commas is skipped", () => {
    assert.deepEqual(parseEdges("40, , 60"), { edges: [40, 60] });
  });

  test("F14 a non-number is refused, naming it", () => {
    const p = parseEdges("40, x, 60");
    assert.ok("why" in p, JSON.stringify(p));
    assert.match(p.why, /x/);
  });

  test("F15 1e3 is 1000", () => {
    assert.deepEqual(parseEdges("1e3"), { edges: [1000] });
  });

  test("F16 ⚠ Infinity and 0x10 are refused", () => {
    for (const t of ["Infinity", "0x10"]) {
      const p = parseEdges(t);
      assert.ok("why" in p, `${t}: ${JSON.stringify(p)}`);
    }
  });

  test("F17 ⚠ generate size 0 or negative is refused", () => {
    for (const size of ["0", "-5"]) {
      const p = parseGenerate(size, "0");
      assert.ok("why" in p, `${size}: ${JSON.stringify(p)}`);
    }
  });

  test("F18 generate with an empty anchor: anchor 0", () => {
    assert.deepEqual(parseGenerate("5", ""), { bins: { method: "generate", size: 5, anchor: 0 } });
  });

  test("F19 MSI attributes start with custom edges", () => {
    const cases: [string, number[]][] = [
      ["MSI_SCORE", [4, 10]],
      ["MSI_SENSOR_SCORE", [4, 10]],
      ["MSI_SCORE_MANTIS", [0.4, 0.6]],
    ];
    for (const [attr, edges] of cases) {
      assert.deepEqual(INITIAL_BIN_EDGES[attr], edges);
      assert.deepEqual(chartBinSettings(undefined, attr)?.bins, { method: "custom", edges });
      assert.deepEqual(chartBinSettings({}, attr)?.bins, { method: "custom", edges });
    }
  });

  test("F20 MSI_SCORE reset with bins null: the default bars", () => {
    const s = chartBinSettings({ MSI_SCORE: { bins: null } }, "MSI_SCORE");
    assert.equal(s?.bins, null);
    bars(dataBins(ints(1, 20), undefined, s), dataBins(ints(1, 20)));
  });

  test("F21 MSI_SCORE with disableLog only keeps the initial edges", () => {
    const s = chartBinSettings({ MSI_SCORE: { disableLog: true } }, "MSI_SCORE");
    assert.deepEqual(s?.bins, { method: "custom", edges: [4, 10] });
    assert.equal(s?.disableLog, true);
  });

  test("F22 an attribute not in the initial list: no bins setting", () => {
    assert.equal(INITIAL_BIN_EDGES["AGE"], undefined);
    assert.equal(chartBinSettings(undefined, "AGE")?.bins, undefined);
  });

  test("F23 ⚠ a number past the largest is refused", () => {
    const p = parseEdges("1e400");
    assert.ok("why" in p, JSON.stringify(p));
  });

  test("F24 ⚠ generate size 0x10 or anchor Infinity is refused", () => {
    for (const [size, anchor] of [["0x10", "0"], ["5", "Infinity"]]) {
      const p = parseGenerate(size, anchor);
      assert.ok("why" in p, `${size}, ${anchor}: ${JSON.stringify(p)}`);
    }
  });
});
