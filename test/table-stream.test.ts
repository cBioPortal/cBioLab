import { test } from "node:test";
import assert from "node:assert/strict";
import { pageStream } from "../lib/table-stream.ts";
import type { TableRows, ViewResult } from "../lib/types.ts";

const row = (i: number) => ({ cohort: "c", study: "s", patient: `p${i}`, sample: `s${i}`, values: [`r${i}`, i] as unknown[] });

function rows(offset: number, n: number, total: number): TableRows<unknown> {
  return {
    columns: [{ id: "a", name: "A", numeric: false }, { id: "b", name: "B", numeric: true }],
    shown: ["a", "b"], defaults: ["a", "b"], query: {} as TableRows<unknown>["query"],
    rows: Array.from({ length: n }, (_, k) => row(offset + k)),
    offset, pageSize: 3, lists: [], total, all: total,
  };
}

function pager(total: number, chunk: number, fail?: Record<number, string>) {
  const asked: number[] = [];
  const page = async (offset: number) => {
    asked.push(offset);
    if (fail?.[offset]) return { views: [{ kind: "mutations", cohorts: [], error: fail[offset] } as unknown as ViewResult] };
    const t = rows(offset, Math.min(chunk, total - offset), total);
    return { views: [{ kind: "mutations", cohorts: [], mutations: t } as unknown as ViewResult] };
  };
  return { asked, page };
}

const write = {
  head: () => "H\n",
  rows: (p: TableRows<unknown>) => p.rows.map(r => r.values.join(",") + "\n").join(""),
  cut: (why: string) => "# CUT " + why + "\n",
};

const lines = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => `r${from + k},${from + k}\n`).join("");
const read = (s: ReadableStream<Uint8Array>) => new Response(s).text();

test("P1: have covers the whole table: page never called", async () => {
  const { asked, page } = pager(3, 3);
  const text = await read(pageStream(3, page, undefined, write, rows(0, 3, 3), 3));
  assert.equal(text, "H\n" + lines(0, 3));
  assert.deepEqual(asked, []);
});

test("P2: have then later chunks", async () => {
  const { asked, page } = pager(7, 3);
  const text = await read(pageStream(7, page, undefined, write, rows(0, 3, 7), 3));
  assert.equal(text, "H\n" + lines(0, 7));
  assert.deepEqual(asked, [3, 6]);
});

test("P3: no have pages from 0", async () => {
  const { asked, page } = pager(5, 3);
  const text = await read(pageStream(5, page, undefined, write, undefined, 3));
  assert.equal(text, "H\n" + lines(0, 5));
  assert.deepEqual(asked, [0, 3]);
});

test("P4: have not at the start is ignored", async () => {
  const { asked, page } = pager(5, 3);
  const text = await read(pageStream(5, page, undefined, write, rows(3, 2, 5), 3));
  assert.equal(text, "H\n" + lines(0, 5));
  assert.deepEqual(asked, [0, 3]);
});

test("P5: a failed page ends with the cut line", async () => {
  const { asked, page } = pager(7, 3, { 6: "boom" });
  const text = await read(pageStream(7, page, undefined, write, rows(0, 3, 7), 3));
  assert.ok(text.startsWith("H\n" + lines(0, 6)), text);
  assert.ok(text.endsWith("# CUT boom\n"), text);
  assert.equal(text, "H\n" + lines(0, 6) + "# CUT boom\n");
  assert.deepEqual(asked, [3, 6]);
});

test("P6: empty table writes the header only", async () => {
  const { asked, page } = pager(0, 3);
  const text = await read(pageStream(0, page, undefined, write, rows(0, 0, 0), 3));
  assert.equal(text, "H\n");
  assert.deepEqual(asked, []);
});
