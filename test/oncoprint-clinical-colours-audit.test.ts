// Audit of PR #197 (OncoPrint clinical track colours) against the case table cited to legacy
// cbioportal-frontend cd8c6df. CDCU = src/shared/cache/ClinicalDataCacheUtils.ts, PU =
// src/shared/components/plots/PlotUtils.ts, COL = src/shared/lib/Colors.ts, OU/DU =
// src/shared/components/oncoprint/{OncoprintUtils,DataUtils}.ts, RS/LR = packages/oncoprintjs
// oncoprintruleset.ts / oncoprintlegendrenderer.ts, CDC = src/shared/cache/ClinicalDataCache.ts.
//
// The legacy rule is transcribed below as an oracle (reserved table + its key expansion, COL:24-150,
// and PlotUtils' makeUniqueColorGetter, PU:199-279), and each place that assigns or draws a
// categorical colour is checked against it: the style functions, the engine (assembleContract),
// the server SVG (contractToSvg) and the browser canvas (draw).
import test from "node:test";
import assert from "node:assert/strict";
import { STYLE, clinicalColor, reservedColor, trackCategoryColor, resolveStyle, barBand, encodeNumeric } from "../lib/oncoprint-style.ts";
import { assembleContract, normalizeDisplay, type AssembleInput } from "../lib/oncoprint-assemble.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";
import { draw, fitZoom, GEOM, type VisibleGroup } from "../app/_oncoprint/canvas.ts";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";
import type { Contract } from "../lib/types.ts";

// ---------- legacy oracle ----------

const YES = "#1b9e77", NO = "#d95f02", FEMALE = "#e0699e", MALE = "#2986e2", LIGHT_GREY = "#d3d3d3", DARK_GREY = "#a9a9a9", DEFAULT_GREY = "#bebebe";
// COL:51-124 (commons AlterationColors.ts for the mutation/CNA words), lower-cased hexes
const LEGACY_BASE: Record<string, string> = {
  true: YES, yes: YES, positive: YES, "disease free": YES, "tumor free": YES, living: YES, alive: YES, "not progressed": YES,
  false: NO, no: NO, negative: NO, recurred: NO, progressed: NO, "recurred/progressed": NO, "with tumor": NO, deceased: NO,
  female: FEMALE, f: FEMALE, male: MALE, m: MALE, other: DARK_GREY, unknown: LIGHT_GREY, na: LIGHT_GREY,
  missense: "#008000", inframe: "#993404", truncating: "#000000", fusion: "#8b00c9", splice: "#e5802b", promoter: "#00b7ce",
  driver: "#008000", vus: "#53d400",
  "1:deceased": NO, "1:recurred/progressed": NO, "1:recurred": NO, "1:progressed": NO, "1:yes": NO, "1:1": NO, "1:progression": NO,
  "1:event": NO, "1:dead of melanoma": NO, "1:dead with tumor": NO, "1:metastatic relapse": NO, "1:localized relapse": NO,
  "0:living": YES, "0:alive": YES, "0:diseasefree": YES, "0:no": YES, "0:0": YES, "0:progressionfree": YES, "0:no progression": YES,
  "0:not progressed": YES, "0:censored": YES, "0:censor": YES, "0:alive or censored": YES, "0:alive or dead tumor free": YES,
  "0:no relapse": YES, "0:progression free": YES, "0:censure": YES, "0:ned": YES,
  "wild type": DEFAULT_GREY, "no mutation": DEFAULT_GREY, amplification: "#ff0000", gain: "#ffb6c1", diploid: DEFAULT_GREY,
  unchanged: DEFAULT_GREY, loss: "#8fd8d8", "shallow deletion": "#8fd8d8", "deep deletion": "#0000ff"
};
// COL:131-150: the exact keys the OncoPrint path looks up with `in`
const LEGACY_RESERVED: Map<string, string> = (() => {
  const m = new Map(Object.entries(LEGACY_BASE));
  for (const [key, color] of Object.entries(LEGACY_BASE)) {
    m.set(key.toLowerCase(), color); m.set(key.toUpperCase(), color);
    const ws = key.replace(/\s/g, "");
    m.set(ws, color); m.set(ws.toLowerCase(), color); m.set(ws.toUpperCase(), color);
    m.set(key[0].toUpperCase() + key.slice(1).toLowerCase(), color);
    m.set(key.split(" ").map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" "), color);
  }
  return m;
})();
const D3 = ["#3366cc", "#dc3912", "#ff9900", "#109618", "#990099", "#0099c6", "#dd4477", "#66aa00", "#b82e2e", "#316395", "#994499",
  "#22aa99", "#aaaa11", "#6633cc", "#e67300", "#8b0707", "#651067", "#329262", "#5574a6", "#3b3eac", "#b77322", "#16d620", "#b91383",
  "#f4359e", "#9c5935", "#a9c413", "#2a778d", "#668d1c", "#bea413", "#0c5922", "#743411"];
