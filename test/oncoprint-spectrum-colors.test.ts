// Edit colours on the mutation spectrum row, from the case table written from the legacy source
// (cbioportal-frontend cd8c6df). Case ids are the table's:
//   OU = src/shared/components/oncoprint/OncoprintUtils.ts 1416-1475: the counts track's six fills start as
//        MUTATION_SPECTRUM_FILLS (shared/cache/ClinicalDataCache.ts 41-48) and each category's fill is replaced
//        by the user's colour for that category label, looked up under the track's own name
//        (userSelectedStudiesToClinicalTracksColors['global'][attribute.displayName]).
// Ours: display.colors[trackLabel][category], read through stackColor by every renderer and legend.
import test from "node:test";
import assert from "node:assert/strict";
import * as style from "../lib/oncoprint-style.ts";
import { STYLE } from "../lib/oncoprint-style.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";
import { assembleContract, type AssembleInput } from "../lib/oncoprint-assemble.ts";
import { draw, GEOM, type VisibleGroup } from "../app/_oncoprint/canvas.ts";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";
import { SPECTRUM_TRACK } from "../lib/profile-names.ts";

type Colors = Record<string, Record<string, string>>;
// read through the namespace so a missing export fails each case, not the file
const stackColor = (track: { label: string; stack?: readonly string[] }, j: number, S?: typeof STYLE, colors?: Colors): string =>
  (style as unknown as { stackColor: (...a: unknown[]) => string }).stackColor(track, j, S, colors);

// ClinicalDataCache.ts 41-48
const LEGACY_FILLS = ["#3D6EB1", "#8EBFDC", "#DFF1F8", "#FCE08E", "#F78F5E", "#D62B23"];
const CATS = ["C>A", "C>G", "C>T", "T>A", "T>C", "T>G"];
const TRACK = { label: SPECTRUM_TRACK, stack: CATS };
const OVERRIDE = "#000000";
const up = (s: string) => s.toUpperCase();

test("C1: no override: category j is the portal's MUTATION_SPECTRUM_FILLS[j] (OU 1466-1470)", () => {
  assert.deepEqual(CATS.map((_, j) => up(stackColor(TRACK, j))), LEGACY_FILLS, "default S");
  assert.deepEqual(CATS.map((_, j) => up(stackColor(TRACK, j, STYLE))), LEGACY_FILLS, "S given");
  assert.deepEqual(CATS.map((_, j) => up(stackColor(TRACK, j, STYLE, {}))), LEGACY_FILLS, "empty colours");
  assert.deepEqual(CATS.map((_, j) => up(stackColor(TRACK, j, STYLE, { [SPECTRUM_TRACK]: {} }))), LEGACY_FILLS, "the row's entry empty");
});

test("C2: an override for C>T draws C>T in it and leaves the other five (OU 1468-1474)", () => {
  const colors = { [SPECTRUM_TRACK]: { "C>T": OVERRIDE } };
  const got = CATS.map((_, j) => up(stackColor(TRACK, j, STYLE, colors)));
  assert.deepEqual(got, LEGACY_FILLS.map((f, j) => (CATS[j] === "C>T" ? OVERRIDE : f)));
  // every category can be overridden, each by its own label
  const all = Object.fromEntries(CATS.map((c, j) => [c, "#00000" + j]));
  assert.deepEqual(CATS.map((_, j) => stackColor(TRACK, j, STYLE, { [SPECTRUM_TRACK]: all })), CATS.map((_, j) => "#00000" + j));
});

test("C3: an override under another track's label has no effect on the spectrum (OU: keyed by the track's name)", () => {
  const colors = { "Sex": { "C>T": OVERRIDE }, "OTHER_SPECTRUM": { "C>A": OVERRIDE } };
  assert.deepEqual(CATS.map((_, j) => up(stackColor(TRACK, j, STYLE, colors))), LEGACY_FILLS);
  // the same colours under the row's label do apply: the lookup is by label
  assert.equal(up(stackColor({ label: "OTHER_SPECTRUM", stack: CATS }, 0, STYLE, colors)), OVERRIDE);
});

