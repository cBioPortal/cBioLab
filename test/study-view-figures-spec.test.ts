// Written from docs/legacy-spec/parity/download-cases.md, "SVG and PDF (FG)" (one test per row
// these pure functions cover, named by its id) and the legacy source each row cites
// (~/cbioportal-frontend at cd8c6df), without reference to the implementation.
// Covered elsewhere, not here (UI / browser):
//   FG1  which charts offer SVG and PDF, and in what order in the Download submenu
//   FG4  the PDF: the same figure as vectors, one page the figure's size, landscape when wide
//   FG8  density figure with its colour legend and correlation lines
//   FG9  survival KM figure with its legend
//   FG10 selection colouring (the file is the chart as this page draws it)
// FG6 (a table chart saves as the pie of its values) is wiring; pieFigureSvg is checked here for
// a table-sized list of values.
// Pie legend counts are written as plain integers, no thousands separators: the portal's legend
// is `${data.count}` (PieChart.tsx:269), not a formatted count.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chartFileName } from "../lib/study-view-download.ts";
import { pieFigureSvg, barFigureSvg, type PieSlice, type FigureBar } from "../lib/study-view-figures.ts";

// ---- a tiny, strict XML reader (no DOM in node, no parser in devDependencies) ----

interface El { name: string; attrs: Record<string, string>; children: (El | string)[]; parent: El | null }

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const BAD_AMP = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;
const decode = (s: string) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (_, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITY[e]);

/** parses the whole text as one XML document, throwing on anything malformed; returns the root */
function parseXml(xml: string): El {
  const tok = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/y;
  const doc: El = { name: "#doc", attrs: {}, children: [], parent: null };
  let cur = doc;
  let m: RegExpExecArray | null;
  while (tok.lastIndex < xml.length) {
    const at = tok.lastIndex;
    m = tok.exec(xml);
    if (!m) throw new Error(`malformed XML at ${at}: ${JSON.stringify(xml.slice(at, at + 40))}`);
    const [, cdata, close, open, attrText, selfClose, text] = m;
    if (cdata !== undefined) cur.children.push(cdata);
    else if (close) {
      if (cur.name !== close) throw new Error(`</${close}> closes <${cur.name}>`);
      cur = cur.parent!;
    } else if (open) {
      const attrs: Record<string, string> = {};
      for (const a of attrText.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        const v = a[2] ?? a[3];
        if (a[1] in attrs) throw new Error(`duplicate attribute ${a[1]}`);
        if (v.includes("<") || BAD_AMP.test(v)) throw new Error(`unescaped attribute ${a[1]}=${v}`);
        attrs[a[1]] = decode(v);
      }
      if (cur === doc && doc.children.some(c => typeof c !== "string")) throw new Error("two root elements");
      const el: El = { name: open, attrs, children: [], parent: cur };
      cur.children.push(el);
      if (!selfClose) cur = el;
    } else if (text !== undefined) {
      if (BAD_AMP.test(text)) throw new Error(`unescaped & in ${JSON.stringify(text)}`);
      if (cur === doc && text.trim()) throw new Error("text outside the root");
      cur.children.push(decode(text));
    }
  }
  if (cur !== doc) throw new Error(`<${cur.name}> never closed`);
  const roots = doc.children.filter((c): c is El => typeof c !== "string");
  assert.equal(roots.length, 1, "one root element");
  roots[0].parent = null;
  return roots[0];
}

const all = (el: El): El[] => [el, ...el.children.flatMap(c => typeof c === "string" ? [] : all(c))];
const byName = (root: El, name: string) => all(root).filter(e => e.name === name);
const textOf = (el: El): string => el.children.map(c => typeof c === "string" ? c : textOf(c)).join("");
/** an inheritable presentation property, from the attribute or style, on the element or its nearest ancestor */
function prop(el: El | null, key: string): string | undefined {
  for (let e = el; e; e = e.parent) {
    const st = new RegExp(`(?:^|;)\\s*${key}\\s*:\\s*([^;]+)`).exec(e.attrs.style ?? "");
    const v = st?.[1] ?? e.attrs[key];
    if (v !== undefined) return v.trim().toLowerCase();
  }
  return undefined;
}
/** x/y translation of the element by its ancestors' translate(...) transforms */
function offset(el: El): [number, number] {
  let x = 0, y = 0;
  for (let e = el.parent; e; e = e.parent) {
    const t = /translate\(\s*([-\d.e]+)(?:[\s,]+([-\d.e]+))?\s*\)/.exec(e.attrs.transform ?? "");
    if (t) { x += Number(t[1]); y += Number(t[2] ?? 0); }
  }
  return [x, y];
}
const texts = (root: El) => byName(root, "text").map(t => textOf(t).trim());
const num = (s: string | undefined) => Number(s);