// PU:199-217
const darken = (s: string) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(s.slice(i, i + 2), 16) * 0.95).toString(16).padStart(2, "0")).join("");
// PU:219-279
function legacyGetter(initUsed: string[]): () => string {
  let index = 0;
  const used = new Set(initUsed);
  return () => {
    let next = D3[index % D3.length];
    while (used.has(next)) {
      if (index < D3.length) { index += 1; next = D3[index % D3.length]; continue; }
      const d = darken(next);
      if (d === next) break;
      next = d;
    }
    used.add(next); index += 1;
    return next;
  };
}
const legacySeq = (n: number) => { const g = legacyGetter([]); return Array.from({ length: n }, () => g()); };

// ---------- harness: the three places ----------

const RH = STYLE.geometry.rowH;

/** a one-group contract whose columns P0..Pn-1 carry `values` (undefined = no row) for attribute X */
function contract(values: (string | undefined)[], extra: Partial<AssembleInput> = {}, attr = "X"): Contract {
  const pids = values.map((_, i) => "P" + String(i).padStart(4, "0"));
  const map = new Map<string, string>();
  values.forEach((v, i) => { if (v !== undefined) map.set(pids[i], v); });
  return assembleContract({ genes: ["G"], groups: [{ name: "all", pids }], studies: ["s"], events: [],
    coverage: pids.map((pid) => ({ pid, genes: ["G"] })), isDriver: () => false, annotationSource: "t",
    clinical: [{ attr, values: map }], heatmap: [], derived: [], sort: [], lineGap: 0, ...extra });
}
const trackOf = (c: Contract, label = "X") => c.tracks.find((t) => t.label === label)!;

/** engine + style: each column's colour as trackCategoryColor gives it, in column order of the values */
function engineColors(values: (string | undefined)[], colors?: Record<string, Record<string, string>>): (string | null)[] {
  const c = contract(values);
  const t = trackOf(c);
  return values.map((_, i) => {
    const code = (t.cells as ArrayLike<number>)[c.columns.indexOf("P" + String(i).padStart(4, "0"))];
    return code < 0 ? null : trackCategoryColor(t as Parameters<typeof trackCategoryColor>[0], code, STYLE, colors).toLowerCase();
  });
}
/** value -> colour by the engine */
function engineMap(values: string[]): Map<string, string> {
  const cols = engineColors(values);
  return new Map(values.map((v, i) => [v, cols[i]!]));
}

/** server SVG: the data-row cell fills of track `label`, left to right (single group) */
function svgCells(svg: string, label: string): string[] {
  const at = svg.indexOf("</title>" + label + "</text>");
  assert.ok(at >= 0, "track " + label + " drawn");
  const rest = svg.slice(at);
  const end = rest.indexOf('<text x="4"', 10);
  const seg = end < 0 ? rest : rest.slice(0, end);
  return [...seg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="[\d.]+" height="([\d.]+)" fill="(#[0-9a-fA-F]{6})"\/>/g)]
    .filter((m) => Number(m[2]) === RH).sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[3].toLowerCase());
}
/** server SVG: legend entries [label, colour] of track `label` */
function svgLegend(svg: string, label: string): [string, string][] {
  const head = 'fill="' + STYLE.palette.text + '">' + label + "</text>";
  const at = svg.lastIndexOf(head);
  assert.ok(at >= 0, "legend for " + label);
  const rest = svg.slice(at + head.length);
  const end = rest.search(/<text x="4"|<\/svg>/);
  const seg = rest.slice(0, end);
  return [...seg.matchAll(/<rect [^>]*fill="(#[0-9a-fA-F]{6})"\/>(?:<rect [^>]*\/>)*<text [^>]*>([^<]*)<\/text>/g)].map((m) => [m[2], m[1].toLowerCase()]);
}
function svgOf(values: (string | undefined)[], extra: Partial<AssembleInput> = {}): string {
  return contractToSvg(contract(values, extra), 1200);
}

/** browser canvas: fills of every full-height cell rect, grouped by row (top to bottom), each left to right */
function canvasRows(c: Contract, colors?: Record<string, Record<string, string>>): string[][] {
  const buf = packContract(c);
  const data = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const n = c.columns.length;
  const groups: VisibleGroup[] = [{ name: "all", start: 0, count: n, patients: n }];
  const cssW = Math.max(400, n * 12 + GEOM.gutter + 10);
  const rects: { x: number; y: number; w: number; h: number; fill: string }[] = [];
  let fill = "";
  const ctx = new Proxy({}, {
    get(_t, k) {
      if (k === "getTransform") return () => ({ a: 1 });
      if (k === "fillRect") return (x: number, y: number, w: number, h: number) => rects.push({ x, y, w, h, fill });
      if (k === "measureText") return () => ({ width: 10 });
      if (k === "fillStyle") return fill;
      return () => {};
    },
    set(_t, k, v) { if (k === "fillStyle") fill = String(v); return true; }
  }) as unknown as CanvasRenderingContext2D;
  const z = Math.min(10, fitZoom(groups, cssW - GEOM.gutter, 0));
  draw(ctx, data, Uint32Array.from({ length: n }, (_, i) => i), groups, { zoom: z, scrollX: 0, whitespace: false }, cssW, undefined, { gap: 0, colors });
  const rows = new Map<number, { x: number; fill: string }[]>();
  for (const r of rects) if (Math.abs(r.h - RH) < 1e-9 && r.x >= GEOM.gutter) {
    if (!rows.has(r.y)) rows.set(r.y, []);
    rows.get(r.y)!.push({ x: r.x, fill: r.fill.toLowerCase() });
  }
  return [...rows.keys()].sort((a, b) => a - b).map((y) => {
    // keep the last fill per x (a cell is drawn over its background)
    const byX = new Map<number, string>();
    for (const e of rows.get(y)!) byX.set(e.x, e.fill);
    return [...byX.keys()].sort((a, b) => a - b).map((x) => byX.get(x)!);
  });
}
/** the canvas row of track X (the first clinical row, drawn above the gene) */
const canvasCells = (values: (string | undefined)[], colors?: Record<string, Record<string, string>>) =>
  canvasRows(contract(values, colors ? { display: normalizeDisplay({ colors }) } : {}), colors)[0];

