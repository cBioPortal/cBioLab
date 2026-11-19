// Audit of PR #200 (OncoPrint heatmap ramps, ranges, patient aggregation) against the case table
// written from the legacy source (cbioportal-frontend cd8c6df). Row ids are the table's:
//   DU = src/shared/components/oncoprint/DataUtils.ts, OU = .../OncoprintUtils.ts,
//   RS = packages/oncoprintjs/src/js/oncoprintruleset.ts, BS = .../binarysearch.ts,
//   GAC = src/shared/cache/GenericAssayMolecularDataCache.ts.
//
// The patient aggregation is SQL, so section A runs heatmapSql / assayHeatmapSql on a scratch
// ClickHouse (clickhouse local, the pinned binary `npm run local` downloads to ~/.cbiolab/bin) over
// tables holding just the rows each case needs, inserted in the order the case gives them.
// The colour rows are checked on every path that turns a value into a colour: the shared ramp
// (rampColor), the engine's drawing code (assembleContract cell -> heatColor), the server SVG
// (contractToSvg) and the browser canvas (draw).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { heatmapSql, assayHeatmapSql } from "../lib/oncoprint.ts";
import { assembleContract, type AssembleInput } from "../lib/oncoprint-assemble.ts";
import { STYLE, rampColor, heatColor } from "../lib/oncoprint-style.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";
import { draw, GEOM, rowTops, type VisibleGroup } from "../app/_oncoprint/canvas.ts";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";
import type { Contract } from "../lib/types.ts";

// ---------------------------------------------------------------------------------------------
// Section A harness: run the real SQL
// ---------------------------------------------------------------------------------------------
const CH = path.join(process.env.CBIOLAB_DATA || path.join(os.homedir(), ".cbiolab"), "bin", "clickhouse");
const noCh = existsSync(CH) ? false : "no ClickHouse binary at " + CH + " (npm run local downloads it)";