/** FG3: the checks every standalone SVG file passes; returns the root */
function standalone(svg: string): El {
  assert.doesNotMatch(svg, /NaN|Infinity|undefined/, "no NaN/Infinity/undefined anywhere");
  const root = parseXml(svg);
  assert.equal(root.name, "svg");
  assert.equal(root.attrs.xmlns, "http://www.w3.org/2000/svg");
  for (const k of ["width", "height"] as const) {
    assert.match(root.attrs[k] ?? "", /^\d+(\.\d+)?$/, `${k} is a plain number`);
    assert.ok(num(root.attrs[k]) > 0, `${k} > 0`);
  }
  const vb = (root.attrs.viewBox ?? "").trim().split(/[\s,]+/).map(Number);
  assert.equal(vb.length, 4, "viewBox has four numbers");
  assert.deepEqual(vb.slice(2), [num(root.attrs.width), num(root.attrs.height)], "viewBox matches width and height");
  assert.equal(byName(root, "style").length, 0, "no stylesheet");
  for (const t of byName(root, "text")) assert.ok(prop(t, "font-family"), `text "${textOf(t)}" carries its font`);
  return root;
}

const filledWith = (root: El, color: string, names = ["path", "circle", "rect", "polygon", "ellipse"]) =>
  all(root).filter(e => names.includes(e.name) && prop(e, "fill") === color.toLowerCase());

// ---- FG2. File names ----

test("FG2: spaces and tabs become _, then .svg / .pdf", () => {
  assert.equal(chartFileName("Cancer Type Detailed", "svg"), "Cancer_Type_Detailed.svg");
  assert.equal(chartFileName("Cancer Type Detailed", "pdf"), "Cancer_Type_Detailed.pdf");
  assert.equal(chartFileName("A\tB  C ", "svg"), "A_B__C_.svg");
  assert.equal(chartFileName("TP53: Mutations & (x)", "pdf"), "TP53:_Mutations_&_(x).pdf");
});

// ---- FG3 / FG5. Pie ----

const s = (value: string, count: number, color: string): PieSlice => ({ value, count, color });
const THREE = [s("Male", 1, "#2986e2"), s("Female", 2, "#dc3912")];

test("FG3: a pie figure is a standalone SVG document", () => {
  standalone(pieFigureSvg("Sex", THREE));
});

test("FG5: every slice is drawn filled with its colour, and has a swatch of it in the legend", () => {
  const root = standalone(pieFigureSvg("Sex", THREE));
  for (const sl of THREE) {
    assert.ok(filledWith(root, sl.color, ["path", "circle"]).length >= 1, `a slice path for ${sl.value}`);
    assert.ok(filledWith(root, sl.color).length >= 2, `slice + swatch for ${sl.value}`);
  }
});

test("FG5: a single 100% slice is still drawn (path or circle) in its colour", () => {
  const root = standalone(pieFigureSvg("Sex", [s("Male", 7, "#2986e2")]));
  assert.ok(filledWith(root, "#2986E2", ["path", "circle"]).length >= 1);
  assert.ok(texts(root).includes("Male: 7 (100.0%)"));
});

test("FG5: the title, then one legend entry per slice, '<value>: <count> (<share>)', in the given order", () => {
  const t = texts(standalone(pieFigureSvg("Sex", THREE)));
  const iTitle = t.indexOf("Sex"), iM = t.indexOf("Male: 1 (33.3%)"), iF = t.indexOf("Female: 2 (66.7%)");
  assert.ok(iTitle >= 0, "title present");
  assert.ok(iM >= 0 && iF >= 0, `legend entries present in ${JSON.stringify(t)}`);
  assert.ok(iTitle < iM && iM < iF, "title first, then slices in the given order (not sorted)");
});

test("FG5: the given order is kept even when it is not by count", () => {
  const t = texts(standalone(pieFigureSvg("X", [s("b", 5, "#111111"), s("a", 1, "#222222"), s("c", 9, "#333333")])));
  const idx = ["b: 5 (33.3%)", "a: 1 (6.7%)", "c: 9 (60.0%)"].map(x => t.indexOf(x));
  assert.ok(idx.every(i => i >= 0), JSON.stringify(t));
  assert.deepEqual([...idx].sort((p, q) => p - q), idx);
});

