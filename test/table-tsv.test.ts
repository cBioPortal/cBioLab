// The Mutations table's download as the portal's table.tsv (MUT-TB-8), from the spec's case table:
//
//   T1 tsvField writes a value as it is, missing as empty, a tab or line break as one space
//   T2 tsvLine joins its fields by tabs and ends the line with CRLF
//   T3 everyRowQuery drops the search and the filters, keeps the rest, leaves its input alone
//   T4 the file is named table.tsv
//   R1 POST /api/table refuses format "table-tsv" for a view other than the mutation table, 400,
//      before any database is asked
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TABLE_TSV_NAME, tsvField, tsvLine, everyRowQuery } from "../lib/table-tsv.ts";

test("T1 tsvField", () => {
  const cases: [unknown, string][] = [[null, ""], [undefined, ""], ["", ""], [0, "0"], ["a\tb", "a b"], ["a\r\nb", "a b"], ["x", "x"]];
  for (const [x, want] of cases) assert.equal(tsvField(x), want, JSON.stringify(x));
});

test("T2 tsvLine", () => {
  assert.equal(tsvLine(["Sample ID", null, 0.31]), "Sample ID\t\t0.31\r\n");
});

test("T3 everyRowQuery", () => {
  const view = { kind: "mutations", gene: "KRAS", search: "G12D", filters: { vaf: { min: 0.1 } }, sort: { column: "vaf" }, columns: ["sample"] };
  const copy = structuredClone(view);
  const out = everyRowQuery(view);
  assert.deepEqual(out, { kind: "mutations", gene: "KRAS", sort: { column: "vaf" }, columns: ["sample"] });
  assert.ok(!("search" in out) && !("filters" in out));
  assert.deepEqual(view, copy);
});

test("T4 TABLE_TSV_NAME", () => {
  assert.equal(TABLE_TSV_NAME, "table.tsv");
});

let sent: string[] = [];
let POST: (req: Request) => Promise<Response>;
before(async () => {
  const { setChTransport } = await import("../lib/ch.ts");
  setChTransport(async (st) => { sent.push(st.query); throw new Error("the database was asked"); });
  ({ POST } = await import("../app/api/table/route.ts"));
});
after(async () => { (await import("../lib/ch.ts")).setChTransport(null); });

test("R1 the route refuses table-tsv for a non-mutations view", async () => {
  sent = [];
  const doc = { study: "s1", cohorts: { A: { all: [{ kind: "oql", q: "TP53: MUT" }] } }, views: [{ kind: "table" }] };
  const r = await POST(new Request("http://app.invalid/api/table", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ doc, view: 0, format: "table-tsv" }) }));
  const text = await r.text();
  assert.equal(r.status, 400, text);
  assert.match(text, /mutation table/);
  assert.deepEqual(sent, []);
});

// the Reviewer's case (#413): a download cut short answers 200 and ends with its # line; a copy of it is no copy of the table
test("T5 cutShort: the reason of a cut-short table text, null for a whole one", async () => {
  const { cutShort, INCOMPLETE_MARK } = await import("../lib/table-tsv.ts");
  assert.equal(INCOMPLETE_MARK, "# DOWNLOAD INCOMPLETE");
  assert.equal(cutShort("Gene\tSample ID\r\nKRAS\tS1\r\n"), null);
  assert.equal(cutShort("Gene\r\nKRAS\r\n# DOWNLOAD INCOMPLETE: the page at row 1000 returned nothing\r\n"), "the page at row 1000 returned nothing");
  assert.equal(cutShort("# DOWNLOAD INCOMPLETE\r\n"), "the table was cut short");
});
