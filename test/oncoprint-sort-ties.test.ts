// OncoPrint column sort: how ties are broken, and how a text track sorts, from the case table
// (rows T1-T11, S1-S7) and the legacy source it cites, at cbioportal-frontend cd8c6df:
//   SU = src/shared/components/oncoprint/SortUtils.ts
//   NS = node_modules/javascript-natural-sort/naturalSort.js (0.7.1)
//   PC = packages/oncoprintjs/src/js/precomputedcomparator.ts
//   OM = packages/oncoprintjs/src/js/oncoprintmodel.ts sortByTracks
//   BS = packages/oncoprintjs/src/js/bucketsort.ts stringToVector
// Each row is run twice: in the engine (assembleContract) and in the browser's re-sort (sortColumns).
// Every fixture has no alterations and every column profiled, so the genomic staircase ties
// everywhere and only the rule under test can order the columns.
//
// The ids S-1, S-2, S-09, S-10 are where the two id orders disagree:
//   naturalSort (NS 31-37: "09" keeps its leading zero, so it is a string, compared as "09" < "1")
//     ascending  S-09, S-1, S-2, S-10
//   stringToVector (BS 116-148: 09 is the number 9)
//     ascending  S-1, S-2, S-09, S-10
//
// The last block is the conformance test for the TypeScript port of javascript-natural-sort: the
// real library's answers over a broad set of value pairs are recorded in
// test/fixtures/golden/natural-sort.json; RECORD_NATURAL_SORT=1 rewrites that file from
// ~/cbioportal-frontend (or CBIOPORTAL_FRONTEND). python/tests/test_sort_ties.py reads the same file.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { assembleContract, type AssembleInput } from "../lib/oncoprint-assemble.ts";
import { sortColumns } from "../app/_oncoprint/canvas.ts";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";
import { naturalSort } from "../lib/oncoprint-style.ts";

type Dir = "asc" | "desc";
type Key = { track: string; dir: Dir };
interface Fixture {
  pids: string[];
  clinical?: { attr: string; values: Map<string, string> }[];
  heatmap?: AssembleInput["heatmap"];
  derived?: { label: string; pids: Set<string> }[];
  studies?: string[];
  studyOf?: Map<string, string>;
}

const contract = (f: Fixture, sort: Key[]) => assembleContract({
  genes: ["TP53"], groups: [{ name: "all", pids: f.pids }], studies: f.studies ?? ["s"], ...(f.studyOf ? { studyOf: f.studyOf } : {}),
  events: [], coverage: f.pids.map((pid) => ({ pid, genes: ["TP53"] })), isDriver: () => false, annotationSource: "t",
  clinical: f.clinical ?? [], heatmap: f.heatmap ?? [], derived: f.derived ?? [], sort, lineGap: 0 });

/** the engine's column order for these sort keys */
const engine = (f: Fixture, keys: Key[]): string[] => contract(f, keys).columns;

/** the browser's re-sort of an engine contract (assembled by id) for these sort keys */
function browser(f: Fixture, keys: Key[]): string[] {
  const buf = packContract(contract(f, [{ track: "id", dir: "asc" }]));
  const data = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const order = Uint32Array.from({ length: data.n }, (_, i) => i), ids = data.columns();
  return Array.from(sortColumns(data, order, [{ name: "all", start: 0, count: data.n, patients: data.n }], keys), (i) => ids[i]);
}

const WHERE = { engine, browser } as const;
const each = (name: string, fn: (sort: (f: Fixture, keys: Key[]) => string[]) => void) => {
  for (const [where, sort] of Object.entries(WHERE)) test(name + " [" + where + "]", () => fn(sort));
};