type Raw = string | null;   // the warehouse's text value; null = SQL NULL
const lit = (x: Raw) => (x === null ? "NULL" : "'" + x.replace(/'/g, "''") + "'");

function runCh(script: string): Record<string, unknown>[] {
  const out = execFileSync(CH, ["local", "--max_threads=1", "--multiquery", "--query", script], { encoding: "utf8" });
  return out.trim() ? out.trim().split("\n").map((l) => JSON.parse(l)) : [];
}

/** a gene heatmap (expression profile): rows of one patient P1, samples S1..Sn in the given order */
function geneAgg(values: Raw[], unit: "patient" | "sample" = "patient"): number | null | undefined {
  const ins = values.map((v, i) => `('s', 'mrna_z', 'TP53', 's_S${i + 1}', ${lit(v)})`).join(", ");
  const samples = values.map((_, i) => `('s_S${i + 1}', 's_P1')`).join(", ");
  const rows = runCh(`
    CREATE DATABASE db;
    CREATE TABLE db.genetic_alteration_derived (cancer_study_identifier String, profile_type String, hugo_gene_symbol String,
      sample_unique_id String, alteration_value Nullable(String)) ENGINE = Memory;
    CREATE TABLE db.sample_derived (sample_unique_id String, patient_unique_id String) ENGINE = Memory;
    INSERT INTO db.genetic_alteration_derived VALUES ${ins};
    INSERT INTO db.sample_derived VALUES ${samples};
    ${heatmapSql("mrna_z", ["TP53"], "s", "db", unit)} FORMAT JSONEachRow;`);
  return pick(rows, unit === "patient" ? "P1" : "S1", "TP53");
}

/** a generic-assay heatmap: rows of one patient P1, samples S1..Sn in the given order */
function assayAgg(values: Raw[]): number | null | undefined {
  const ins = values.map((v, i) => `('sig', 's_sig', 'e1', 's_P1', 's_S${i + 1}', ${lit(v)})`).join(", ");
  const rows = runCh(`
    CREATE DATABASE db;
    CREATE TABLE db.generic_assay_data_derived (profile_type String, profile_stable_id String, entity_stable_id String,
      patient_unique_id String, sample_unique_id String, value Nullable(String)) ENGINE = Memory;
    CREATE TABLE db.sample_derived (sample_unique_id String, patient_unique_id String) ENGINE = Memory;
    INSERT INTO db.generic_assay_data_derived VALUES ${ins};
    ${assayHeatmapSql("sig", ["e1"], "s", "db", "patient")} FORMAT JSONEachRow;`);
  return pick(rows, "P1", "e1");
}

/** undefined = no row (the column has no value: drawn as no data) */
function pick(rows: Record<string, unknown>[], pid: string, gene: string): number | null | undefined {
  const r = rows.filter((x) => x.pid === pid && x.gene === gene);
  assert.ok(r.length <= 1, "one row per (column, gene)");
  if (!r.length) return undefined;
  const v = r[0].v;
  if (v === null) return null;
  return typeof v === "number" ? v : Number(v);   // JSONEachRow may quote inf/nan
}

const tA = (name: string, fn: () => void, opts: { todo?: string } = {}): void => { void test(name, { skip: noCh, ...opts }, fn); };

// ---------------------------------------------------------------------------------------------
// A. Aggregation (DU fillHeatmapTrackDatum 385-520)
// ---------------------------------------------------------------------------------------------
test("A1: cases list empty -> legacy draws no track data; ours refuses loudly, as CLAUDE.md invariant 1 documents (DU:607-609)", () => {
  // documented divergence: an empty cohort is a loud rejection, never an empty figure
  assert.throws(() => assembleContract({ genes: ["G"], groups: [{ name: "all", pids: [] }], studies: ["s"], events: [], coverage: [],
    isDriver: () => false, annotationSource: "t", clinical: [], derived: [], sort: [], lineGap: 0,
    heatmap: [{ profileType: "mrna_z", genes: ["G"], isVaf: false, values: new Map() }] }), /cohort is empty/);
});

tA("A2: patient with no data rows -> no value (DU:397-404)", () => {
  // P1 has a row for another gene only
  const rows = runCh(`
    CREATE DATABASE db;
    CREATE TABLE db.genetic_alteration_derived (cancer_study_identifier String, profile_type String, hugo_gene_symbol String,
      sample_unique_id String, alteration_value Nullable(String)) ENGINE = Memory;
    CREATE TABLE db.sample_derived (sample_unique_id String, patient_unique_id String) ENGINE = Memory;
    INSERT INTO db.genetic_alteration_derived VALUES ('s', 'mrna_z', 'KRAS', 's_S1', '1');
    INSERT INTO db.sample_derived VALUES ('s_S1', 's_P1');
    ${heatmapSql("mrna_z", ["TP53"], "s", "db", "patient")} FORMAT JSONEachRow;`);
  assert.equal(pick(rows, "P1", "TP53"), undefined);
});

tA("A3: rows exist but all NaN -> no value (NA) (DU:397-404)", () => {
  assert.equal(geneAgg(["NA", "NaN"]), undefined);
});

tA("A4: one row value=null -> no value (DU:405-409)", () => {
  // legacy's na=false vs A3's na=true (null colour vs NA) is the #e0e0e0 null state PR #200 left out; only the value is checked
  assert.equal(geneAgg([null]), undefined);
});

tA("A5: one row 1.7 -> 1.7 (DU:410-412)", () => {
  assert.equal(geneAgg(["1.7"]), 1.7);
});

tA("A6: one generic-assay row '>8' -> 8 (DU:413-422, GAC:80-92)", () => {
  // thresholdType/category are not carried by our contract; the value is
  assert.equal(assayAgg([">8"]), 8);
}, { todo: "threshold values (\">8\") are not read: 4 in the warehouse, all one BLOOD_MEASUREMENTS profile (docs/PORTAL-PARITY.md)" });

tA("A7: one generic-assay row '<0' -> 0 (DU:416-421)", () => {
  assert.equal(assayAgg(["<0"]), 0);
}, { todo: "threshold values (\">8\") are not read: 4 in the warehouse, all one BLOOD_MEASUREMENTS profile (docs/PORTAL-PARITY.md)" });

test("A8: sample with two rows throws in legacy (DU:425-428)", { skip: "legacy throws an Error; our SQL groups by sample and has no error path to assert against" }, () => {});

tA("A9: patient rows [NaN, 2] -> 2 (DU:397-400, 410)", () => {
  assert.equal(geneAgg(["NaN", "2"]), 2);
});

tA("A10: patient rows [null, null] -> no value (DU:432-438)", () => {
  assert.equal(geneAgg([null, null]), undefined);
});

tA("A11: patient rows [null, 1.5] -> 1.5 (DU:432-434)", () => {
  assert.equal(geneAgg([null, "1.5"]), 1.5);
});

tA("A12: patient rows [1, 3, 2] -> 3, max abs (DU:466-475)", () => {
  assert.equal(geneAgg(["1", "3", "2"]), 3);
  assert.equal(assayAgg(["1", "3", "2"]), 3, "generic assay too");
});

tA("A13: patient rows [-5, 2] -> -5 (DU:468-475, 482-484, 510)", () => {
  assert.equal(geneAgg(["-5", "2"]), -5);
  assert.equal(assayAgg(["-5", "2"]), -5, "generic assay too");
});

tA("A14 (ours, docs/PORTAL-PARITY.md): patient rows [2, -5] -> -5, the value furthest from 0; the portal's signed-vs-abs bug gives its first row, 2 (DU:468-475, 482-484, 510)", () => {
  assert.equal(geneAgg(["2", "-5"]), -5);
  assert.equal(assayAgg(["2", "-5"]), -5, "generic assay too");
});

tA("A15 (ours, as A14): patient rows [1, -5, 4] -> -5; the portal gives 1 (DU:468-475, 482-484, 510)", () => {
  assert.equal(geneAgg(["1", "-5", "4"]), -5);
});

tA("A16: tie, rows [3, -3] -> 3 (DU:468-475, 512-519)", () => {
  assert.equal(geneAgg(["3", "-3"]), 3);
});

tA("A17 (ours, docs/PORTAL-PARITY.md): a ± tie is the positive value whatever the row order; the portal takes its first row, -3 (DU:482-484)", () => {
  assert.equal(geneAgg(["-3", "3"]), 3);
  assert.equal(assayAgg(["-3", "3"]), 3, "generic assay too");
});

tA("A18: tie with threshold, generic-assay rows ['>3', '3'] -> 3 from the non-threshold row (DU:514-517)", () => {
  assert.equal(assayAgg([">3", "3"]), 3);
});

tA("A19: generic-assay rows ['>3', '1'] -> 3 (DU:518-519, 489-496)", () => {
  assert.equal(assayAgg([">3", "1"]), 3);
});

tA("A20: generic-assay rows ['<-4', '1'] -> -4 (DU:482-496)", () => {
  assert.equal(assayAgg(["<-4", "1"]), -4);
});

tA("A21 (ours, as A14): generic-assay rows ['1', '<-4'] -> -4, the value furthest from 0; the portal's signed-vs-abs bug gives its first row, 1 (DU:482-484)", () => {
  assert.equal(assayAgg(["1", "<-4"]), -4);
});

tA("A22: patient rows [0, 0] -> 0 (DU:466-475)", () => {
  assert.equal(geneAgg(["0", "0"]), 0);
});

test("A23: sortOrder ASC -> min (DU:444-453)", { skip: "unreachable in legacy: no caller passes sortOrder (A25); our product has no per-track aggregation sortOrder" }, () => {});
test("A24: sortOrder DESC -> max (DU:454-463)", { skip: "unreachable in legacy: no caller passes sortOrder (A25); our product has no per-track aggregation sortOrder" }, () => {});

tA("A25: generic assay uses the abs rule regardless of sortOrder, rows [2, -1, 5] -> 5 (OU:1922-1934, DU:640-646)", () => {
  assert.equal(assayAgg(["2", "-1", "5"]), 5);
});

tA("A26: generic-assay rows ['Infinity', '2'] -> Infinity (DU:397-400, 468)", () => {
  // +"Infinity" is Infinity in legacy; isNaN(Infinity) is false, so the row is kept and wins on abs
  assert.equal(assayAgg(["Infinity", "2"]), Infinity);
}, { todo: "Infinity is not read as a number; none in the warehouse (docs/PORTAL-PARITY.md)" });

tA("A27: generic-assay rows ['-Infinity', '2'] -> 2, legacy bug as A14 (DU:482-484)", () => {
  assert.equal(assayAgg(["-Infinity", "2"]), 2);
});

// ---------------------------------------------------------------------------------------------
// B. String -> number
// ---------------------------------------------------------------------------------------------
tA("B1: generic assay '>8' -> 8 (GAC:80-92, OU:1928-1931)", () => {
  assert.equal(assayAgg([">8"]), 8);
}, { todo: "threshold values (\">8\") are not read: 4 in the warehouse, all one BLOOD_MEASUREMENTS profile (docs/PORTAL-PARITY.md)" });

tA("B2: generic assay '< 0.0015' -> 0.0015 (GAC:80-92)", () => {
  assert.equal(assayAgg(["< 0.0015"]), 0.0015);
}, { todo: "threshold values (\">8\") are not read: 4 in the warehouse, all one BLOOD_MEASUREMENTS profile (docs/PORTAL-PARITY.md)" });

tA("B3: generic assay '-2.5' -> -2.5 (GAC:80)", () => {
  assert.equal(assayAgg(["-2.5"]), -2.5);
});

tA("B4: generic assay '>=8' -> no value; '1e-5' -> 0.00001 (GAC:80, OU:1930)", () => {
  assert.equal(assayAgg([">=8"]), undefined, "+'>=8' is NaN: dropped");
  assert.equal(assayAgg(["1e-5"]), 0.00001);
});

tA("B5: generic assay 'NA' -> no value (OU:1930, DU:397)", () => {
  assert.equal(assayAgg(["NA"]), undefined);
});
tA("B5 (ours, docs/PORTAL-PARITY.md): generic assay '' -> no value; the portal's +'' would be 0 if its API passes the empty value on (OU:1930, DU:397)", () => {
  assert.equal(assayAgg([""]), undefined);
});

test("B6: geneset value '1.2' -> 1.2 (OU:2668-2672)", { skip: "no geneset (GSVA) heatmap source in our product: heatmapSql reads gene profiles, assayHeatmapSql generic assays" }, () => {});

// ---------------------------------------------------------------------------------------------
// Rendering harness: one figure, one gene row and one heatmap row
// ---------------------------------------------------------------------------------------------
const base = (pids: string[]): AssembleInput => ({
  genes: ["G"], groups: [{ name: "all", pids }], studies: ["s"], events: [], coverage: pids.map((pid) => ({ pid, genes: ["G"] })),
  isDriver: () => false, annotationSource: "t", clinical: [], heatmap: [], derived: [], sort: [], lineGap: 0
});

function heatContract(profileType: string, vals: (number | null)[], opts: { isVaf?: boolean; assay?: boolean } = {}): Contract {
  const pids = vals.map((_, i) => "C" + String(i).padStart(2, "0"));
  const gene = opts.assay ? "e1" : "G";
  const values = new Map<string, number>();
  vals.forEach((v, i) => { if (v !== null) values.set(pids[i] + "|" + gene, v); });
  return assembleContract({ ...base(pids), heatmap: [{ profileType, genes: [gene], isVaf: !!opts.isVaf, assay: opts.assay, values }] });
}
const heatTrack = (c: Contract) => c.tracks.find((t) => t.kind === "heatmap")!;

function hex(color: string): string {
  const m = /^rgba?\((-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)/.exec(color);
  if (!m) return color.toLowerCase();
  return "#" + [m[1], m[2], m[3]].map((x) => Math.max(0, Math.min(255, Math.round(+x))).toString(16).padStart(2, "0")).join("");
}

/** the colour of the single heatmap cell, on every path */
function colours(profileType: string, v: number, opts: { isVaf?: boolean } = {}) {
  const c = heatContract(profileType, [v], opts);
  const t = heatTrack(c);
  const engine = hex(heatColor(t as never, t.cells[0] as number));
  // SVG: the cells are row-height rects; the heatmap row is the second distinct y
  const svg = contractToSvg(c);
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="([^"]+)"/g)]
    .map((m) => ({ y: +m[2], h: +m[4], fill: m[5] })).filter((r) => r.h === STYLE.geometry.rowH);
  const ys = [...new Set(rects.map((r) => r.y))].sort((a, b) => a - b);
  const svgFill = hex(rects.find((r) => r.y === ys[c.tracks.indexOf(t)])!.fill);
  // canvas: record fillStyle at each fillRect
  const buf = packContract(c);
  const data = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const fills: { y: number; h: number; x: number; style: string }[] = [];
  let style = "";
  const ctx = new Proxy({}, {
    get(_t, k) {
      if (k === "getTransform") return () => ({ a: 1 });
      if (k === "fillRect") return (x: number, y: number, _w: number, h: number) => fills.push({ x, y, h, style });
      if (k === "measureText") return () => ({ width: 10 });
      if (k === "fillStyle") return style;
      return () => {};
    },
    set(_t, k, val) { if (k === "fillStyle") style = String(val); return true; }
  }) as unknown as CanvasRenderingContext2D;
  const groups: VisibleGroup[] = [{ name: "all", start: 0, count: 1, patients: 1 }];
  draw(ctx, data, Uint32Array.from([0]), groups, { zoom: 10, scrollX: 0, whitespace: true }, 1200, undefined, { gap: 0 });
  const ti = data.tracks.findIndex((x: { kind: string }) => x.kind === "heatmap");
  const rowY = rowTops(data.tracks)[ti];
  const cell = fills.filter((f) => f.h === GEOM.rowH && Math.abs(f.y - rowY) < 1e-9 && f.x >= GEOM.gutter);
  assert.ok(cell.length >= 1, "canvas drew the heatmap cell");
  const canvas = hex(cell[0].style);
  return { engine, svg: svgFill, canvas };
}

const RAMP = { expression: STYLE.ramps.expression, methylation: STYLE.ramps.methylation, vaf: STYLE.ramps.vaf };
/**
 * The ramp is exact. A drawn cell carries its value as one of 256 codes, so the colour drawn is
 * within one unit per channel of the ramp's (ours, docs/PORTAL-PARITY.md: 0 on −3…3 is code 128,
 * drawn #010000).
 */
function colourCase(ramp: keyof typeof RAMP, profileType: string, v: number, want: string, opts: { isVaf?: boolean } = {}) {
  assert.equal(hex(rampColor(RAMP[ramp], v)), want, "rampColor");
  const got = colours(profileType, v, opts);
  const near = (h: string, where: string) => {
    const ch = (x: string) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
    const [a, b] = [ch(h), ch(want)];
    assert.ok(a.every((x, i) => Math.abs(x - b[i]) <= 1), where + ": " + h + " is not within one unit per channel of " + want);
  };
  near(got.engine, "engine cell code -> heatColor");
  near(got.svg, "server SVG");
  near(got.canvas, "browser canvas");
}

// ---------------------------------------------------------------------------------------------
// C. Rule set params (OU getHeatmapTrackRuleSetParams 220-286)
// ---------------------------------------------------------------------------------------------
test("C1: generic assay delegates to its own (data-scaled) rule set, not a fixed ramp (OU:231-232)", () => {
  const t = heatTrack(heatContract("mutational_signatures_contribution_SBS", [1, 4], { assay: true }));
  assert.equal(t.ramp, undefined, "no fixed expression/methylation/vaf ramp");
});

test("C2: methylation -> range [0,1], ramp stops [0,0.35,1] blue/white/red (OU:233-242)", () => {
  for (const p of ["methylation_hm450", "methylation_hm27"]) {
    const t = heatTrack(heatContract(p, [0.2, 0.9]));
    assert.deepEqual([t.ramp, t.min, t.max], ["methylation", 0, 1], p);
  }
  assert.deepEqual(STYLE.ramps.methylation, { stops: [0, 0.35, 1], colors: [[0, 0, 255], [255, 255, 255], [255, 0, 0]] });
});

test("C3: VAF -> range [0,1], #f1f2b5 -> #135058 (OU:243-252)", () => {
  const t = heatTrack(heatContract("mutations", [0.2, 0.4], { isVaf: true }));
  assert.deepEqual([t.ramp, t.min, t.max], ["vaf", 0, 1]);
  assert.deepEqual(STYLE.ramps.vaf, { stops: [0, 1], colors: [[0xf1, 0xf2, 0xb5], [0x13, 0x50, 0x58]] });
});

test("C3b: VAF null label 'Not mutated/no VAF data', NA label 'Not profiled' (OU:243-252)", { skip: "VAF's null state is left out in PR #200 and docs/PORTAL-PARITY.md (open item)" }, () => {});

test("C4: every other profile (mRNA z/raw, protein, CNA, geneset) -> range [-3,3], #0000ff/#000000/#ff0000 (OU:254-263)", () => {
  for (const p of ["rna_seq_v2_mrna_median_Zscores", "rna_seq_v2_mrna", "mrna", "rppa", "rppa_Zscores", "protein_quantification",
    "linear_CNA", "gsva_scores"]) {
    const t = heatTrack(heatContract(p, [120, 4000, -50]));
    assert.deepEqual([t.ramp, t.min, t.max], ["expression", -3, 3], p);
  }
  assert.deepEqual(STYLE.ramps.expression, { stops: [-3, 0, 3], colors: [[0, 0, 255], [0, 0, 0], [255, 0, 0]] });
});

test("C5: trackSpec.legendLabel overrides the legend label (OU:235/245/256)", { skip: "no legend-label override in our heatmap spec" }, () => {});
test("C6: null colour #e0e0e0 (OU:273-275)", { skip: "the #e0e0e0 null colour is left out in PR #200 and docs/PORTAL-PARITY.md (open item)" }, () => {});
test("C7: null colour #ffffff with white background for glyphs (OU:273-282)", { skip: "null colour left out in PR #200 (as C6)" }, () => {});
test("C8: null_color omitted -> #d3d3d3 (RS:943)", { skip: "direct oncoprintjs use only; no counterpart" }, () => {});

test("C9: heatmap tracks are linear, never log scale (OU:265-283, RS:810)", () => {
  for (const [p, o] of [["rna_seq_v2_mrna", {}], ["methylation_hm450", {}], ["mutations", { isVaf: true }]] as const) {
    const t = heatTrack(heatContract(p, [0.1, 0.5, 100], o)) as { logScale?: boolean };
    assert.ok(!t.logScale, p);
  }
});

// ---------------------------------------------------------------------------------------------
// D. Gradient colour of a value (RS 925-1060, BS)
// ---------------------------------------------------------------------------------------------
const EXPR = "rna_seq_v2_mrna_median_Zscores", METH = "methylation_hm450";

test("D1: expression v=0 -> #000000 (RS:1012-1021)", () => colourCase("expression", EXPR, 0, "#000000"));
test("D2: expression v=1.5 -> #800000 (RS:961-971)", () => colourCase("expression", EXPR, 1.5, "#800000"));
test("D3: expression v=-1.5 -> #000080 (RS:961-971)", () => colourCase("expression", EXPR, -1.5, "#000080"));
test("D4: expression v=3 -> #ff0000, v=-3 -> #0000ff (RS:1012-1013)", () => {
  colourCase("expression", EXPR, 3, "#ff0000");
  colourCase("expression", EXPR, -3, "#0000ff");
});
test("D5: expression v=5 (above range) -> #ff0000, clamped (BS:29, RS:1005-1013)", () => colourCase("expression", EXPR, 5, "#ff0000"));
test("D6: expression v=-5 (below range) -> renders #0000ff (BS:29, RS:1016-1021)", () => colourCase("expression", EXPR, -5, "#0000ff"));
test("D7: expression v=Infinity -> #ff0000 (as D5)", () => {
  // the SQL drops non-finite values before they reach a cell, so only the shared ramp can see one
  assert.equal(hex(rampColor(STYLE.ramps.expression, Infinity)), "#ff0000");
});
test("D8: expression v=-Infinity -> NaN channels (RS:961-971)", { skip: "legacy output is an invalid fill (undefined rendering); nothing to assert" }, () => {});
test("D9: methylation v=0.35 -> #ffffff (OU:236)", () => colourCase("methylation", METH, 0.35, "#ffffff"));
test("D10: methylation v=0.175 -> #8080ff (RS:961-971)", () => colourCase("methylation", METH, 0.175, "#8080ff"));
// the table says #ff8080; legacy's own arithmetic (RS:965-975 linInterpColors after RS:1016-1021) gives
// interval_t = (0.675 - 0.35) / 0.65 = 0.5000000000000001 in doubles, so 127.4999... rounds to 127: #ff7f7f
test("D11: methylation v=0.675 -> #ff7f7f (RS:965-975, 1016-1021; table corrected)", () => colourCase("methylation", METH, 0.675, "#ff7f7f"));
test("D12: methylation v=0 / 1 / 1.4 -> #0000ff / #ff0000 / #ff0000 (as D5)", () => {
  colourCase("methylation", METH, 0, "#0000ff");
  colourCase("methylation", METH, 1, "#ff0000");
  colourCase("methylation", METH, 1.4, "#ff0000");
});
test("D13: methylation v=-0.5 -> renders #0000ff (as D6)", () => colourCase("methylation", METH, -0.5, "#0000ff"));
test("D14: VAF v=0 / 1 / 0.5 -> #f1f2b5 / #135058 / #82a187 (OU:248-251)", () => {
  colourCase("vaf", "mutations", 0, "#f1f2b5", { isVaf: true });
  colourCase("vaf", "mutations", 1, "#135058", { isVaf: true });
  colourCase("vaf", "mutations", 0.5, "#82a187", { isVaf: true });
});
test("D15: profile_data=null, na=false -> null colour (RS:947-961)", { skip: "the null colour / null state is left out in PR #200 (as C6)" }, () => {});

test("D16: a column with no value gets no gradient colour (RS:647-656)", () => {
  const c = heatContract(EXPR, [0.5, null]);
  const t = heatTrack(c);
  assert.equal(t.cells[1], -1, "no value: the no-data code");
  assert.equal(t.values![1], null);
  // the SVG fill of that cell is none of the ramp's colours
  const ramp = new Set(Array.from({ length: 601 }, (_, i) => hex(rampColor(STYLE.ramps.expression, -3 + i / 100))));
  const svg = contractToSvg(c);
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="([^"]+)"/g)]
    .map((m) => ({ x: +m[1], y: +m[2], h: +m[4], fill: m[5] })).filter((r) => r.h === STYLE.geometry.rowH);
  const ys = [...new Set(rects.map((r) => r.y))].sort((a, b) => a - b);
  const row = rects.filter((r) => r.y === ys[c.tracks.indexOf(t)]).sort((a, b) => a.x - b.x);
  assert.equal(row.length, 2);
  assert.ok(!ramp.has(hex(row[1].fill)), "no-data cell filled " + row[1].fill);
});