/** distinct values, one each, in this arrival order: the case where legacy's arrival order and our frequency order agree */
const once = (vals: string[]) => vals;
const distinct = (n: number, prefix = "v") => Array.from({ length: n }, (_, i) => prefix + "_" + String.fromCharCode(97 + (i % 26)) + Math.floor(i / 26));

// ---------- the oracle reproduces the table's literals ----------

test("oracle: the transcribed legacy getter gives the table's literal hexes (PU:199-279)", () => {
  const s = legacySeq(200);
  assert.deepEqual([0, 30, 31, 32, 61, 62, 93, 199].map((i) => s[i]), ["#3366cc", "#743411", "#3061c2", "#d13611", "#6e3110", "#2e5cb8", "#2c57af", "#4b2696"]);
});

// ---------- Categorical (STRING) tracks ----------

test("1: one non-reserved value is #3366cc — engine (CDCU:19-26, PU:261,275-278)", () => {
  assert.deepEqual(engineColors(["Adenocarcinoma", "Adenocarcinoma", "Adenocarcinoma"]), ["#3366cc", "#3366cc", "#3366cc"]);
});
test("1: one non-reserved value is #3366cc — server SVG (CDCU:19-26, PU:261,275-278)", () => {
  assert.deepEqual(svgCells(svgOf(["Adenocarcinoma", "Adenocarcinoma"]), "X"), ["#3366cc", "#3366cc"]);
});
test("1: one non-reserved value is #3366cc — browser canvas (CDCU:19-26, PU:261,275-278)", () => {
  assert.deepEqual(canvasCells(["Adenocarcinoma", "Adenocarcinoma"]), ["#3366cc", "#3366cc"]);
});

test("2: equal counts, arrival order B, A, C -> B #3366cc, A #dc3912, C #ff9900 (CDCU:23-26)", () => {
  assert.deepEqual(engineColors(once(["B", "A", "C"])), ["#3366cc", "#dc3912", "#ff9900"]);
});
test("2: DELIBERATE DIVERGENCE (PR #197: 'ours is most frequent first'): B×1, A×3, C×2 -> A #3366cc, C #dc3912, B #ff9900; legacy would give B, A, C in arrival order (CDCU:23-26)", () => {
  const m = engineMap(["B", "A", "A", "A", "C", "C"]);
  assert.deepEqual([m.get("A"), m.get("C"), m.get("B")], ["#3366cc", "#dc3912", "#ff9900"]);
});

test("3: a value repeated in many rows is coloured once, at its first appearance (CDCU:24)", () => {
  const c = contract(["A", "B", "A", "A", "C", "A"]);
  assert.deepEqual(trackOf(c).categories, ["A", "B", "C"]);
  assert.deepEqual(engineColors(["A", "B", "A", "A", "C", "A"]), ["#3366cc", "#dc3912", "#3366cc", "#3366cc", "#ff9900", "#3366cc"]);
});

test("4: nine distinct values take palette[0..8], 9th #b82e2e, no 'Other' pooling — engine (CDCU:23-26)", () => {
  const vals = distinct(9);
  assert.equal(trackOf(contract(vals)).categories!.length, 9);
  assert.deepEqual(engineColors(vals), D3.slice(0, 9));
});
test("4: nine distinct values, palette[0..8] — server SVG and canvas (CDCU:23-26)", () => {
  const vals = distinct(9);
  assert.deepEqual(svgCells(svgOf(vals), "X"), D3.slice(0, 9));
  assert.deepEqual(canvasCells(vals), D3.slice(0, 9));
});

test("5: the 31st value is #743411 — clinicalColor and engine (PU:252)", () => {
  assert.equal(clinicalColor(30), "#743411");
  assert.equal(engineColors(distinct(31))[30], "#743411");
});