test("FG5: shares as portalFreq writes them", () => {
  const t = texts(standalone(pieFigureSvg("X", [
    s("big", 1998, "#111111"), s("tiny", 1, "#222222"), s("zero", 0, "#333333"), s("one", 1, "#444444")])));
  for (const e of ["big: 1998 (99.9%)", "tiny: 1 (<0.1%)", "zero: 0 (0%)", "one: 1 (<0.1%)"])
    assert.ok(t.includes(e), `${e} in ${JSON.stringify(t)}`);
  const t2 = texts(standalone(pieFigureSvg("X", [s("a", 999, "#111111"), s("b", 1, "#222222")])));
  assert.ok(t2.includes("a: 999 (99.9%)") && t2.includes("b: 1 (0.1%)"), JSON.stringify(t2));
});

test("FG5: counts are written plainly, no thousands separator (PieChart.tsx:269)", () => {
  const t = texts(standalone(pieFigureSvg("X", [s("a", 12345, "#111111"), s("b", 12345, "#222222")])));
  assert.ok(t.includes("a: 12345 (50.0%)"), JSON.stringify(t));
});

test("FG5: the value is written as stored, &, <, \" escaped in the file", () => {
  const v = 'R&D <x> "q"';
  const svg = pieFigureSvg('T&C <1>', [s(v, 1, "#111111")]);
  assert.ok(svg.includes("&amp;") && svg.includes("&lt;"), "entities in the raw text");
  assert.ok(!svg.includes("<x>") && !svg.includes("<1>"), "no raw markup from a value");
  const t = texts(standalone(svg));
  assert.ok(t.includes("T&C <1>"), "title decodes back");
  assert.ok(t.includes(`${v}: 1 (100.0%)`), "value decodes back as stored");
});

test("FG5: the wider legend sets the width; a longer value never makes the figure narrower", () => {
  const w = (value: string) => num(standalone(pieFigureSvg("T", [s(value, 1, "#111111")])).attrs.width);
  const short = w("A"), long = w("A".repeat(10) + " very long category value that cannot fit under a pie");
  assert.ok(long > short, `long legend ${long} wider than short ${short}`);
});

test("FG5/FG6: a table-sized list of values: every value in the legend, legend below so the figure grows taller", () => {
  const many = Array.from({ length: 25 }, (_, i) => s(`v${i}`, i + 1, `#${(0x100000 + i * 4099).toString(16)}`));
  const root = standalone(pieFigureSvg("Tbl", many));
  const t = texts(root);
  const idx = many.map(x => t.findIndex(y => y.startsWith(`${x.value}: ${x.count} (`)));
  assert.ok(idx.every(i => i >= 0), JSON.stringify(t));
  assert.deepEqual([...idx].sort((p, q) => p - q), idx);
  const h2 = num(standalone(pieFigureSvg("Tbl", many.slice(0, 2))).attrs.height);
  assert.ok(num(root.attrs.height) > h2);
});

test("FG3/FG5: degenerate pies are still valid SVG with no NaN", () => {
  standalone(pieFigureSvg("Empty", []));
  standalone(pieFigureSvg("Zeros", [s("a", 0, "#111111"), s("b", 0, "#222222")]));
  standalone(pieFigureSvg("", [s("a", 1, "#111111")]));
});

// ---- FG3 / FG7. Bar ----

const b = (count: number, tick: string, na?: boolean): FigureBar => (na ? { count, tick, na } : { count, tick });
const WHITE = new Set(["none", "white", "#fff", "#ffffff", "transparent"]);
/** the bars: rects with a visible fill, left to right (no other filled rect belongs in a bar figure) */
function barRects(root: El) {
  return byName(root, "rect")
    .filter(r => !WHITE.has(prop(r, "fill") ?? "none") && num(r.attrs.height) > 0)
    .map(r => {
      const [dx, dy] = offset(r);
      return { x: dx + num(r.attrs.x ?? 0), y: dy + num(r.attrs.y ?? 0), h: num(r.attrs.height), fill: prop(r, "fill")! };
    })
    .sort((p, q) => p.x - q.x);
}
const BARS = [b(10, "0"), b(40, "10"), b(20, "20"), b(5, "30")];

