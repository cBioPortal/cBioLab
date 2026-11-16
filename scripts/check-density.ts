/**
 * Live check: the Study View density chart's bins and coefficients, run against the fixture study's
 * ClickHouse (connection b, `cbiolab_peer_fixture`).
 *
 * Written from docs/legacy-spec/parity/density-cases.md, rows B2–B12 and S1–S3, which cite
 * cBioPortal's ClinicalDataDensityPlotServiceImpl (BE). Each row feeds literal values through
 * plotBinsSql / plotStatsSql and compares the cells (and each cell's min/max) with the table. A
 * last row runs the real thing over the fixture's MUTATION_COUNT and FRACTION_GENOME_ALTERED and
 * compares it with a reimplementation of the Java binning (BE:88-163) over the values read straight
 * from clinical_data_derived.
 *
 * Run: node --env-file=.env.local scripts/check-density.ts
 * (connection b is `npm run peer-db`: export the CLICKHOUSE2_* lines it prints)
 */
import { chQuery, connById } from "../lib/ch.ts";
import { axisSelect, plotBinsSql, plotStatsSql, plotExtent } from "../lib/plot.ts";
import { compileCohortDef } from "../lib/cohort2.ts";
import { lnFromEngine, MUTATION_COUNT, FGA } from "../lib/study-view-density.ts";

const STUDY = "cbiolab_peer_fixture";
const GRID: [number, number] = [44, 38];
const LIT_COHORT = "SELECT '' AS pid, '' AS sid";

const conn = connById("b");
if (!conn) {
  console.log("FAIL connection b (CLICKHOUSE2_*) is not configured.\n" +
    "  Start the fixture database with `npm run peer-db` (or node --env-file=.env.local scripts/peer-db.ts)\n" +
    "  and export the CLICKHOUSE2_* lines it prints, then run this again.");
  process.exit(1);
}

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};
/** run a case; a thrown error (a stub, a SQL error) is that case's failure, not the script's end */
const row = async (name: string, f: () => Promise<void>) => {
  try { await f(); } catch (e) { ok(name, false, String((e as Error).message ?? e).split("\n")[0].slice(0, 300)); }
};

type Extent = { x0?: number; x1?: number; y0?: number; y1?: number };
interface Cell { bx: number; by: number; n: number; minX: number; maxX: number; minY: number; maxY: number }

/** a literal value select: columns id, v */
const lit = (vals: (number | null)[], ids = vals.map((_, i) => "s" + i)) => {
  const rows = vals.map((v, i) => `('${ids[i]}', ${v === null ? "NULL" : String(v)})`).join(", ");
  return `SELECT id, v FROM values('id String, v Nullable(Float64)', ${rows})`;
};
const sqlText = (s: unknown) => String((s as { sql?: string }).sql ?? s);

async function bins(xSel: string, ySel: string, extent: Extent, cohort = LIT_COHORT): Promise<Cell[]> {
  const r = await chQuery<Record<string, unknown>>(sqlText(plotBinsSql(xSel, ySel, cohort, GRID, extent as never)), conn!);
  return r.data.map((d) => ({
    bx: Number(d.bx), by: Number(d.by), n: Number(d.n),
    minX: Number(d.minX), maxX: Number(d.maxX), minY: Number(d.minY), maxY: Number(d.maxY)
  })).sort((a, b) => a.bx - b.bx || a.by - b.by);
}
async function stats(xSel: string, ySel: string, cohort = LIT_COHORT) {
  const d = (await chQuery<Record<string, unknown>>(sqlText(plotStatsSql(xSel, ySel, cohort)), conn!)).data[0];
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return { n: Number(d.n), pearson: num(d.pearson), spearman: num(d.spearman) };
}
const cellsText = (cs: Cell[]) => cs.map((c) => `(${c.bx},${c.by}) ${c.n}`).join(" ");
const near = (a: number | null, b: number, eps: number) => a !== null && Number.isFinite(a) && Math.abs(a - b) <= eps;
/** cells' indexes and counts equal, and, where `want` names them, their min/max */
function sameCells(got: Cell[], want: Partial<Cell>[], eps = 1e-9): boolean {
  if (got.length !== want.length) return false;
  const w = [...want].sort((a, b) => a.bx! - b.bx! || a.by! - b.by!);
  return got.every((g, i) => (Object.keys(w[i]) as (keyof Cell)[]).every((k) =>
    k === "bx" || k === "by" || k === "n" ? g[k] === w[i][k] : Math.abs(g[k] - (w[i][k] as number)) <= eps));
}
/** the cells of a set of (x, y) pairs as indexes only: [bx, by, n] */
const counts = (cs: Cell[]) => cs.map((c) => [c.bx, c.by, c.n]);