test("6: the 32nd value darkens #3366cc once to #3061c2 — clinicalColor, engine, SVG, canvas (PU:262-273, PU:199-217)", () => {
  assert.equal(clinicalColor(31), "#3061c2");
  const vals = distinct(32);
  assert.equal(engineColors(vals)[31], "#3061c2");
  assert.equal(svgCells(svgOf(vals), "X")[31], "#3061c2");
  assert.equal(canvasCells(vals)[31], "#3061c2");
});

test("7: the 33rd value is #d13611 (PU:262-273)", () => {
  assert.equal(clinicalColor(32), "#d13611");
  assert.equal(engineColors(distinct(33))[32], "#d13611");
});

test("8: the 62nd value is #6e3110 (PU:262-273)", () => {
  assert.equal(clinicalColor(61), "#6e3110");
  assert.equal(engineColors(distinct(62))[61], "#6e3110");
});

test("9: the 63rd value is #2e5cb8, twice darkened (PU:262-273)", () => {
  assert.equal(clinicalColor(62), "#2e5cb8");
  const vals = distinct(63);
  assert.equal(engineColors(vals)[62], "#2e5cb8");
  assert.equal(svgCells(svgOf(vals), "X")[62], "#2e5cb8");
  assert.equal(canvasCells(vals)[62], "#2e5cb8");
});

test("10: the 94th value is #2c57af, three darkenings (PU:262-273)", () => {
  assert.equal(clinicalColor(93), "#2c57af");
});

test("11: 200 distinct values: 200 distinct colours, the whole sequence equal to legacy, 200th #4b2696 — clinicalColor and engine (PU:262-273)", () => {
  const ours = Array.from({ length: 200 }, (_, k) => clinicalColor(k));
  assert.deepEqual(ours, legacySeq(200));
  assert.equal(ours[199], "#4b2696");
  const eng = engineColors(distinct(200));
  assert.equal(new Set(eng).size, 200);
  assert.deepEqual(eng, legacySeq(200));
});
test("11: 200 distinct values — server SVG and canvas draw the legacy sequence (PU:262-273)", () => {
  const vals = distinct(200);
  assert.deepEqual(svgCells(svgOf(vals), "X"), legacySeq(200));
  assert.deepEqual(canvasCells(vals), legacySeq(200));
});

test("12: a darkening fixed point (#000000) breaks the loop and reuses the colour (PU:270-272)", () => {
  const S = resolveStyle({ palette: { clinical: ["#000000"] } });
  assert.deepEqual([clinicalColor(0, S), clinicalColor(1, S), clinicalColor(2, S)], ["#000000", "#000000", "#000000"]);
});

test("13: JS Math.round half-up on .5 channels: the 35th value is #0f8f17 (0x96 × 0.95 = 142.5 -> 143), not banker's #0f8e17 (PU:199-208)", () => {
  assert.equal(clinicalColor(34), "#0f8f17");
  assert.equal(clinicalColor(45), "#db6d00", "the 46th: 0xe6 × 0.95 = 218.5 -> 219");
  assert.equal(engineColors(distinct(35))[34], "#0f8f17");
});

const RESERVED_ROWS: [string, string, string[], string][] = [
  ["14", "Yes/yes/YES", ["Yes", "yes", "YES"], YES],
  ["15", "No/no/NO", ["No", "no", "NO"], NO],
  ["16", "Male/male/MALE/M/m", ["Male", "male", "MALE", "M", "m"], MALE],
  ["17", "Female/F/f/FEMALE", ["Female", "F", "f", "FEMALE"], FEMALE],
  ["18", "Unknown/unknown/UNKNOWN/NA/na/Na", ["Unknown", "unknown", "UNKNOWN", "NA", "na", "Na"], LIGHT_GREY],
  ["19", "Other/OTHER/other", ["Other", "OTHER", "other"], DARK_GREY],
  ["20", "True/TRUE/true, Positive, Living, Alive, Disease Free, Tumor Free, Not Progressed", ["True", "TRUE", "true", "Positive", "Living", "Alive", "Disease Free", "Tumor Free", "Not Progressed"], YES],
  ["21", "False, Negative, Recurred, Progressed, With Tumor, Deceased", ["False", "Negative", "Recurred", "Progressed", "With Tumor", "Deceased"], NO]
];
for (const [row, name, values, hex] of RESERVED_ROWS) {
  test(`${row}: reserved ${name} -> ${hex}, no palette slot taken — reservedColor and engine (COL:46-78,131-150; CDCU:22)`, () => {
    for (const v of values) {
      assert.equal(LEGACY_RESERVED.get(v), hex, `oracle: ${v}`);
      assert.equal(reservedColor(v)?.toLowerCase(), hex, `reservedColor(${JSON.stringify(v)})`);
    }
    const cols = engineColors([...values, "Zz_plain"]);
    assert.deepEqual(cols, [...values.map(() => hex), "#3366cc"], "the plain value still takes #3366cc");
  });
}
test("14-17: reserved colours drawn — server SVG and canvas (COL:46-73)", () => {
  const vals = ["Yes", "No", "Male", "Female", "Zz_plain"];
  const want = [YES, NO, MALE, FEMALE, "#3366cc"];
  assert.deepEqual(svgCells(svgOf(vals), "X"), want);
  assert.deepEqual(canvasCells(vals), want);
});