test("FG3: a bar figure is a standalone SVG document", () => {
  standalone(barFigureSvg(BARS));
  standalone(barFigureSvg(BARS, { width: 400, height: 250 }));
});

test("FG7: one bar per entry, heights count ÷ the largest count, on one baseline", () => {
  const r = barRects(standalone(barFigureSvg(BARS, { width: 400, height: 250 })));
  assert.equal(r.length, BARS.length);
  const plot = Math.max(...r.map(x => x.h));
  BARS.forEach((bar, i) => assert.ok(Math.abs(r[i].h - plot * bar.count / 40) < 0.6, `bar ${i}: ${r[i].h} vs ${plot * bar.count / 40}`));
  const base = r[0].y + r[0].h;
  for (const x of r) assert.ok(Math.abs(x.y + x.h - base) < 0.6, "common baseline");
});

test("FG7: a 0 count and a tiny count still get 2% of the plot height", () => {
  const bars = [b(1000, "a"), b(0, "b"), b(1, "c"), b(50, "d")];
  const r = barRects(standalone(barFigureSvg(bars, { width: 400, height: 300 })));
  assert.equal(r.length, 4);
  const plot = r[0].h;
  assert.ok(Math.abs(r[1].h - plot * 0.02) < 0.6, `0 count: ${r[1].h} vs ${plot * 0.02}`);
  assert.ok(Math.abs(r[2].h - plot * 0.02) < 0.6, `tiny count: ${r[2].h} vs ${plot * 0.02}`);
  assert.ok(Math.abs(r[3].h - plot * 0.05) < 0.6, "5% stays 5%");
});

test("FG7: tick texts in bar order; an empty tick draws no text", () => {
  const bars = [b(1, "≤10"), b(2, ""), b(3, "20"), b(4, ""), b(5, ">30")];
  const root = standalone(barFigureSvg(bars));
  const t = texts(root);
  const idx = ["≤10", "20", ">30"].map(x => t.indexOf(x));
  assert.ok(idx.every(i => i >= 0), JSON.stringify(t));
  assert.deepEqual([...idx].sort((p, q) => p - q), idx);
  assert.ok(t.every(x => x !== ""), "no empty text element");
});

test("FG7: the NA bar is drawn like any other bar: the same fill, with its tick", () => {
  const bars = [b(3, "1"), b(6, "2"), b(4, "NA", true)];
  const root = standalone(barFigureSvg(bars));
  const r = barRects(root);
  assert.equal(r.length, 3);
  assert.equal(r[0].fill, r[1].fill, "the non-NA bars share a fill");
  assert.equal(r[2].fill, r[0].fill, "the NA bar has the bars' colour, as on the page (BarChart.tsx:351-361)");
  assert.ok(texts(root).includes("NA"), "the NA bar's tick is drawn");
});

test("FG7: naNote is written when given, not otherwise", () => {
  assert.ok(texts(standalone(barFigureSvg(BARS, { naNote: "NA 37" }))).includes("NA 37"));
  assert.ok(!texts(standalone(barFigureSvg(BARS))).some(x => x.includes("NA")));
});

test("FG7: no legend — every text is a tick, the NA note, or an axis number", () => {
  const ticks = new Set(BARS.map(x => x.tick));
  for (const x of texts(standalone(barFigureSvg(BARS, { naNote: "NA 3" }))))
    assert.ok(ticks.has(x) || x === "NA 3" || /^[\d,.]+$/.test(x), `unexpected text ${JSON.stringify(x)}`);
});

test("FG7: tick labels are escaped", () => {
  const svg = barFigureSvg([b(1, "<5 & up"), b(2, "x")]);
  assert.ok(svg.includes("&lt;5 &amp; up"));
  assert.ok(texts(standalone(svg)).includes("<5 & up"));
});

test("FG3/FG7: degenerate histograms are still valid SVG with no NaN", () => {
  const zeros = barRects(standalone(barFigureSvg([b(0, "a"), b(0, "b"), b(0, "c")])));
  assert.equal(zeros.length, 3);
  assert.ok(zeros.every(x => x.h > 0 && Math.abs(x.h - zeros[0].h) < 1e-9), "all-zero bars all at the minimum");
  assert.equal(barRects(standalone(barFigureSvg([b(7, "only")]))).length, 1);
  assert.equal(barRects(standalone(barFigureSvg([b(0, "NA", true)]))).length, 1);
  standalone(barFigureSvg([]));
});
