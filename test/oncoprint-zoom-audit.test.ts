// Audit of PR #194 (initial zoom to the altered columns) against the legacy oncoprintjs fit,
// written from the parity case table, not from the implementation.
//
// Legacy (oncoprintmodel.ts:835-901, 921-923, 962-976): zoom z is a fraction of 100 %, where a
// column is a 6 px cell + 3 px padding. Padding switches off once the zoomed cell (6z) is under
// 2 px, so the drawn column pitch is 9z with padding and 6z without. Ours: `zoom` is the column
// pitch in px, 9 px = the portal's 100 %. Tests compare the drawn pitch, which is what a reader sees.
import test from "node:test";
import assert from "node:assert/strict";
import { fitAlteredView, PORTAL_FULL_ZOOM, type VisibleGroup } from "../app/_oncoprint/canvas.ts";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";
import { assembleContract, type EventRow } from "../lib/oncoprint-assemble.ts";

const pid = (i: number) => "P" + String(i).padStart(5, "0");
const close = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-3, `${msg ?? ""} got ${a}, expected ${b}`);

/** Legacy getHorzZoomToFitCols + setHorzZoom's clamp, returned as {z, pitch}. */
function legacy(W: number, n: number, gapsInSpan: number, gapSize: number, fullBaseWidth: number): { z: number; pitch: number } {
  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
  const num = W - gapsInSpan * gapSize;
  const zp = clamp(num / (9 * n), 0, 1), zn = clamp(num / (6 * n), 0, 1);
  let z = 6 * zp >= 2 ? zp : 6 * zn >= 2 ? zp : zn;
  z = clamp(z, Math.min(100 / fullBaseWidth, 1), 1);
  return { z, pitch: 6 * z < 2 ? 6 * z : 9 * z };
}
/** getOncoprintWidth(true) with no gaps: last column's base left + cell + 1 */
const fullBase = (N: number) => (N - 1) * 9 + 6 + 1;

interface Build {
  groups: string[][];
  altered?: string[];
  extraEvents?: EventRow[];
  genes?: string[];
  overlays?: { kind: "mrna" | "protein"; profileType: string; threshold: number; values: Map<string, number> }[];
  clinical?: { attr: string; values: Map<string, string> }[];
}

/** Assemble, pack and unpack a figure, then lay its columns out in `display` order (one array per visible group). */
function figure(b: Build, display: string[][] = b.groups) {
  const all = b.groups.flat();
  const genes = b.genes ?? ["G"];
  const events: EventRow[] = [...(b.altered ?? []).map((p) => ({ pid: p, gene: genes[0], vt: "mutation", mt: "Missense_Mutation" })), ...(b.extraEvents ?? [])];
  const c = assembleContract({ genes, groups: b.groups.map((pids, i) => ({ name: "g" + i, pids })), studies: ["s"], events,
    coverage: all.map((p) => ({ pid: p, genes })), isDriver: () => false, annotationSource: "t",
    clinical: b.clinical ?? [], heatmap: [], derived: [], sort: [], lineGap: 0, ...(b.overlays ? { overlays: b.overlays } : {}) } as never);
  const buf = packContract(c);
  const data = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const idx = new Map(data.columns().map((p, i) => [p, i]));
  const order = Uint32Array.from(display.flat().map((p) => idx.get(p)!));
  let start = 0;
  const vg: VisibleGroup[] = display.map((g, i) => { const r = { name: "g" + i, start, count: g.length, patients: g.length }; start += g.length; return r; });
  return { data, order, vg };
}
const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => pid(from + i));

// ---- 1: which ids are altered ----------------------------------------------------------------

test("1a: altered is the union over all genetic tracks, SV included (G/OncoprintUtils.ts:1010-1024; G/ResultsViewOncoprint.tsx:1625-1629)", () => {
  const cols = ids(100);
  const f = figure({ groups: [cols], genes: ["G1", "G2"], altered: [cols[0]],
    extraEvents: [{ pid: cols[99], gene: "G2", vt: "structural_variant" }] }, [cols]);
  // span is all 100 columns: z = 450/900 = 0.5, cell 3 px, padding on, pitch 4.5
  const exp = legacy(450, 100, 0, 0, fullBase(100));
  close(exp.pitch, 4.5);
  close(fitAlteredView(f.data, f.order, f.vg, 450, 0).zoom, exp.pitch);
});