// ---- fixtures -----------------------------------------------------------------------------------
const IDS = ["S-2", "S-10", "S-1", "S-09"];                   // fetch order deliberately neither id order
const same = (pids: string[], v: string) => new Map(pids.map((p): [string, string] => [p, v]));
const textTie = (attr = "TYPE", v = "x"): Fixture => ({ pids: IDS, clinical: [{ attr, values: same(IDS, v) }] });
// a numeric track (11 distinct values, > 10) on which the four S ids tie at 50
const NUMS = Array.from({ length: 11 }, (_, i) => "N" + String(i + 1).padStart(2, "0"));
const numericTie: Fixture = { pids: [...NUMS.slice(0, 5), ...IDS, ...NUMS.slice(5)],
  clinical: [{ attr: "TMB", values: new Map([...NUMS.map((p, i): [string, string] => [p, String(i * 10 + 1)]), ...IDS.map((p): [string, string] => [p, "50"])]) }] };
const onlyS = (cols: string[]) => cols.filter((p) => p.startsWith("S-"));

// ---- T: ties ------------------------------------------------------------------------------------

each("T1: a tie on every key, the first track key ascending: ids by naturalSort ascending (SU alphabeticalDefault 363-374)", (sort) => {
  // SU 368: naturalSort(d1.sample, d2.sample); NS 37: "09" < "1" as strings
  assert.deepEqual(sort(textTie(), [{ track: "TYPE", dir: "asc" }]), ["S-09", "S-1", "S-2", "S-10"], "text track");
  assert.deepEqual(onlyS(sort(numericTie, [{ track: "TMB", dir: "asc" }])), ["S-09", "S-1", "S-2", "S-10"], "numeric track, tied at 50");
  const derived: Fixture = { pids: IDS, derived: [{ label: "treated", pids: new Set(IDS) }] };
  assert.deepEqual(sort(derived, [{ track: "treated", dir: "asc" }]), ["S-09", "S-1", "S-2", "S-10"], "derived track, all in the set");
});

each("T2: a tie on every key, the first track key descending: ids by naturalSort descending (PC makeDirectedComparator 67-79)", (sort) => {
  // PC 77: res * sort_direction, applied to the whole preferred comparison, id included
  assert.deepEqual(sort(textTie(), [{ track: "TYPE", dir: "desc" }]), ["S-10", "S-2", "S-1", "S-09"], "text track");
  assert.deepEqual(onlyS(sort(numericTie, [{ track: "TMB", dir: "desc" }])), ["S-10", "S-2", "S-1", "S-09"], "numeric track, tied at 50");
  const derived: Fixture = { pids: IDS, derived: [{ label: "treated", pids: new Set(IDS) }] };
  assert.deepEqual(sort(derived, [{ track: "treated", dir: "desc" }]), ["S-10", "S-2", "S-1", "S-09"], "derived track, all in the set");
});

each("T3: two track keys tied on both: the first key's direction decides (OM getVector 2442-2453)", (sort) => {
  // OM 2453: every mandatory value, then every preferred value in priority order; A's preferred comes first
  const f: Fixture = { pids: IDS, clinical: [{ attr: "A", values: same(IDS, "x") }, { attr: "B", values: same(IDS, "y") }] };
  assert.deepEqual(sort(f, [{ track: "A", dir: "desc" }, { track: "B", dir: "asc" }]), ["S-10", "S-2", "S-1", "S-09"], "A desc, B asc");
  assert.deepEqual(sort(f, [{ track: "A", dir: "asc" }, { track: "B", dir: "desc" }]), ["S-09", "S-1", "S-2", "S-10"], "A asc, B desc");
});

each("T4: no track key (genomic only): ids by stringToVector ascending, either direction (SU getGeneticTrackSortComparator 240-247, BS 116-148)", (sort) => {
  // SU 246: the preferred vector ends with the id string; PC 129-133 flips numbers only, so the id is never reversed
  const f: Fixture = { pids: IDS };
  assert.deepEqual(sort(f, [{ track: "genomic", dir: "asc" }]), ["S-1", "S-2", "S-09", "S-10"], "asc");
  assert.deepEqual(sort(f, [{ track: "genomic", dir: "desc" }]), ["S-1", "S-2", "S-09", "S-10"], "desc");
});