/** ours: each value is reserved, and drawn in its reserved colour */
const reservedAsOurs = (vals: string[]) => {
  for (const v of vals) assert.ok(reservedColor(v), v + " is reserved here");
  assert.deepEqual(engineColors(vals), vals.map((v) => reservedColor(v)!.toLowerCase()));
};

test("21 (ours, docs/PORTAL-PARITY.md: reserved values match ignoring case and spaces) — the portal reserves only its exact spellings, so 'Recurred/Progressed' takes its palette (COL:131-150)", () => {
  assert.equal(LEGACY_RESERVED.get("Recurred/Progressed"), undefined, "oracle");
  reservedAsOurs(["Recurred/Progressed", "Recurred/progressed"]);
});

test("22: survival strings, as legacy's exact keys: 1:DECEASED, 1:deceased, 1:1, 1:EVENT -> #d95f02 (COL:89-100, expanded by COL:131-150)", () => {
  for (const v of ["1:DECEASED", "1:deceased", "1:1", "1:EVENT", "1:RECURRED"]) {
    assert.equal(LEGACY_RESERVED.get(v), NO, "oracle " + v);
    assert.equal(reservedColor(v)?.toLowerCase(), NO, v);
  }
});
test("22 (ours, docs/PORTAL-PARITY.md: reserved values match ignoring case and spaces) — '1:Recurred' and '1:Event' are not the portal's spellings (COL:142-147)", () => {
  for (const v of ["1:Recurred", "1:Event"]) assert.equal(LEGACY_RESERVED.get(v), undefined, "oracle " + v);
  reservedAsOurs(["1:Recurred", "1:Event"]);
});
test("23: survival strings 0:LIVING, 0:living, 0:0, 0:NED, 0:CENSORED -> #1b9e77 (COL:102-118)", () => {
  for (const v of ["0:LIVING", "0:living", "0:0", "0:NED", "0:CENSORED", "0:DISEASEFREE"]) {
    assert.equal(LEGACY_RESERVED.get(v), YES, "oracle " + v);
    assert.equal(reservedColor(v)?.toLowerCase(), YES, v);
  }
});
test("23 (ours, docs/PORTAL-PARITY.md: reserved values match ignoring case and spaces) — '0:DiseaseFree' and '0:Censored' are not the portal's spellings (COL:131-150)", () => {
  for (const v of ["0:DiseaseFree", "0:Censored"]) assert.equal(LEGACY_RESERVED.get(v), undefined, "oracle " + v);
  reservedAsOurs(["0:DiseaseFree", "0:Censored"]);
});

test("24: mutation/CNA words keep their alteration colours (COL:80-87,120-128; commons AlterationColors.ts:2-27)", () => {
  const want: [string, string][] = [["Missense", "#008000"], ["Inframe", "#993404"], ["Truncating", "#000000"], ["Fusion", "#8b00c9"],
    ["Splice", "#e5802b"], ["Promoter", "#00b7ce"], ["Driver", "#008000"], ["VUS", "#53d400"], ["Wild Type", DEFAULT_GREY],
    ["No Mutation", DEFAULT_GREY], ["Diploid", DEFAULT_GREY], ["Unchanged", DEFAULT_GREY], ["Amplification", "#ff0000"], ["Gain", "#ffb6c1"],
    ["Loss", "#8fd8d8"], ["Shallow Deletion", "#8fd8d8"], ["Deep Deletion", "#0000ff"]];
  for (const [v, hex] of want) {
    assert.equal(LEGACY_RESERVED.get(v), hex, "oracle " + v);
    assert.equal(reservedColor(v)?.toLowerCase(), hex, v);
  }
  assert.deepEqual(engineColors(want.map(([v]) => v)), want.map(([, h]) => h));
});

test("25 (ours, docs/PORTAL-PARITY.md: reserved values match ignoring case and spaces) — 'yEs', 'mAle', 'Unknown ' take the palette in the portal (COL:131-150, CDCU:24)", () => {
  for (const v of ["yEs", "mAle", "Unknown "]) assert.equal(LEGACY_RESERVED.get(v), undefined, "oracle " + v);
  reservedAsOurs(["yEs", "mAle", "Unknown "]);
});

test("26 (ours, docs/PORTAL-PARITY.md: reserved values match ignoring case and spaces) — 'DiseaseFree', 'NotProgressed' take the palette in the portal (COL:136-139)", () => {
  reservedAsOurs(["DiseaseFree", "NotProgressed"]);
});

test("27: 'Disease free', 'DISEASE FREE', 'diseasefree', 'DISEASEFREE', 'Disease Free' are reserved #1b9e77 (COL:132-145)", () => {
  const vals = ["Disease free", "DISEASE FREE", "diseasefree", "DISEASEFREE", "Disease Free"];
  for (const v of vals) assert.equal(LEGACY_RESERVED.get(v), YES, "oracle " + v);
  assert.deepEqual(engineColors([...vals, "Zz_plain"]), [...vals.map(() => YES), "#3366cc"]);
});