// The default chart's axes: FGA x fixed 0..1, MC y from 0 to the data's largest
const DEFAULT_EXTENT: Extent = { x0: 0, x1: 1, y0: 0 };

await row("B2 FGA 0.2 and 0.4 on a 0..1 axis: bins 8 and 17", async () => {
  const got = await bins(lit([0.2, 0.4]), lit([1, 2]), DEFAULT_EXTENT);
  ok("B2 FGA 0.2 and 0.4 on a 0..1 axis: bins 8 and 17",
    got.map((c) => c.bx).join(",") === "8,17", cellsText(got));
});

await row("B3 MC 5, 10, 38 from 0: bins 5, 10, 37", async () => {
  const got = await bins(lit([0.5, 0.5, 0.5]), lit([5, 10, 38]), DEFAULT_EXTENT);
  ok("B3 MC 5, 10, 38 from 0 to the largest: bins 5, 10, 37",
    got.map((c) => c.by).join(",") === "5,10,37", cellsText(got));
});

await row("B4 index rule", async () => {
  const got = await bins(lit([3 / 44, 24 / 44]), lit([1, 1]), DEFAULT_EXTENT);
  ok("B4 FGA 3/44 and 24/44: bins 2 and 23 (the interval rounded first), not 3 and 24",
    got.map((c) => c.bx).join(",") === "2,23", cellsText(got));
});

await row("B5 a value at the axis end", async () => {
  // (1, 7) and (0.5, 76): FGA 1 is x bin 43, MC 76 (the largest) y bin 37
  const got = await bins(lit([1, 0.5]), lit([7, 76]), DEFAULT_EXTENT);
  ok("B5 FGA 1 and the largest MC go in the last bin (43, 37), not one past it",
    sameCells(got, [{ bx: 43, by: 3, n: 1 }, { bx: 22, by: 37, n: 1 }]), cellsText(got));
});

await row("B6 every MC 0", async () => {
  const got = await bins(lit([0.1, 0.5, 0.9]), lit([0, 0, 0]), DEFAULT_EXTENT);
  ok("B6 every MC 0 (start = end = 0): every sample in bin 0 of y",
    got.length === 3 && got.every((c) => c.by === 0), cellsText(got));
});

await row("B7 every MC 5", async () => {
  const got = await bins(lit([0.1, 0.5, 0.9]), lit([5, 5, 5]), DEFAULT_EXTENT);
  ok("B7 every MC 5 (axis 0..5): every sample in bin 37, none in 0",
    got.length === 3 && got.every((c) => c.by === 37), cellsText(got));
});

await row("B8 one bin's count and extremes", async () => {
  const got = await bins(lit([0.19, 0.2]), lit([2, 3]), { ...DEFAULT_EXTENT, y1: 76 });
  ok("B8 (0.19, 2) and (0.2, 3), MC axis to 76: one bin (8, 1), n 2, x 0.19..0.2, y 2..3",
    sameCells(got, [{ bx: 8, by: 1, n: 2, minX: 0.19, maxX: 0.2, minY: 2, maxY: 3 }]),
    got.map((c) => JSON.stringify(c)).join(" "));
});