each("T5: the first track key is a heatmap row: naturalSort in its direction (SU heatmapTrackSortComparator 412-418)", (sort) => {
  // SU 415: alphabeticalDefault(makeNumericalComparator('profile_data')); every value 1.0 ties
  const f: Fixture = { pids: IDS, heatmap: [{ profileType: "mrna_median_Zscores", genes: ["TP53"], isVaf: false, values: new Map(IDS.map((p): [string, number] => [p + "|TP53", 1])) }] };
  const label = contract(f, [{ track: "genomic", dir: "asc" }]).tracks.find((t) => t.kind === "heatmap")!.label;
  assert.deepEqual(sort(f, [{ track: label, dir: "asc" }]), ["S-09", "S-1", "S-2", "S-10"], "asc");
  assert.deepEqual(sort(f, [{ track: label, dir: "desc" }]), ["S-10", "S-2", "S-1", "S-09"], "desc");
});

each("T6: the first track key is the mutation spectrum: naturalSort in its direction (SU makeStackedBarTrackSortComparator 428-434)", (sort) => {
  // SU 431: alphabeticalDefault(makeCountsMapClinicalComparator); every column C>A 0.5, a tie on class and share
  const f: Fixture = { pids: IDS, clinical: [{ attr: "MUTATION_SPECTRUM", values: same(IDS, "1,0,1,0,0,0") }] };
  assert.deepEqual(sort(f, [{ track: "MUTATION_SPECTRUM", dir: "asc" }]), ["S-09", "S-1", "S-2", "S-10"], "asc");
  assert.deepEqual(sort(f, [{ track: "MUTATION_SPECTRUM", dir: "desc" }]), ["S-10", "S-2", "S-1", "S-09"], "desc");
});

each("T7: no value on a track key: after every valued column both ways, and among themselves by naturalSort in the key's direction (SU 250-266, PC 72-76)", (sort) => {
  // SU 254-257: no value is ±2, which PC 72-76 does not flip; two no-values tie (SU 252) and go to SU 368 naturalSort, which PC 77 flips
  const text: Fixture = { pids: ["S-2", "V-1", "S-10", "S-1", "V-2", "S-09"], clinical: [{ attr: "TYPE", values: same(["V-1", "V-2"], "x") }] };
  assert.deepEqual(sort(text, [{ track: "TYPE", dir: "desc" }]), ["V-2", "V-1", "S-10", "S-2", "S-1", "S-09"], "text, desc");
  assert.deepEqual(sort(text, [{ track: "TYPE", dir: "asc" }]), ["V-1", "V-2", "S-09", "S-1", "S-2", "S-10"], "text, asc");
  const num: Fixture = { pids: [...IDS, ...NUMS], clinical: [{ attr: "TMB", values: new Map(NUMS.map((p, i): [string, string] => [p, String(i + 1)])) }] };
  assert.deepEqual(sort(num, [{ track: "TMB", dir: "desc" }]), [...NUMS.slice().reverse(), "S-10", "S-2", "S-1", "S-09"], "numeric, desc (N11..N01)");
  assert.deepEqual(sort(num, [{ track: "TMB", dir: "asc" }]), [...NUMS, "S-09", "S-1", "S-2", "S-10"], "numeric, asc (N01..N11)");
});

each("T8 (ours): a track key after genomic still decides the tie's direction (case table: the portal always puts clinical first, DU 217-244)", (sort) => {
  assert.deepEqual(sort(textTie("AGE", "60"), [{ track: "genomic", dir: "asc" }, { track: "AGE", dir: "desc" }]), ["S-10", "S-2", "S-1", "S-09"]);
});

each("T9 (ours): an explicit id key sorts by the id in that key's direction, as now", (sort) => {
  // unchanged: the id key compares stringToVector (BS 116-148), the order the engine has today
  assert.deepEqual(sort(textTie(), [{ track: "id", dir: "asc" }]), ["S-1", "S-2", "S-09", "S-10"], "asc");
  assert.deepEqual(sort(textTie(), [{ track: "id", dir: "desc" }]), ["S-10", "S-09", "S-2", "S-1"], "desc");
});