// a contract with one spectrum row in which every column has all six categories
function spectrumContract() {
  const pids = ["A", "B", "C"];
  const spec = new Map([["A", "1,1,1,1,1,1"], ["B", "2,1,3,1,1,1"], ["C", "1,2,1,2,1,2"]]);
  const input: AssembleInput = {
    genes: ["TP53"], groups: [{ name: "all", pids }], studies: ["s"], events: [], derived: [], heatmap: [],
    coverage: pids.map((pid) => ({ pid, genes: ["TP53"] })), isDriver: () => false, annotationSource: "t",
    clinical: [{ attr: SPECTRUM_TRACK, values: spec }], sort: [], lineGap: 0
  } as unknown as AssembleInput;
  const c = assembleContract(input);
  const t = c.tracks.find((x) => x.label === SPECTRUM_TRACK)!;
  assert.deepEqual(t.stack, CATS, "the fixture has a spectrum row");
  return { c, t };
}

const fillsOf = (svg: string) => [...svg.matchAll(/<rect [^>]*fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => up(m[1]));

test("C4: the server SVG's spectrum cells and its legend swatch use the override; the other categories keep the defaults", () => {
  const { c } = spectrumContract();
  const before = fillsOf(contractToSvg(c, 800));
  assert.ok(!before.includes(OVERRIDE), "fixture: nothing is drawn in the override colour without it");
  const nBefore = before.filter((f) => f === "#DFF1F8").length;
  assert.equal(nBefore, 3 + 1, "fixture: C>T is drawn in its default for each of 3 columns plus the legend swatch");
  c.display = { ...c.display, colors: { [SPECTRUM_TRACK]: { "C>T": OVERRIDE } } } as typeof c.display;
  const fills = fillsOf(contractToSvg(c, 800));
  assert.equal(fills.filter((f) => f === OVERRIDE).length, 3 + 1, "3 C>T cells and 1 legend swatch drawn in the override");
  assert.ok(!fills.includes("#DFF1F8"), "the default C>T colour is gone");
  for (const f of LEGACY_FILLS.filter((x) => x !== "#DFF1F8"))
    assert.equal(fills.filter((x) => x === f).length, 3 + 1, `${f} still drawn for the cells and the legend`);
});

test("C5: the browser canvas fills the C>T segments with opts.colors' override; the other five keep the defaults", () => {
  const { c } = spectrumContract();
  const buf = packContract(c);
  const data = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const n = c.columns.length;
  const run = (colors?: Colors) => {
    const fills: { x: number; y: number; h: number; style: string }[] = [];
    let fillStyle = "";
    const ctx = new Proxy({}, {
      get(_t, k) {
        if (k === "getTransform") return () => ({ a: 1 });
        if (k === "fillRect") return (x: number, y: number, _w: number, h: number) => { if (h > 0) fills.push({ x, y, h, style: up(fillStyle) }); };
        if (k === "measureText") return () => ({ width: 10 });
        if (k === "fillStyle") return fillStyle;
        return () => {};
      },
      set(_t, k, val) { if (k === "fillStyle") fillStyle = String(val); return true; }
    }) as unknown as CanvasRenderingContext2D;
    const groups: VisibleGroup[] = [{ name: "all", start: 0, count: n, patients: n }];
    draw(ctx, data, Uint32Array.from({ length: n }, (_, i) => i), groups, { zoom: 10, scrollX: 0, whitespace: true }, 1200, undefined,
      { gap: 0, ...(colors ? { colors } : {}) });
    const ti = c.tracks.findIndex((t) => t.label === SPECTRUM_TRACK);
    const y0 = GEOM.header + ti * (GEOM.rowH + GEOM.rowGap);
    return fills.filter((f) => f.x >= GEOM.gutter && f.y >= y0 - 1e-9 && f.y < y0 + GEOM.rowH).map((f) => f.style);
  };
  const before = run();
  assert.equal(before.filter((s) => s === "#DFF1F8").length, n, "fixture: each column has a C>T segment in the default");
  assert.ok(!before.includes(OVERRIDE), "fixture: nothing is drawn in the override colour without it");
  const after = run({ [SPECTRUM_TRACK]: { "C>T": OVERRIDE } });
  assert.equal(after.filter((s) => s === OVERRIDE).length, n, "each column's C>T segment in the override");
  assert.ok(!after.includes("#DFF1F8"), "the default C>T colour is gone");
  for (const f of LEGACY_FILLS.filter((x) => x !== "#DFF1F8")) assert.equal(after.filter((s) => s === f).length, n, `${f} unchanged`);
  // C3 on the canvas: another track's override changes nothing
  assert.deepEqual(run({ "Sex": { "C>T": OVERRIDE } }), before);
});