await row("B9 empty bins", async () => {
  const got = await bins(lit([0.1, 0.1, 0.9]), lit([1, 1, 40]), DEFAULT_EXTENT);
  ok("B9 bins nobody falls in are not reported",
    got.length === 2 && got.every((c) => c.n > 0) && got.reduce((s, c) => s + c.n, 0) === 3, cellsText(got));
});

await row("B10 a sample without a row", async () => {
  // s1 has no MC row at all: only s0 and s2 have both
  const x = lit([0.1, 0.5, 0.9], ["s0", "s1", "s2"]);
  const y = lit([2, 9], ["s0", "s2"]);
  const got = await bins(x, y, DEFAULT_EXTENT);
  const st = await stats(x, y);
  ok("B10 a sample with no row on one axis is left out of the bins (and the y axis ends at 9)",
    sameCells(got, [{ bx: 4, by: 8, n: 1 }, { bx: 39, by: 37, n: 1 }]), cellsText(got));
  ok("B10 … and of the coefficients' n", st.n === 2, `n ${st.n}`);
});

await row("B10 an empty (NULL) value", async () => {
  // s1's FGA and s2's MC are empty (NULL): only s0 and s3 have both; s1's MC 30 must not end the axis
  const x = lit([0.1, null, 0.5, 0.9], ["s0", "s1", "s2", "s3"]);
  const y = lit([2, 30, null, 9], ["s0", "s1", "s2", "s3"]);
  const got = await bins(x, y, DEFAULT_EXTENT);
  const st = await stats(x, y);
  ok("B10 a sample whose value is NULL is left out of the bins and the axis's extent",
    sameCells(got, [{ bx: 4, by: 8, n: 1 }, { bx: 39, by: 37, n: 1 }]), cellsText(got));
  ok("B10 … and of the coefficients' n", st.n === 2, `n ${st.n}`);
});

await row("B11 FGA 2.0E-4", async () => {
  const got = await bins(lit([0.0002, 0.5]), lit([1, 2]), DEFAULT_EXTENT);
  ok("B11 FGA 0.0002 (written 2.0E-4) is in bin 0", got.some((c) => c.bx === 0 && c.n === 1), cellsText(got));
});

await row("B12 Log Scale on MC", async () => {
  // the engine's log axis carries log2(1 + v): MC 0, 4, 99
  const mc = [0, 4, 99];
  const y = lit(mc.map((v) => Math.log2(1 + v)));
  const x = lit([0.1, 0.5, 0.9]);
  const want = [{ bx: 4, by: 0, n: 1 }, { bx: 22, by: 13, n: 1 }, { bx: 39, by: 37, n: 1 }];
  const partial = await bins(x, y, DEFAULT_EXTENT);
  ok("B12 MC 0, 4, 99 on Log Scale: y bins 0, 13, 37", sameCells(partial, want), cellsText(partial));
  // the extent the engine passes when the range is converted by plotExtent
  const full = plotExtent({ x0: 0.1, x1: 0.9, y0: 0, y1: Math.log2(100) }, { x: { min: 0, max: 1 }, y: { min: 0 } }, { y: "log2" });
  const viaExtent = await bins(x, y, full);
  ok("B12 … the same with plotExtent's extent", sameCells(viaExtent, want), cellsText(viaExtent));
  // each cell's min/max, in the portal's units ln(1 + v)
  const lnOk = partial.every((c) => {
    const v = Math.log(1 + mc[c.by === 0 ? 0 : c.by === 13 ? 1 : 2]);
    return Math.abs(lnFromEngine(c.minY) - v) < 1e-9 && Math.abs(lnFromEngine(c.maxY) - v) < 1e-9;
  });
  ok("B12 … each cell's min/max after lnFromEngine is ln(1 + v): 0, 1.609, 4.605", lnOk,
    partial.map((c) => `(${c.bx},${c.by}) ${lnFromEngine(c.minY).toFixed(4)}..${lnFromEngine(c.maxY).toFixed(4)}`).join(" "));
});