test("28 (ours, docs/PORTAL-PARITY.md: reserved values match ignoring case and spaces) — ' Yes', 'Yes ' are each their own category, as in the portal, but take Yes's colour (CDCU:24)", () => {
  const vals = ["Yes", " Yes", "Yes "];
  assert.equal(trackOf(contract(vals)).categories!.length, 3);
  assert.deepEqual(engineColors(vals), [YES, YES, YES]);
});

test("29: values differing only by case/whitespace are three categories with three palette colours (CDCU:23-26, RS:762-770)", () => {
  const vals = ["Stage I", "stage I", "Stage I "];
  assert.equal(trackOf(contract(vals)).categories!.length, 3);
  assert.deepEqual(engineColors(vals), ["#3366cc", "#dc3912", "#ff9900"]);
});

test("30: the empty string is a category with the next palette colour, legend label empty — engine and SVG (CDCU:24-25)", () => {
  const vals = ["A", "", "B"];
  assert.deepEqual(engineColors(vals), ["#3366cc", "#dc3912", "#ff9900"]);
  const svg = svgOf(vals);
  assert.deepEqual(svgCells(svg, "X"), ["#3366cc", "#dc3912", "#ff9900"]);
  assert.ok(svgLegend(svg, "X").some(([l, c]) => l === "" && c === "#dc3912"), JSON.stringify(svgLegend(svg, "X")));
});

test("31: a case with no data row is NA (no colour), drawn as the NA shape, legend 'No data' last (DU:651-659, RS:700-709, RS:289)", { todo: "the clinical legend has no \"No data\" entry yet (docs/PORTAL-PARITY.md, ONC-ST-4)" }, () => {
  const vals = ["A", undefined, "B"];
  assert.deepEqual(engineColors(vals), ["#3366cc", null, "#dc3912"]);
  const svg = svgOf(vals);
  const leg = svgLegend(svg, "X").map(([l]) => l);
  assert.equal(leg.at(-1), "No data", JSON.stringify(leg));
});

test("32: numbers stored as text '1', '10', '2' are plain categories coloured in arrival order (CDCU:23-26)", () => {
  assert.deepEqual(engineColors(["1", "10", "2"]), ["#3366cc", "#dc3912", "#ff9900"]);
});
test("32: legend sorts '1', '10', '2' by localeCompare: 1, 10, 2 (LR:103-116)", { todo: "the clinical legend is most frequent first, not alphabetical (docs/PORTAL-PARITY.md, ONC-ST-4)" }, () => {
  // arrival 2, 10, 1 so neither arrival nor numeric order is the legacy legend order
  const leg = svgLegend(svgOf(["2", "10", "1"]), "X").map(([l]) => l);
  assert.deepEqual(leg, ["1", "10", "2"]);
});

test("33 (ours, docs/PORTAL-PARITY.md: reserved values match ignoring case and spaces) — the portal's oncoprint does not use the normalising getClinicalValueColor; 'NOT progressed' takes its palette (COL:152-156)", () => {
  reservedAsOurs(["NOT progressed"]);
});

test("34: getReservedGroupColor is not used: a comma list 'Yes, Male' is a plain category (COL:158-172)", () => {
  assert.deepEqual(engineColors(["Yes, Male", "Female,Yes"]), ["#3366cc", "#dc3912"]);
});

test("35: patient 'Mixed' is outside category_to_color, so oncoprintjs' getter colours it: with A, B present -> #3061c2 (RS:717-723, RS:762-770, RS:205-262)", () => {
  // the value arrives as the literal "Mixed" (#198); legacy's oncoprintjs getter starts at #3366cc, used, darkens once
  const m = engineMap(["A", "B", "Mixed"]);
  assert.equal(m.get("Mixed"), "#3061c2");
});
test("35: 'Mixed' with only reserved values present -> #3366cc (RS:205-262)", () => {
  const m = engineMap(["Yes", "No", "Mixed"]);
  assert.equal(m.get("Mixed"), "#3366cc");
});

test("36: only values present appear in the legend; reserved rules not in the data are not listed (RS:720-723, LR:75-78)", () => {
  const leg = svgLegend(svgOf(["Male", "Male"]), "X");
  assert.deepEqual(leg, [["Male", MALE]]);
});

test("37: a user-picked colour overrides both a reserved and a palette colour — trackCategoryColor (OU:1416-1420,1457-1461)", () => {
  const colors = { X: { Yes: "#123456", Plain: "#abcdef" } };
  assert.deepEqual(engineColors(["Yes", "Plain", "Other2"], colors), ["#123456", "#abcdef", "#dc3912"],
    "the user-coloured 'Plain' still took #3366cc in category_to_color first (OU:1457-1461 overrides after CDCU assigned), so 'Other2' is #dc3912");
});
test("37: a user-picked colour overrides — server SVG via display.colors, browser canvas via DrawOpts.colors (OU:1416-1420,1457-1461)", () => {
  const colors = { X: { Yes: "#123456", Plain: "#abcdef" } };
  const c = contract(["Yes", "Plain"], { display: normalizeDisplay({ colors }) });
  assert.deepEqual(svgCells(contractToSvg(c, 1200), "X"), ["#123456", "#abcdef"]);
  assert.deepEqual(canvasCells(["Yes", "Plain"], colors), ["#123456", "#abcdef"]);
});