test("D17: a fixed range ignores the data's range (RS:853-866)", () => {
  const e = heatTrack(heatContract(EXPR, [-10, 25]));
  assert.deepEqual([e.min, e.max], [-3, 3]);
  const m = heatTrack(heatContract(METH, [0.4, 0.6]));
  assert.deepEqual([m.min, m.max], [0, 1]);
  const v = heatTrack(heatContract("mutations", [0.1, 0.2], { isVaf: true }));
  assert.deepEqual([v.min, v.max], [0, 1]);
});

test("D18: degenerate generic-assay range [0,0] -> t = NaN (RS:863-866)", { skip: "legacy output is undefined (NaN colour); nothing to assert" }, () => {});

// ---------------------------------------------------------------------------------------------
// E. Generic assay (OU getGenericAssayTrackRuleSetParams 316-480)
// ---------------------------------------------------------------------------------------------
test("E1: showAsBar, data [-2, 5] -> BAR, range [-2,5] (OU:322-344)", { skip: "generic-assay bar (ONC-TT-9) left out in PR #200" }, () => {});
test("E2: showAsBar, data [2, 5] -> range [0,5] (OU:337-343)", { skip: "generic-assay bar (ONC-TT-9) left out in PR #200" }, () => {});

test("E3: generic assay, data [-1, 4], no pivot -> range [-1,4] (OU:378-399)", () => {
  const t = heatTrack(heatContract("sig", [-1, 4], { assay: true }));
  assert.deepEqual([t.min, t.max], [-1, 4]);
  // colours #0072b2 -> #ccecff are ONC-TT-8, left out in PR #200
});