// ---- S. Pearson and Spearman ----
const S_X = [0.1, 0.2, 0.3, 0.4, 0.5];
await row("S1", async () => {
  const st = await stats(lit(S_X), lit([1, 3, 2, 5, 40]));
  ok("S1 Pearson 0.7563, Spearman 0.9000 over every sample",
    st.n === 5 && near(st.pearson, 0.7563342336604849, 1e-9) && near(st.spearman, 0.9, 1e-9), JSON.stringify(st));
});
await row("S2", async () => {
  const st = await stats(lit(S_X), lit([1, 3, 2, 5, 40].map((v) => Math.log2(1 + v))));
  ok("S2 Log Scale on MC: Pearson 0.8669 (the same over log2 as over ln), Spearman 0.9000",
    near(st.pearson, 0.8668601892675808, 1e-9) && near(st.spearman, 0.9, 1e-9), JSON.stringify(st));
});
await row("S3", async () => {
  const st = await stats(lit(S_X), lit([1, 2, 2, 3, 3]));
  ok("S3 ties share their average rank: Spearman 0.9487, Pearson 0.9449",
    near(st.spearman, 0.9486832980505138, 1e-9) && near(st.pearson, 0.9449111825230682, 1e-9), JSON.stringify(st));
});
await row("S6/S10 no spread", async () => {
  const st = await stats(lit(S_X), lit([0, 0, 0, 0, 0]));
  ok("S10 an axis with no spread: both coefficients NULL", st.pearson === null && st.spearman === null, JSON.stringify(st));
});
await row("S6 n", async () => {
  const x = lit([0.1, 0.1, 0.12, 0.5, 0.9]), y = lit([1, 1, 2, 30, 40]);
  const [st, cs] = [await stats(x, y), await bins(x, y, DEFAULT_EXTENT)];
  ok("S6 n is the sum of the bins' counts", st.n === cs.reduce((s, c) => s + c.n, 0) && st.n === 5, `n ${st.n}, ${cellsText(cs)}`);
});

// ---- the fixture study's own values, against the Java binning ----

/** BE:88-163: bins from the start/end given (else the data's), cells by (int)((v − start) / interval) */
function javaBins(xs: number[], ys: number[], xStart?: number, xEnd?: number, yStart?: number, yEnd?: number): Cell[] {
  const [nx, ny] = GRID;
  const sx = [...xs].sort((a, b) => a - b), sy = [...ys].sort((a, b) => a - b);
  const x0 = xStart ?? sx[0], x1 = xEnd ?? sx[sx.length - 1], y0 = yStart ?? sy[0], y1 = yEnd ?? sy[sy.length - 1];
  const ix = (x1 - x0) / nx, iy = (y1 - y0) / ny;
  const javaInt = (d: number) => (Number.isNaN(d) ? 0 : Math.trunc(d));
  const m = new Map<string, Cell>();
  xs.forEach((x, i) => {
    const y = ys[i];
    let bx = javaInt((x - x0) / ix), by = javaInt((y - y0) / iy);
    if (bx === nx) bx--;
    if (by === ny) by--;
    const k = bx + "," + by;
    const c = m.get(k) ?? { bx, by, n: 0, minX: x, maxX: x, minY: y, maxY: y };
    c.n++; c.minX = Math.min(c.minX, x); c.maxX = Math.max(c.maxX, x); c.minY = Math.min(c.minY, y); c.maxY = Math.max(c.maxY, y);
    m.set(k, c);
  });
  return [...m.values()].sort((a, b) => a.bx - b.bx || a.by - b.by);
}
/** NumberUtils.isCreatable, as far as the warehouse's spellings go (integers, decimals, exponents) */
const creatable = (s: string) => /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s.trim()) && s.trim() === s;