each("T10: ids where naturalSort and stringToVector disagree: a track tie uses naturalSort, a genomic tie stringToVector (NS 8, 31; BS 116-148)", (sort) => {
  // NS 8: a whole id that is a signed or decimal number is one chunk, NS 31 parseFloat: -10 < -5 < 1.1 < 1.5
  // BS: "-" and "." are char codes 45 and 46, digits numbers: [1,46,5] < [1,46,10] < [45,5] < [45,10]
  const pids = ["1.5", "-10", "1.10", "-5"];
  const f: Fixture = { pids, clinical: [{ attr: "TYPE", values: same(pids, "x") }] };
  assert.deepEqual(sort(f, [{ track: "TYPE", dir: "asc" }]), ["-10", "-5", "1.10", "1.5"], "track tie: naturalSort");
  assert.deepEqual(sort(f, [{ track: "genomic", dir: "asc" }]), ["1.5", "1.10", "-5", "-10"], "genomic tie: stringToVector");
  // and the leading zero: NS keeps "09" a string ("09" < "1"), BS reads it as 9
  assert.deepEqual(sort(textTie(), [{ track: "TYPE", dir: "asc" }]), ["S-09", "S-1", "S-2", "S-10"], "track tie, leading zero");
  assert.deepEqual(sort(textTie(), [{ track: "genomic", dir: "asc" }]), ["S-1", "S-2", "S-09", "S-10"], "genomic tie, leading zero");
});

each("T11 (ours): the same id in two studies: the id without its study, then the full id ascending", (sort) => {
  // the portal's ids carry no study: P2 < P10 decides first (in the key's direction), then brca_ < luad_ ascending either way
  const pids = ["luad_P2", "brca_P10", "luad_P10", "brca_P2"];
  const f: Fixture = { pids, studies: ["luad", "brca"], studyOf: new Map(pids.map((p): [string, string] => [p, p.split("_")[0]])),
    clinical: [{ attr: "TYPE", values: same(pids, "x") }] };
  assert.deepEqual(sort(f, [{ track: "TYPE", dir: "asc" }]), ["brca_P2", "luad_P2", "brca_P10", "luad_P10"], "track key asc");
  assert.deepEqual(sort(f, [{ track: "TYPE", dir: "desc" }]), ["brca_P10", "luad_P10", "brca_P2", "luad_P2"], "track key desc: the full id still ascending");
  assert.deepEqual(sort(f, [{ track: "genomic", dir: "asc" }]), ["brca_P2", "luad_P2", "brca_P10", "luad_P10"], "genomic");
});

each("beyond the table: distinct ids naturalSort calls equal go to the genomic id order, stringToVector ascending (OM 2453, SU 246)", (sort) => {
  // NS 31: "1", "1.0" and "1e0" all parseFloat to 1, a tie; the genetic track's preferred vector (SU 246) then
  // decides, unflipped: BS [1] < [1,46,0] < [1,101,0]
  const pids = ["1e0", "1.0", "1"];
  const f: Fixture = { pids, clinical: [{ attr: "TYPE", values: same(pids, "x") }] };
  assert.deepEqual(sort(f, [{ track: "TYPE", dir: "asc" }]), ["1", "1.0", "1e0"], "asc");
  assert.deepEqual(sort(f, [{ track: "TYPE", dir: "desc" }]), ["1", "1.0", "1e0"], "desc");
});

// ---- S: text tracks -----------------------------------------------------------------------------
// x10 three times, abc twice, the rest once: most frequent first is x10, abc, 9, x2, 10, x1
const TEXT: Record<string, string> = { C1: "x10", C2: "abc", C3: "9", C4: "x2", C5: "x10", C6: "10", C7: "x1", C8: "abc", C9: "x10" };
const textTrack: Fixture = { pids: [...Object.keys(TEXT), "D1"], clinical: [{ attr: "KIND", values: new Map(Object.entries(TEXT)) }] };

each("S1: a text track ascending sorts by naturalSort of its values: numbers before text, x2 before x10 (SU stringClinicalComparator 268-278)", (sort) => {
  // SU 276: naturalSort(d1.attr_val, d2.attr_val); NS 35 number < string; NS 31 9 < 10; chunks x,2 < x,10; ties by id (C2 < C8)
  assert.deepEqual(sort(textTrack, [{ track: "KIND", dir: "asc" }]), ["C3", "C6", "C2", "C8", "C7", "C4", "C1", "C5", "C9", "D1"]);
});