test("E4: generic assay, data [1, 4] (all non-negative), no pivot -> range [0,4] (OU:394-399, 404-413)", () => {
  const t = heatTrack(heatContract("sig", [1, 4], { assay: true }));
  assert.deepEqual([t.min, t.max], [0, 4], "the range always includes 0");
  // colours #ffffff -> #d55e00 are ONC-TT-8, left out in PR #200
});

test("E4b: generic assay, data [-4, -1] -> range [-4,0] (OU:394-399)", () => {
  const t = heatTrack(heatContract("sig", [-4, -1], { assay: true }));
  assert.deepEqual([t.min, t.max], [-4, 0], "the range always includes 0");
});

for (const [id, src] of [["E5", "OU:414-425"], ["E6", "OU:427-429"], ["E7", "OU:430-432"], ["E8", "OU:433-464"], ["E9", "OU:393-396, 427"], ["E10", "OU:467-470"]]) {
  test(`${id}: generic-assay pivot / sortOrder colours (${src})`, { skip: "generic-assay pivot and sort order (ONC-TT-8) left out in PR #200 and docs/PORTAL-PARITY.md" }, () => {});
}
test("E11: all-null generic assay, no min/max -> degenerate [0,0] (OU:381-399)", { skip: "legacy result is degenerate (D18); nothing defined to assert" }, () => {});