test("1b: clinical tracks do not make a column altered (G/OncoprintUtils.ts:1010-1024)", () => {
  const cols = ids(100);
  const f = figure({ groups: [cols], altered: [cols[0], cols[1]],
    clinical: [{ attr: "AGE", values: new Map(cols.map((p, i) => [p, String(40 + i)])) }] }, [cols]);
  assert.equal(fitAlteredView(f.data, f.order, f.vg, 450, 0).zoom, PORTAL_FULL_ZOOM);
});

test("1c: documented divergence: an mRNA-overlay-only column is not altered (ours, PR #194); legacy counts it when OQL puts it in the track (G/OncoprintUtils.ts:1010-1024)", () => {
  const cols = ids(100);
  const f = figure({ groups: [cols], altered: [cols[0]],
    overlays: [{ kind: "mrna", profileType: "rna", threshold: 2, values: new Map([[cols[99] + "|G", 3.1]]) }] }, [cols]);
  // ours: only column 0 altered -> 100 %. Legacy (with EXP in the OQL) would fit all 100 -> 4.5 px.
  assert.equal(fitAlteredView(f.data, f.order, f.vg, 450, 0).zoom, PORTAL_FULL_ZOOM);
});

test("2: trigger once the altered keys resolve (G/ResultsViewOncoprint.tsx:1613-1615; P/oncoprint.ts:884-891)", { skip: "component lifecycle in OncoprintFigure.tsx; no exported pure function to drive without a browser" }, () => {});

// ---- 3-14: the fit ---------------------------------------------------------------------------

test("3a: nothing altered -> 100 % exactly, 9 px per column (P/oncoprintmodel.ts:905-907)", () => {
  const cols = ids(5000);
  const f = figure({ groups: [cols] });
  assert.equal(fitAlteredView(f.data, f.order, f.vg, 1000, 0).zoom, PORTAL_FULL_ZOOM);
});

test("3b: documented divergence: nothing altered, few columns -> ours fits every column (fit-all floor, PR #194); legacy stays at 9 px (P/oncoprintmodel.ts:905-907)", () => {
  const cols = ids(50);
  const f = figure({ groups: [cols] });
  close(fitAlteredView(f.data, f.order, f.vg, 1000, 0).zoom, 1000 / 50);
});

test("4: one altered column, W=1146 -> 100 % (P/oncoprintmodel.ts:835-901)", () => {
  const cols = ids(594);
  const f = figure({ groups: [cols], altered: [cols[300]] });
  assert.equal(fitAlteredView(f.data, f.order, f.vg, 1146, 0).zoom, PORTAL_FULL_ZOOM);
});

test("5: altered at 0 and 999 of 1000, W=1146 -> zn=0.191, padding off, pitch 1.146 (P/oncoprintmodel.ts:870-897)", () => {
  const cols = ids(1000);
  const f = figure({ groups: [cols], altered: [cols[0], cols[999]] }, [cols]);
  const exp = legacy(1146, 1000, 0, 0, fullBase(1000));
  close(exp.z, 0.191);
  close(fitAlteredView(f.data, f.order, f.vg, 1146, 0).zoom, exp.pitch);
});

test("6: two adjacent altered of 1000, W=1146 -> 100 % (P/oncoprintmodel.ts:835-901)", () => {
  const cols = ids(1000);
  const f = figure({ groups: [cols], altered: [cols[500], cols[501]] }, [cols]);
  assert.equal(fitAlteredView(f.data, f.order, f.vg, 1146, 0).zoom, PORTAL_FULL_ZOOM);
});

test("7a: 485 of 594 altered at the front, W=1146 -> zoom 26.25 % of 100 % (contradiction branch) (P/oncoprintmodel.ts:878-893)", () => {
  const cols = ids(594);
  const f = figure({ groups: [cols], altered: cols.slice(0, 485) }, [cols]);
  close(fitAlteredView(f.data, f.order, f.vg, 1146, 0).zoom / PORTAL_FULL_ZOOM, 0.2625);
  close(fitAlteredView(f.data, f.order, f.vg, 1310, 0).zoom / PORTAL_FULL_ZOOM, legacy(1310, 485, 0, 0, fullBase(594)).z);
});