await row("fixture study", async () => {
  const raw = await chQuery<{ sid: string; a: string; v: string }>(
    `SELECT sample_unique_id AS sid, attribute_name AS a, attribute_value AS v FROM ${conn.db}.clinical_data_derived\n` +
    `WHERE cancer_study_identifier = '${STUDY}' AND attribute_name IN ('${MUTATION_COUNT}', '${FGA}')`, conn);
  const by = new Map<string, Record<string, string>>();
  for (const r of raw.data) by.set(r.sid, { ...(by.get(r.sid) ?? {}), [r.a]: r.v });
  const both = [...by.values()].filter((o) => o[FGA] !== undefined && o[MUTATION_COUNT] !== undefined &&
    creatable(o[FGA]) && creatable(o[MUTATION_COUNT]));
  const fx = both.map((o) => Number(o[FGA])), mc = both.map((o) => Number(o[MUTATION_COUNT]));
  ok("fixture: samples with both values", both.length > 2, `${both.length} of ${by.size} samples`);

  const cohortSql = compileCohortDef({ all: [] } as never, { study: STUDY, db: conn.db });
  const ctx = { study: STUDY, db: conn.db, unit: "sample" as const, cohortSql };
  const fgaSel = axisSelect({ source: "clinical", attribute: FGA }, ctx, "num");
  const mcSel = axisSelect({ source: "clinical", attribute: MUTATION_COUNT }, ctx, "num");
  const mcLogSel = axisSelect({ source: "clinical", attribute: MUTATION_COUNT, log: true }, ctx, "num");

  const want = javaBins(fx, mc, 0, 1, 0, undefined);
  const got = await bins(fgaSel, mcSel, DEFAULT_EXTENT, cohortSql);
  ok("fixture: FGA × MC cells and counts equal the Java binning", JSON.stringify(counts(got)) === JSON.stringify(counts(want)),
    `got ${cellsText(got)}\n      want ${cellsText(want)}`);
  ok("fixture: … and each cell's min/max", sameCells(got, want), "");

  // Log Scale on MC: the Java bins over ln(1 + v); the engine's over log2(1 + v), read back with lnFromEngine
  const wantLog = javaBins(fx, mc.map((v) => Math.log(1 + v)), 0, 1, 0, undefined);
  const gotLog = (await bins(fgaSel, mcLogSel, DEFAULT_EXTENT, cohortSql))
    .map((c) => ({ ...c, minY: lnFromEngine(c.minY), maxY: lnFromEngine(c.maxY) }));
  ok("fixture: Log Scale MC cells and counts equal the Java binning", JSON.stringify(counts(gotLog)) === JSON.stringify(counts(wantLog)),
    `got ${cellsText(gotLog)}\n      want ${cellsText(wantLog)}`);
  ok("fixture: … and each cell's min/max (ln)", sameCells(gotLog, wantLog, 1e-9), "");

  // Swap Axes: MC on x from 0, FGA on y 0..1
  const wantSw = javaBins(mc, fx, 0, undefined, 0, 1);
  const gotSw = await bins(mcSel, fgaSel, { x0: 0, y0: 0, y1: 1 }, cohortSql);
  ok("fixture: swapped (MC × FGA) equals the Java binning", sameCells(gotSw, wantSw),
    `got ${cellsText(gotSw)}\n      want ${cellsText(wantSw)}`);

  // coefficients over the same samples
  const pear = (a: number[], b: number[]) => {
    const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
    return sab / Math.sqrt(saa * sbb);
  };
  const rank = (a: number[]) => a.map((v) => a.filter((w) => w < v).length + (a.filter((w) => w === v).length + 1) / 2);
  const st = await stats(fgaSel, mcSel, cohortSql);
  ok("fixture: n, Pearson and Spearman equal commons-math's",
    st.n === both.length && near(st.pearson, pear(fx, mc), 1e-9) && near(st.spearman, pear(rank(fx), rank(mc)), 1e-9),
    `got ${JSON.stringify(st)}, want n ${both.length} pearson ${pear(fx, mc)} spearman ${pear(rank(fx), rank(mc))}`);
});

console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
process.exit(failures ? 1 : 0);