test("38: PROFILED_IN: 'Yes' is #1b9e77, the NA label is 'No' — engine and SVG legend (OU:1405-1414)", () => {
  const pids = ["P0000", "P0001", "P0002"];
  const c = contract(["a", "b", "c"], { profiled: { types: ["MUTATION_EXTENDED"] as never, masks: [{ pid: pids[0], mask: 1 }, { pid: pids[1], mask: 0 }, { pid: pids[2], mask: 1 }] } });
  const t = c.tracks.find((x) => (x as { profiledFor?: string }).profiledFor)!;
  assert.ok(t, "a Profiled for row");
  assert.equal(trackCategoryColor(t as Parameters<typeof trackCategoryColor>[0], 0).toLowerCase(), YES);
  const leg = svgLegend(contractToSvg(c, 1200), t.label.length > 16 ? t.label.slice(0, 16) + "…" : t.label);
  assert.deepEqual(leg.map(([l]) => l), ["Yes", "No"]);
  assert.equal(leg[0][1], YES);
});

test("39: legend order is alphabetical (localeCompare), not frequency; 'No data' last (LR:103-157, RS:708)", { todo: "the clinical legend is most frequent first, not alphabetical (docs/PORTAL-PARITY.md, ONC-ST-4)" }, () => {
  // frequency: Zeta×3, Beta×2, Alpha×1
  const leg = svgLegend(svgOf(["Zeta", "Zeta", "Zeta", "Beta", "Beta", "Alpha", undefined]), "X").map(([l]) => l);
  assert.deepEqual(leg, ["Alpha", "Beta", "Zeta", "No data"]);
});

test("40: no palette colour equals a reserved colour, so reservations never skip or darken: first 31 values are the list verbatim (CDCU:19-21, RS:717-719)", () => {
  const reservedHexes = new Set([...LEGACY_RESERVED.values()]);
  assert.equal(D3.filter((c) => reservedHexes.has(c)).length, 0);
  assert.deepEqual([...STYLE.palette.clinical].map((c) => c.toLowerCase()), D3);
  assert.deepEqual(Array.from({ length: 31 }, (_, k) => clinicalColor(k)), D3);
  // a track holding every reserved word plus one plain value: the plain value is still #3366cc
  const all = [...new Set(Object.keys(LEGACY_BASE).map((k) => k[0].toUpperCase() + k.slice(1)))];
  const m = engineMap([...all, "Zz_plain"]);
  assert.equal(m.get("Zz_plain"), "#3366cc");
});

// ---------- Numeric (NUMBER) tracks ----------

const numVals = (xs: number[]) => xs.map(String);