test("7b: 485 of 594 altered, W=1146 -> drawn pitch 6*0.2625 = 1.575 px, since padding turns off at that zoom (P/oncoprintmodel.ts:878-893, 962-976)", { skip: "ours, docs/PORTAL-PARITY.md: the portal drops cell padding below 2 px and leaves the rest of the plot blank; ours fills it" }, () => {
  const cols = ids(594);
  const f = figure({ groups: [cols], altered: cols.slice(0, 485) }, [cols]);
  const exp = legacy(1146, 485, 0, 0, fullBase(594));
  close(exp.pitch, 1.575);
  close(fitAlteredView(f.data, f.order, f.vg, 1146, 0).zoom, exp.pitch);
});

test("8: all 594 altered, W=1146 -> zn=0.3215, padding off, pitch 1.929 (P/oncoprintmodel.ts:870-897)", () => {
  const cols = ids(594);
  const f = figure({ groups: [cols], altered: cols });
  const exp = legacy(1146, 594, 0, 0, fullBase(594));
  close(exp.z, 0.3215);
  close(fitAlteredView(f.data, f.order, f.vg, 1146, 0).zoom, exp.pitch);
});

test("9: documented divergence: 100 columns all altered, W=2000 -> ours fills the width (20 px, PR #194); legacy caps at 100 % = 9 px (P/oncoprintmodel.ts:859-868, 964)", () => {
  const cols = ids(100);
  const f = figure({ groups: [cols], altered: cols });
  close(fitAlteredView(f.data, f.order, f.vg, 2000, 0).zoom, 20);
});

test("10a: documented divergence: 300 all altered, W=5000 -> ours fills the width (PR #194); legacy caps at 9 px (P/oncoprintmodel.ts:859-868, 964)", () => {
  const cols = ids(300);
  const f = figure({ groups: [cols], altered: cols });
  close(fitAlteredView(f.data, f.order, f.vg, 5000, 0).zoom, 5000 / 300);
});

test("10b: 300 of 1000 altered, W=5000 -> zp=1.85 -> clamp to 100 % (P/oncoprintmodel.ts:859-868, 964)", () => {
  const cols = ids(1000);
  const f = figure({ groups: [cols], altered: cols.slice(0, 300) }, [cols]);
  assert.equal(fitAlteredView(f.data, f.order, f.vg, 5000, 0).zoom, PORTAL_FULL_ZOOM);
});

test("11a: span crossing two group gaps, SHOW_GAPS gap=6 -> numerator W-12 (P/oncoprintmodel.ts:846-851, 1174-1186)", () => {
  const g = [ids(100, 0), ids(100, 100), ids(100, 200)];
  const f = figure({ groups: g, altered: [g[0][0], g[2][99]] }, g);
  const exp = legacy(1146, 300, 2, 6, 0 + 1e9);
  close(exp.pitch, (1146 - 12) / 300);
  close(fitAlteredView(f.data, f.order, f.vg, 1146, 6).zoom, exp.pitch);
});

test("11b: span crossing two group gaps, SHOW_GAPS_PERCENT gap=50 -> numerator W-100 (P/oncoprintmodel.ts:846-851, 1174-1186)", () => {
  const g = [ids(100, 0), ids(100, 100), ids(100, 200)];
  const f = figure({ groups: g, altered: [g[0][0], g[2][99]] }, g);
  const exp = legacy(1146, 300, 2, 50, 1e9);
  close(exp.pitch, (1146 - 100) / 300);
  close(fitAlteredView(f.data, f.order, f.vg, 1146, 50).zoom, exp.pitch);
});

test("12a: span inside group 2, no gap in [min,max+1) -> fit to the span alone (P/oncoprintmodel.ts:846-851)", () => {
  const g = [ids(200, 0), ids(200, 200)];
  const f = figure({ groups: g, altered: [g[1][50], g[1][100]] }, g);
  const exp = legacy(300, 51, 0, 6, 1e9);
  close(fitAlteredView(f.data, f.order, f.vg, 300, 6).zoom, exp.pitch);
});

test("12b: span starting at group 2's first column counts the gap before it (filter g >= left_col_incl) (P/oncoprintmodel.ts:846-848)", () => {
  const g = [ids(200, 0), ids(200, 200)];
  const f = figure({ groups: g, altered: [g[1][0], g[1][50]] }, g);
  const exp = legacy(300, 51, 1, 6, 1e9);
  close(exp.pitch, (300 - 6) / 51);
  close(fitAlteredView(f.data, f.order, f.vg, 300, 6).zoom, exp.pitch);
});

test("12c: the initial fit does not move horizontal scroll (stays 0) even when the span starts in group 2 (P/oncoprint.ts:884-905)", () => {
  const g = [ids(200, 0), ids(200, 200)];
  const f = figure({ groups: g, altered: [g[1][50], g[1][100]] }, g);
  assert.equal(fitAlteredView(f.data, f.order, f.vg, 300, 6).scrollX, 0);
});

