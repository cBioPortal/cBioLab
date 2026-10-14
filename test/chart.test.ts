// The figures' shared layout layer (lib/chart/): measured text, number formats, ticks, axes, legends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { textWidth, ellipsize, wrapWidth, label } from "../lib/chart/text.ts";
import { fmtNum, fmtPct, fmtP, pDigits, fmtInt, tickFormat } from "../lib/chart/format.ts";
import { linear, log, symlog } from "../lib/chart/scale.ts";
import { axisBottom, bandLabels, leftAxisWidth } from "../lib/chart/axis.ts";
import { legend } from "../lib/chart/legend.ts";
import { seriesStyle, textOn } from "../lib/chart/style.ts";

const pal = { ink: "#000", muted: "#666", line: "#ccc" };

test("text is measured from the font's own advance widths", () => {
  // Plex Sans digits are tabular, 600/1000 em
  assert.equal(textWidth("0123456789", 10), 60);
  assert.ok(textWidth("WWW", 10) > textWidth("iii", 10) * 2);
  assert.ok(textWidth("Breast", 11, 600) > textWidth("Breast", 11));
});

test("a shortened label fits its room and keeps its full text as a tooltip", () => {
  const s = "Non-Small Cell Lung Cancer";
  const cut = ellipsize(s, 60, 10);
  assert.ok(cut.endsWith("…") && textWidth(cut, 10) <= 60, cut);
  assert.equal(ellipsize(s, 1000, 10), s);
  const t = label(0, 0, s, { size: 10, fill: "#000", maxW: 60 });
  assert.match(t, /<title>Non-Small Cell Lung Cancer<\/title>/);
  assert.doesNotMatch(label(0, 0, s, { size: 10, fill: "#000", maxW: 1000 }), /<title>/);
  assert.match(label(0, 0, "A & <B>", { size: 10, fill: "#000" }), /A &amp; &lt;B&gt;/);
});

test("wrapping measures every line against the width", () => {
  const lines = wrapWidth("the quick brown fox jumps over the lazy dog ".repeat(8), 200, 10);
  assert.ok(lines.length > 3);
  for (const l of lines) assert.ok(textWidth(l, 10) <= 200, l);
  for (const l of wrapWidth("Supercalifragilisticexpialidocious-and-then-some-more-words", 80, 10)) assert.ok(textWidth(l, 10) <= 80);
});

test("one rule per kind of number", () => {
  assert.equal(fmtNum(44.85), "44.9");
  assert.equal(fmtNum(0.000123), "0.000123");
  assert.equal(fmtNum(1234567), "1,234,567");
  assert.equal(fmtNum(-3.5), "−3.5");
  assert.equal(fmtNum(1.2e-7), "1.2e-7");
  assert.equal(fmtInt(6322), "6,322");
  assert.equal(fmtPct(5), "5.0%");
  assert.equal(fmtPct(15.66), "15.7%");
  assert.equal(fmtPct(0.04), "<0.1%");
  assert.equal(fmtPct(0), "0%");
  assert.equal(pDigits(0.5), "0.50");
  assert.equal(pDigits(0.012), "0.012");
  assert.equal(pDigits(0.00012), "1.2e-4");
  assert.equal(pDigits(0), "<1e-300");
  assert.equal(fmtP(0), "p < 1e-300");
  assert.equal(fmtP(0.0034), "p = 0.0034");
  assert.equal(tickFormat(0.2)(0.4), "0.4");
  assert.equal(tickFormat(0.05)(0.1), "0.10");
  assert.equal(tickFormat(2000)(10000), "10,000");
});

test("linear ticks are round steps; log ticks are powers of ten", () => {
  const s = linear(-1, 90.69, 0, 100);
  assert.deepEqual(s.ticks, [-20, 0, 20, 40, 60, 80, 100]);
  assert.equal(s.domain[0], -20);
  const l = log(3, 9000, 0, 100);
  assert.deepEqual(l.ticks, [1, 10, 100, 1000, 10000]);
  const short = log(1.5, 40, 0, 100);
  assert.ok(short.ticks.includes(2) && short.ticks.includes(5) && short.ticks.includes(20));
  const sl = symlog(0, 760, 0, 100);
  assert.deepEqual(sl.ticks, [0, 1, 10, 100, 1000]);
});

test("a bottom axis never overprints or runs off the figure", () => {
  const s = linear(0, 120, 46, 708, { nice: false, count: 50 });
  const svg = axisBottom(s, 200, pal, { minX: 0, maxX: 720 });
  const xs = [...svg.matchAll(/<text x="([\d.]+)"[^>]*>([^<]+)<\/text>/g)].map((m) => ({ x: Number(m[1]), t: m[2] }));
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i].x >= xs[i - 1].x + textWidth(xs[i - 1].t, 10) + 6, JSON.stringify(xs));
  const last = xs[xs.length - 1];
  assert.ok(last.x + textWidth(last.t, 10) <= 720);
  assert.ok(leftAxisWidth(linear(0, 1e6, 0, 100), "count") > leftAxisWidth(linear(0, 1, 0, 100)));
});

test("category labels go flat when they fit and turn when they do not", () => {
  const flat = bandLabels(["A", "B"], [10, 30], 20, 0, pal);
  assert.doesNotMatch(flat.svg, /rotate/);
  const turned = bandLabels(["Non-Small Cell Lung Cancer", "Breast"], [10, 30], 20, 0, pal, { maxH: 60 });
  assert.match(turned.svg, /rotate\(-45/);
  assert.ok(turned.height <= 60 + 20);
});

test("legend entries wrap at the width and every series keeps a swatch", () => {
  const items = Array.from({ length: 15 }, (_, i) => ({ label: "Cohort number " + i, color: seriesStyle(i).color, kind: "line" as const, dash: seriesStyle(i).dash }));
  const l = legend(items, 0, 0, 400, pal);
  assert.equal((l.svg.match(/<line /g) || []).length, 15);
  assert.ok(l.height > 40);
  assert.equal(seriesStyle(0).dash, "");
  assert.notEqual(seriesStyle(6).dash, "");
  assert.equal(seriesStyle(6).color, seriesStyle(0).color);
});

test("text on a fill takes the ink that contrasts", () => {
  assert.equal(textOn("#0072B2"), "#ffffff");
  assert.equal(textOn("#E69F00"), "#16232b");
  assert.equal(textOn("#f0f0f0"), "#16232b");
});
