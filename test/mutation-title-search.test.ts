// The mutations table's title unit (MUT-TB-1) and a column's own search value (MUT-COL-6), from the spec
// table U1-U2, Q1-Q2 written off legacy cbioportal-frontend cd8c6df: the header reads "N Mutations",
// "1 Mutation"; ProteinChangeColumnFormatter.getFilterValue makes the table search match a germline row's
// change + status, while the header filter on the column still reads the change alone. cBioLab: a
// QueryColumn's optional `search` SQL is what whereSql's search matches in that column, `text` otherwise.
//
// whereSql's condition is run, not matched as text: on a scratch ClickHouse (clickhouse local, the pinned
// binary `npm run local` downloads to ~/.cbiolab/bin) over a handful of literal rows, skipped without it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mutationUnit } from "../lib/mutation-cell-text.ts";
import { whereSql, type RowSource, type TableQuery } from "../lib/table-query.ts";

describe("U1 U2 mutationUnit", () => {
  test("U1 one row is a Mutation", () => assert.equal(mutationUnit(1), "Mutation"));
  test("U2 none and many are Mutations", () => {
    assert.equal(mutationUnit(0), "Mutations");
    assert.equal(mutationUnit(223), "Mutations");
  });
});

/** [id, protein change, status, note]: `pc` searches as change + status, `nt` has no `search` */
const ROWS: [string, string, string, string][] = [
  ["r1", "G12D", "Germline", ""],
  ["r2", "G12D", "SOMATIC", ""],
  ["r3", "Q61H", "", "has x here"],
  ["r4", "R130Q", "germline", ""],
  ["r5", "X200_splice", "", ""],
  ["r6", "A1B", "", "nothing"],
];

const lit = (x: string) => "'" + x.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
const src: RowSource = {
  with: "WITH rows AS (SELECT * FROM values('id String, pc String, status String, note String', " +
    ROWS.map((r) => "(" + r.map(lit).join(", ") + ")").join(", ") + "))\n",
  columns: [
    { id: "pc", name: "Protein Change", numeric: false, text: "pc", search: "concat(pc, if(positionCaseInsensitive(status, 'germline') > 0, status, ''))" },
    { id: "nt", name: "Note", numeric: false, text: "note" },
  ],
  select: "*",
  defaultOrder: "id",
  tiebreak: "id",
};
const defaults = ["pc", "nt"];

const CH = path.join(process.env.CBIOLAB_DATA || path.join(os.homedir(), ".cbiolab"), "bin", "clickhouse");
const noCh = existsSync(CH) ? false : "no ClickHouse binary at " + CH + " (npm run local downloads it)";

/** the ids of the rows whereSql keeps, run in ClickHouse */
function kept(q: TableQuery): string[] {
  const where = whereSql(src, q, defaults);
  const out = execFileSync(CH, ["local", "--max_threads=1", "--query", src.with + "SELECT id FROM rows WHERE " + where + " ORDER BY id FORMAT JSONEachRow"], { encoding: "utf8" });
  return out.trim() ? out.trim().split("\n").map((l) => String(JSON.parse(l).id)) : [];
}

describe("Q1 whereSql's search, run", () => {
  test("Q1 'x' is found through pc's `search` (X200_splice) and through nt's `text` (a note with x)", { skip: noCh }, () => {
    assert.deepEqual(kept({ search: "x" }), ["r3", "r5"]);
  });
  test("Q1 'germline' is found only through pc's `search`: the rows whose status says germline", { skip: noCh }, () => {
    assert.deepEqual(kept({ search: "germline" }), ["r1", "r4"]);
    assert.deepEqual(kept({ search: "GERMLINE" }), ["r1", "r4"], "case-insensitive");
  });
  test("Q1 change + status with no space matches the germline row only, not the somatic row with the same change", { skip: noCh }, () => {
    assert.deepEqual(kept({ search: "G12DGermline" }), ["r1"]);
    assert.deepEqual(kept({ search: "g12dgermline" }), ["r1"]);
    assert.deepEqual(kept({ search: "G12D Germline" }), []);
  });
  test("Q1 a column's `text` is not searched when it has `search` that lacks it", { skip: noCh }, () => {
    // pc's search holds the change, so the plain change still matches both G12D rows
    assert.deepEqual(kept({ search: "G12D" }), ["r1", "r2"]);
    // a status not containing germline is not part of the search value
    assert.deepEqual(kept({ search: "somatic" }), []);
  });
  test("Q1 only the shown columns are searched: pc alone does not find nt's 'x'", { skip: noCh }, () => {
    assert.deepEqual(kept({ columns: ["pc"], search: "x" }), ["r5"]);
    assert.deepEqual(kept({ columns: ["nt"], search: "germline" }), []);
  });
});

describe("Q2 a filter on a column with `search` reads `text`", () => {
  test("Q2 contains 'germline' on pc keeps no row", { skip: noCh }, () => {
    assert.deepEqual(kept({ filters: { pc: { op: "contains", value: "germline" } } }), []);
  });
  test("Q2 equals 'G12D' on pc keeps both G12D rows, germline or not", { skip: noCh }, () => {
    assert.deepEqual(kept({ filters: { pc: { op: "equals", value: "G12D" } } }), ["r1", "r2"]);
  });
  test("Q2 a value filter on pc matches the change, not change + status", { skip: noCh }, () => {
    assert.deepEqual(kept({ filters: { pc: { values: ["G12D"] } } }), ["r1", "r2"]);
    assert.deepEqual(kept({ filters: { pc: { values: ["G12DGermline"] } } }), []);
  });
});