each("S2: a text track descending is reversed, no value still last (PC 72-77)", (sort) => {
  // values reversed (x10, x2, x1, abc, 10, 9), ties by naturalSort descending (C9 > C5 > C1), D1 (no value) last
  assert.deepEqual(sort(textTrack, [{ track: "KIND", dir: "desc" }]), ["C9", "C5", "C1", "C4", "C7", "C8", "C2", "C6", "C3", "D1"]);
});

each("S3: values naturalSort calls equal (surrounding spaces; 1 and 1.0) tie, and go to the next key (NS 10, 15-16, 31)", (sort) => {
  // NS 15-16 strip leading and trailing spaces: " a" = "a"; NS 31 parseFloat: "1" = "1.0"; 1 < 2 < a; NEXT a < b
  const pids = ["E1", "E2", "E3", "E4", "E5"];
  const f: Fixture = { pids, clinical: [
    { attr: "KIND", values: new Map([["E1", "1.0"], ["E2", "1"], ["E3", " a"], ["E4", "a"], ["E5", "2"]]) },
    { attr: "NEXT", values: new Map([["E1", "b"], ["E2", "a"], ["E3", "b"], ["E4", "a"], ["E5", "a"]]) }] };
  assert.deepEqual(sort(f, [{ track: "KIND", dir: "asc" }, { track: "NEXT", dir: "asc" }]), ["E2", "E1", "E5", "E4", "E3"]);
});

each("S4: text values sort case-sensitively, by code unit: B before a (NS 13, insensitive off)", (sort) => {
  // NS 13: naturalSort.insensitive is unset, so no toLowerCase; NS 42 string <: A(65) < B(66) < a(97) < b(98)
  const f: Fixture = { pids: ["F1", "F2", "F3", "F4", "F5"], clinical: [{ attr: "KIND", values: new Map([["F1", "a"], ["F2", "B"], ["F3", "b"], ["F4", "A"], ["F5", "b"]]) }] };
  assert.deepEqual(sort(f, [{ track: "KIND", dir: "asc" }]), ["F4", "F2", "F1", "F3", "F5"]);
});

test("S5 (ours): sorting by a text track leaves its colours and legend order alone, most frequent first [engine]", () => {
  const c = contract(textTrack, [{ track: "KIND", dir: "asc" }]);
  const t = c.tracks.find((x) => x.label === "KIND")!;
  assert.deepEqual(t.categories, ["x10", "abc", "9", "x2", "10", "x1"]);
  assert.deepEqual(c.columns.map((p) => (p in TEXT ? t.categories![t.cells[c.columns.indexOf(p)]] : null)), c.columns.map((p) => TEXT[p] ?? null),
    "each cell still names its own value");
});

each("S6: the Study track is a text track like any other (SU getClinicalTrackSortComparator 381-399)", (sort) => {
  // naturalSort of the study names: brca < luad < s9 < s10, not the order the studies were listed in
  const pids = ["luad_P1", "brca_P1", "s10_P1", "s9_P1"];
  const f: Fixture = { pids, studies: ["luad", "brca", "s10", "s9"], studyOf: new Map(pids.map((p): [string, string] => [p, p.split("_")[0]])) };
  assert.deepEqual(sort(f, [{ track: "Study of origin", dir: "asc" }]), ["brca_P1", "luad_P1", "s9_P1", "s10_P1"], "asc");
  assert.deepEqual(sort(f, [{ track: "Study of origin", dir: "desc" }]), ["s10_P1", "s9_P1", "luad_P1", "brca_P1"], "desc");
  assert.deepEqual(contract(f, [{ track: "Study of origin", dir: "asc" }]).tracks.find((t) => t.label === "Study of origin")!.categories,
    ["luad", "brca", "s10", "s9"], "its legend keeps the studies' order");
});

