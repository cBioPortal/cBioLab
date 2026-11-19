// The Patient tables' Cohort cell (lib/views/alterations/cohort-cell.ts): the portal's FrequencyBar and
// its tooltips, with numbers read from cbioportal.org.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cohortBar, cohortTooltip } from "../lib/views/alterations/cohort-cell.ts";
import { STYLE } from "../lib/oncoprint-style.ts";

test("PAT-STM-2: a mutation's bar is the gene's share in light green with its keyword's in green, the percent beside it (coadread APC: 387 and 376 of 534)", () => {
  const c = { n: 387, of: 534, keyword: "APC truncating", keywordN: 376 };
  const b = cohortBar(c);
  assert.equal(b.text, "72%");
  assert.deepEqual(b.bars.map((r) => r.color), ["lightgreen", "green"]);
  assert.ok(Math.abs(b.bars[0].width - 30 * 387 / 534) < 1e-9 && Math.abs(b.bars[1].width - 30 * 376 / 534) < 1e-9);
  assert.equal(b.background, "#ccc");
  assert.deepEqual([b.width, b.height, b.barWidth, b.barHeight, b.top, b.textX, b.textY, b.fontSize], [71, 12, 30, 8, 2, 36, 9.5, 10]);
  assert.equal(cohortTooltip("APC", c), "387 samples (72%) in this study have mutated APC, out of which 376 (70%) have APC truncating mutations.");
});

test("PAT-STM-2: a row without a keyword draws the gene's share alone and says nothing of a keyword", () => {
  const c = { n: 4, of: 534 };
  assert.deepEqual(cohortBar(c).bars.map((r) => r.color), ["lightgreen"]);
  assert.equal(cohortBar(c).text, "<1%");
  assert.equal(cohortTooltip("X", c), "4 samples (<1%) in this study have mutated X.");
});

test("PAT-STM-3: a copy-number call's bar is red for AMP, blue for HOMDEL, with the CNA table's tooltip", () => {
  assert.deepEqual(cohortBar({ n: 27, of: 534 }, "AMP").bars.map((r) => r.color), ["red"]);
  assert.deepEqual(cohortBar({ n: 3, of: 534 }, "HOMDEL").bars.map((r) => r.color), ["blue"]);
  assert.equal(cohortTooltip("ANK1", { n: 27, of: 534 }, "AMP"), "27 samples (5%) in this study have amplified ANK1");
  assert.equal(cohortTooltip("PTEN", { n: 1, of: 534 }, "HOMDEL"), "1 sample (<1%) in this study has deleted PTEN");
  assert.equal(cohortBar({ n: 0, of: 0 }, "AMP").text, "0%");
});

test("a bar never runs past the grey, nor the keyword's past the gene's, though the percent says what the counts say", () => {
  const b = cohortBar({ n: 12, of: 10, keyword: "k", keywordN: 15 });
  assert.deepEqual(b.bars.map((r) => r.width), [30, 30]);
  assert.equal(b.text, "120%");
  assert.deepEqual(cohortBar({ n: 2, of: 10, keyword: "k", keywordN: 5 }).bars.map((r) => r.width), [6, 6]);
});

test("the bar's colours and sizes come from the style (invariant 8)", () => {
  const S = { ...STYLE, cohortBar: { ...STYLE.cohortBar, gene: "#111", keyword: "#222", width: 60 } };
  const b = cohortBar({ n: 1, of: 2, keyword: "k", keywordN: 1 }, undefined, S);
  assert.deepEqual(b.bars.map((r) => [r.color, r.width]), [["#111", 30], ["#222", 30]]);
});
