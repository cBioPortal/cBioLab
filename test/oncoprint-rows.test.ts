// The OncoPrint's vertical layout (ONC-LY-1), from the legacy source (cbioportal-frontend @ cd8c6df):
//   OP  = src/shared/components/oncoprint/Oncoprint.tsx 306-307: CLINICAL_TRACK_GROUP_INDEX 0,
//         GENETIC_TRACK_GROUP_INDEX 1; heatmap tracks a group per molecular profile after them
//         (OncoprintUtils molecularProfileIdToAdditionalTracks[..].trackGroupIndex);
//   MU  = packages/oncoprintjs/src/js/modelutils.ts calculateTrackAndHeaderTops: tracks stacked
//         group by group, track_group_padding after each non-empty group;
//   OM  = packages/oncoprintjs/src/js/oncoprintmodel.ts 395: track_group_padding 10.
// Cases:
//   R1  one group: rows one after another, no gap
//   R2  clinical then genes: the gap once, between them (Profiled rows are clinical; derived
//       events are genetic)
//   R3  each heatmap profile is its own group: a gap before each profile, none within one
//   R4  the last entry is where the last row ends; no tracks: the header alone
//   R5  a y finds its row; a row gap or a group gap finds none; the row's bottom edge is in it
//   R6  the shared style's gap is the portal's 10 px, and every renderer reads it (SVG height grows by it)
//   R7  a heatmap gene with no data (its "(no data)" row) stays in its profile's group, as the portal
//       keeps it among the profile's tracks; the Python port gives the same keys and tops
//       (test/fixtures/oncoprint/track-groups.json, python/tests/test_track_groups.py)
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import * as rows from "../lib/oncoprint-rows.ts";
import { STYLE } from "../lib/oncoprint-style.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";
import { assembleContract, type AssembleInput } from "../lib/oncoprint-assemble.ts";
import { readFileSync } from "node:fs";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";

const r = rows as unknown as Record<string, any>;
const G = { header: 22, rowH: 20, rowGap: 3, trackGroupGap: 10 };
const clin = { kind: "clinical" }, gene = { kind: "gene" }, derived = { kind: "derivedEvent" };
const heat = (p: string) => ({ kind: "heatmap", profileType: p });

describe("R1-R4: each track's top", () => {
  test("R1 one group: no gap", () => {
    assert.deepEqual(r.trackTops([gene, gene, derived], G), [22, 45, 68, 91]);
  });
  test("R2 clinical then genetic: one gap between", () => {
    assert.deepEqual(r.trackTops([clin, clin, gene, gene], G), [22, 45, 78, 101, 124]);
  });
  test("R3 a gap before each heatmap profile, none within one", () => {
    assert.deepEqual(r.trackTops([gene, heat("mrna"), heat("mrna"), heat("methylation")], G), [22, 55, 78, 111, 134]);
    assert.deepEqual([clin, gene, derived, heat("a")].map(r.trackGroupKey), ["clinical", "genetic", "genetic", "heatmap:a"]);
  });
  test("R4 no tracks: the header alone", () => {
    assert.deepEqual(r.trackTops([], G), [22]);
  });
});

describe("R5: the track at a y", () => {
  const tops = [22, 45, 78, 101, 124];
  test("inside a row, at its edges", () => {
    assert.deepEqual([22, 42, 45, 80, 101, 121].map((y) => r.trackAtY(y, tops, 20)), [0, 0, 1, 2, 3, 3]);
  });
  test("a row gap, the group gap, above and below: none", () => {
    assert.deepEqual([43, 66, 70, 10, 122, 500].map((y) => r.trackAtY(y, tops, 20)), [-1, -1, -1, -1, -1, -1]);
  });
});

describe("R6: the style's gap reaches the renderers", () => {
  test("10 px, the portal's track_group_padding", () => {
    assert.equal((STYLE.geometry as any).trackGroupGap, 10);
  });
  test("the server SVG is one gap taller with a clinical row over the genes", () => {
    const base = {
      study: "s", unit: "patient", groups: [{ name: "all", start: 0, count: 2 }], columns: ["P1", "P2"],
      conventions: { cna: "", notProfiled: "", frequencyDenominator: "", annotation: "", lineGap: 0, sort: [] }, stats: {}
    };
    const g = { kind: "gene", label: "TP53", cells: [0, 0], freqPct: 0 };
    const c = { kind: "clinical", label: "SEX", cells: [-1, -1], categories: [] };
    const height = (tracks: object[]) => Number(/height="(\d+(?:\.\d+)?)"/.exec(contractToSvg({ ...base, tracks } as any))![1]);
    const twoGenes = height([g, { ...g, label: "KRAS" }]), clinGene = height([c, g]);
    assert.equal(clinGene - twoGenes, 10);
    assert.match(contractToSvg({ ...base, tracks: [c, g] } as any), /<text x="4" y="69"/);
  });
});

describe("R7: a heatmap gene with no data stays in its profile", () => {
  const fix = JSON.parse(readFileSync(new URL("./fixtures/oncoprint/track-groups.json", import.meta.url), "utf8"));
  test("the shared fixture's keys and tops (the Python port reads the same file)", () => {
    assert.deepEqual(fix.tracks.map(r.trackGroupKey), fix.keys);
    assert.deepEqual(r.trackTops(fix.tracks, { ...G, header: 0 }), fix.tops);
  });
  test("the engine's (no data) row names its profile, so no gap splits the profile", () => {
    const pids = ["P1", "P2"];
    const c = assembleContract({
      genes: ["KRAS", "NRAS", "TP53"], groups: [{ name: "all", pids }], studies: ["s"], events: [],
      coverage: pids.map((pid) => ({ pid, genes: ["KRAS", "NRAS", "TP53"] })), isDriver: () => false, annotationSource: "t",
      clinical: [], derived: [], sort: [{ track: "genomic", dir: "asc" }], lineGap: 90,
      heatmap: [{ profileType: "mrna_zscore", genes: ["KRAS", "NRAS", "TP53"], isVaf: false,
        values: new Map([["P1|KRAS", 1], ["P2|KRAS", -1], ["P1|TP53", 0.5]]) }]
    } as unknown as AssembleInput);
    const heat = c.tracks.filter((t) => t.kind === "heatmap" || / \(no data\)$/.test(t.label));
    assert.deepEqual(heat.map((t) => / \(no data\)$/.test(t.label)), [false, true, false]);
    assert.deepEqual([...new Set(heat.map(r.trackGroupKey))], ["heatmap:mrna_zscore"]);
    // the browser draws the unpacked contract: the row's profile survives packing
    const buf = packContract(c);
    const u = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    assert.deepEqual(u.tracks.map(r.trackGroupKey), c.tracks.map(r.trackGroupKey));
  });
});