test("41: positive bars are #008000, bottom-anchored, height (v-min)/(max-min) (RS:1072, RS:1123-1131, RS:833-834)", () => {
  assert.equal(STYLE.glyph.bar.color.toLowerCase(), "#008000");
  const b = barBand({ min: 0, max: 10 }, encodeNumeric(5, 0, 10));
  assert.equal(b.negative, false);
  assert.equal(b.band[1], 1, "anchored at the bottom");
  assert.ok(Math.abs((1 - b.band[0]) - 0.5) < 0.01, JSON.stringify(b));
});
test("42: a negative value in a mixed range is #ff0000, around the midline, abs(v)/max(abs(min),max) × 50% (RS:1073, RS:1100-1102, RS:828-833)", () => {
  assert.equal(STYLE.glyph.bar.negative.toLowerCase(), "#ff0000");
  const b = barBand({ min: -4, max: 2 }, encodeNumeric(-2, -4, 2));
  assert.equal(b.negative, true);
  assert.ok(Math.abs(b.band[0] - 0.5) < 0.01 && Math.abs(b.band[1] - 0.75) < 0.01, JSON.stringify(b));
});
test("43: all values <= 0 hang from the top (RS:820-823, RS:1117-1120)", () => {
  const b = barBand({ min: -5, max: -1 }, encodeNumeric(-5, -5, -1));
  assert.equal(b.negative, true);
  assert.equal(b.band[0], 0);
});
test("44: min == max (all 4): the range becomes [2, 6] (RS:864-867)", { skip: "our assembler types an attribute numeric only past 10 distinct values (AssembleInput.clinical carries no datatype), so a single-valued NUMBER attribute is a one-category track and has no range" }, () => {});
test("45: all values 0, range [0,0] -> NaN height in legacy (RS:864-867)", { skip: "legacy renders NaN (a bug); our contract has no way to express the declared datatype of an all-zero attribute, and a NaN bar is nothing to assert parity with" }, () => {});
test("46: FRACTION_GENOME_ALTERED has a fixed range [0, 1] (OU:1427)", () => {
  const c = contract(Array.from({ length: 12 }, (_, i) => String(0.2 + i * 0.01)), {}, "FRACTION_GENOME_ALTERED");
  const t = trackOf(c, "FRACTION_GENOME_ALTERED");
  assert.deepEqual([t.min, t.max], [0, 1]);
});
test("47: MUTATION_COUNT is on a log scale (OU:1431, RS:810-819)", () => {
  const c = contract(Array.from({ length: 12 }, (_, i) => String(i * i)), {}, "MUTATION_COUNT");
  assert.equal(trackOf(c, "MUTATION_COUNT").logScale, true);
});
test("47: a missing MUTATION_COUNT becomes 0, not NA (DU:655-657)", { skip: "on purpose since #198: a case with no MUTATION_COUNT has no value, never 0 (docs/PORTAL-PARITY.md, ONC-TT-12; invariant 7)" }, () => {
  const vals: (string | undefined)[] = Array.from({ length: 12 }, (_, i) => String(i * i + 1));
  vals.push(undefined);
  const c = contract(vals, {}, "MUTATION_COUNT");
  const t = trackOf(c, "MUTATION_COUNT");
  const code = (t.cells as ArrayLike<number>)[c.columns.indexOf("P0012")];
  assert.ok(code >= 0, "drawn as a value, not NA (code " + code + ")");
});
test("48: NumSamplesPerPatient ranges [0, inferred max] (OU:1436, RS:856-862)", () => {
  const pids = ["P0000", "P0001", "P0002"];
  const c = contract(["a", "b", "c"], { samples: [{ pid: pids[0], n: 2 }, { pid: pids[1], n: 3 }, { pid: pids[2], n: 1 }] });
  const t = c.tracks.find((x) => /samples per patient/i.test(x.label));
  assert.ok(t, "the # Samples per Patient row");
  assert.equal(t!.min, 0);
  assert.equal(t!.max, 3);
});
test("49: a patient's number is the mean of its samples (DU:693-698)", { skip: "patient aggregation happens before assembleContract (values arrive one per column); not a colour rule — belongs to the #198 audit" }, () => {});
test("50: number stored as text: '12.5' parses, 'abc'/'' are dropped, none left -> NA (DU:675-683)", { skip: "on purpose since #198: a NUMBER is a number only when its whole text is one, by declared datatype in the database query (docs/PORTAL-PARITY.md, ONC-TT-12; invariant 1)" }, () => {
  const vals = Array.from({ length: 12 }, (_, i) => String(i + 0.5));
  vals[0] = "12.5"; vals[1] = "abc"; vals[2] = "";
  const c = contract(vals);
  const t = trackOf(c);
  assert.equal(t.numeric, true, "still a numeric track");
  const cell = (i: number) => (t.cells as ArrayLike<number>)[c.columns.indexOf("P" + String(i).padStart(4, "0"))];
  assert.ok(cell(0) >= 0);
  assert.ok(cell(1) < 0 && cell(2) < 0, "'abc' and '' are NA");
});
test("51: the numeric legend is the effective range in green/red (RS:1104-1111)", { todo: "the numeric legend is one colour, not the portal's green-to-red range (docs/PORTAL-PARITY.md, ONC-ST-4)" }, () => {
  const svg = svgOf(numVals(Array.from({ length: 12 }, (_, i) => i - 3)));
  const leg = svgLegend(svg, "X");
  assert.ok(leg.length > 0, "a legend for the numeric row: " + JSON.stringify(leg));
  const fills = leg.map(([, c]) => c);
  assert.ok(fills.includes("#008000") && fills.includes("#ff0000"), JSON.stringify(leg));
});

// ---------- Counts-map (Mutation spectrum) ----------

test("52: spectrum fills C>A #3D6EB1, C>G #8EBFDC, C>T #DFF1F8, T>A #FCE08E, T>C #F78F5E, T>G #D62B23, in this order (CDC:32-48, OU:1466-1468)", () => {
  assert.deepEqual(STYLE.glyph.spectrum.categories, ["C>A", "C>G", "C>T", "T>A", "T>C", "T>G"]);
  assert.deepEqual(STYLE.glyph.spectrum.colors.map((c) => c.toLowerCase()), ["#3d6eb1", "#8ebfdc", "#dff1f8", "#fce08e", "#f78f5e", "#d62b23"]);
});
test("53: a user colour for a spectrum category replaces that fill (OU:1469-1476)", { skip: "no recorded way to set a per-category spectrum colour in the inputs this audit may read (display.colors is keyed by clinical track label); not part of PR #197" }, () => {});
test("54: all spectrum counts 0 -> NA (DU:735-745)", { skip: "spectrum assembly is the #199 audit's; the counts-map input format is not part of PR #197" }, () => {});
test("55: composition heights count/sum × 100, last segment snapped (RS:1196-1236)", { skip: "spectrum geometry is the #199 audit's; not touched by PR #197" }, () => {});
test("56: fewer fills than categories are padded via makeUniqueColorGetter (RS:1177-1182)", { skip: "our spectrum categories are fixed at six with six colours; the case cannot arise" }, () => {});