test("13: 10,000 columns all altered, W=1146 -> zn=0.0191, pitch 0.1146; min zoom not hit (P/oncoprintmodel.ts:921-923)", () => {
  const cols = ids(10000);
  const f = figure({ groups: [cols], altered: cols });
  const exp = legacy(1146, 10000, 0, 0, fullBase(10000));
  close(exp.z, 0.0191);
  close(fitAlteredView(f.data, f.order, f.vg, 1146, 0).zoom, exp.pitch);
});

test("14: tiny container (W=50, 100 altered) -> min zoom 100/fullBaseWidth: whole print ~100 base px, pitch 6*100/898 (P/oncoprintmodel.ts:921-923, 962-964)", { skip: "ours, docs/PORTAL-PARITY.md: the portal never zooms out past a 100 px print; ours fits a plot narrower than that" }, () => {
  const cols = ids(100);
  const f = figure({ groups: [cols], altered: cols });
  const exp = legacy(50, 100, 0, 0, fullBase(100));
  close(exp.pitch, 600 / 898);
  close(fitAlteredView(f.data, f.order, f.vg, 50, 0).zoom, exp.pitch);
});

// ---- 15-26: lifecycle and controls -----------------------------------------------------------

test("15: altered set changes while keep flag on -> re-fit (G/DeltaUtils.ts:101,303-311; P/oncoprint.ts:892-900)", { skip: "keep-flag lifecycle lives in OncoprintFigure.tsx; no exported function to drive" }, () => {});
test("16: altered set changes after the user zoomed -> no re-zoom (P/oncoprint.ts:897)", { skip: "component state; not expressible without a browser" }, () => {});
test("17: container width change with keep flag on -> re-fit (P/oncoprint.ts:592-597)", { skip: "component resize handling; not expressible without a browser" }, () => {});
test("18: sort / hide-unaltered / track change with ids unchanged -> no re-fit (P/oncoprint.ts:380,595,890,898)", { skip: "re-fit triggers live in the component; PR states it refits on Show unaltered / gaps, a stated difference to check in e2e" }, () => {});

test("19: altered ids non-contiguous after a sort -> fit [leftmost..rightmost] incl. interleaved unaltered (P/oncoprintmodel.ts:903-918)", { skip: "ours, as 7b: the span is right; the drawn width differs only by the portal dropping padding" }, () => {
  const cols = ids(600);
  const altered = [cols[0], cols[1]];
  // display: 10 unaltered, altered A, 489 unaltered, altered B, rest unaltered -> span positions 10..500, n=491
  const unaltered = cols.slice(2);
  const display = [...unaltered.slice(0, 10), altered[0], ...unaltered.slice(10, 499), altered[1], ...unaltered.slice(499)];
  const f = figure({ groups: [cols], altered }, [display]);
  const exp = legacy(1146, 491, 0, 0, fullBase(600));
  close(fitAlteredView(f.data, f.order, f.vg, 1146, 0).zoom, exp.pitch);
});

test("20: altered id hidden (not in the visible index map) (P/oncoprintmodel.ts:908-918)", { skip: "legacy yields NaN: no defined behaviour to test against" }, () => {});
test("21: user scrolls -> keep flag cleared (P/oncoprint.ts:495-506)", { skip: "component state; not expressible without a browser" }, () => {});
test("22: slider / % box / +- buttons: centred, x0.7 steps, linear slider (G/controls/OncoprintControls.tsx:239-243,1268-1290; P/oncoprint.ts:950-980)", { skip: "toolbar controls; PR defers the % box (ONC-ZM-1) and documents a log-scaled slider" }, () => {});
test("23: zoom-to-fit button fits the stored altered ids and scrolls to them (P/oncoprint.ts:379-391)", { skip: "button handler in the component; PR documents that ours still fits every column (deliberate divergence)" }, () => {});
test("24: drag-select zoom (P/oncoprint.ts:313-326)", { skip: "not implemented (PR follow-ups); no API" }, () => {});
test("25: minimap viewport drag (P/oncoprint.ts:1116-1135)", { skip: "no minimap (ONC-MM is a follow-up); no API" }, () => {});
test("26: WebGL unavailable -> no-op (P/oncoprint.ts:885-887)", { skip: "ours is a 2D canvas; no WebGL path" }, () => {});