each("S7 (ours): a derived (cohort DSL) track sorts as now: out of the set first ascending, in the set first descending", (sort) => {
  const pids = ["D1", "D2", "D3", "D4"];
  const f: Fixture = { pids, derived: [{ label: "treated", pids: new Set(["D1", "D3"]) }] };
  const inSet = (cols: string[]) => cols.map((p) => (p === "D1" || p === "D3" ? 1 : 0));
  assert.deepEqual(inSet(sort(f, [{ track: "treated", dir: "asc" }])), [0, 0, 1, 1], "asc");
  assert.deepEqual(inSet(sort(f, [{ track: "treated", dir: "desc" }])), [1, 1, 0, 0], "desc");
});

// ---- naturalSort: the port against javascript-natural-sort 0.7.1 --------------------------------
// Every ordered pair of these values is compared, both ways round (the library is not antisymmetric:
// NS 20 reads y as a date only when x was one). Dates in different formats are kept days apart, so
// no recorded answer depends on the time zone (Date.parse reads "3/7/2019" as local time).
const VALUES = [
  // sample and patient ids
  "TCGA-A6-2671-01", "TCGA-A6-2671-11", "TCGA-A6-2672-01", "TCGA-AA-3864", "TCGA-AA-A00N", "P-0000004-T01-IM3", "P-0000004-T02-IM5",
  "P-0000012-T01-IM3", "P1", "P01", "P2", "P10", "P-1", "P-01", "P-09", "P-10", "S-A", "S-70", "x1", "x2", "x10",
  // leading zeros, signs, decimals, exponents
  "0", "00", "007", "7", "08", "8", "-0", "+0", "-5", "-10", "+3", "3", "1", "1.0", "1.5", "1.10", "1.50", ".5", "0.5", "5.", "1e3", "1E3",
  "1e-3", "1000", "1e0", "12abc",
  // hex
  "0x1F", "0x1f", "0x2", "0x10", "15", "0xG",
  // dates
  "2019-03-05", "2019-03-10", "3/7/2019", "2019/03/20", "Tue, Mar 12, 2019", "Mar 5, 2019", "Mar 15, 2019 10:30",
  // spaces and empties
  "", " ", "  P1 ", "P1 ", "\tP1", "P 1",
  // case
  "a", "A", "b", "B", "abc", "ABC", "Abc",
  // what parseFloat reads that another language might not
  "Infinity", "-Infinity", "NaN", "inf",
  // unicode, inside and outside the BMP
  "e", "é", "f", "Ä", "日本", "ｚ", "😀",
];
const GOLDEN = "test/fixtures/golden/natural-sort.json";
const LEGACY = "javascript-natural-sort 0.7.1 (cbioportal-frontend cd8c6df node_modules)";
if (process.env.RECORD_NATURAL_SORT === "1") {
  const root = process.env.CBIOPORTAL_FRONTEND || join(homedir(), "cbioportal-frontend");
  const real = createRequire(import.meta.url)(join(root, "node_modules", "javascript-natural-sort")) as ((a: string, b: string) => number) & { insensitive?: boolean };
  if (real.insensitive !== undefined) throw new Error("the portal never sets naturalSort.insensitive");
  const cmp = VALUES.map((a) => VALUES.map((b) => real(a, b)));
  writeFileSync(GOLDEN, JSON.stringify({ generatedBy: "RECORD_NATURAL_SORT=1 node --test test/oncoprint-sort-ties.test.ts", legacy: LEGACY,
    note: "cmp[i][j] = naturalSort(values[i], values[j])", values: VALUES, cmp }) + "\n");
}

test("naturalSort: the port answers as javascript-natural-sort 0.7.1 does, on every recorded pair", () => {
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as { legacy: string; values: string[]; cmp: number[][] };
  assert.equal(golden.legacy, LEGACY);
  assert.deepEqual(golden.values, VALUES, "the fixture was recorded from this list; re-record with RECORD_NATURAL_SORT=1");
  const wrong: string[] = [];
  golden.values.forEach((a, i) => golden.values.forEach((b, j) => {
    const got = naturalSort(a, b);
    if (got !== golden.cmp[i][j]) wrong.push(JSON.stringify(a) + " vs " + JSON.stringify(b) + ": " + got + ", the library " + golden.cmp[i][j]);
  }));
  assert.deepEqual(wrong.slice(0, 25), [], wrong.length + " of " + golden.values.length ** 2 + " pairs differ");
});
