// The order of a table's toolbar controls (MUT-TB-2). Legacy cBioPortal's LazyMobXTable toolbar lists
// Copy, Download TSV, Columns, then the search box; a portal table (downloadFormat "table-tsv") follows it,
// other tables keep cBioLab's order: search, Columns, Download CSV. Row ids are the spec table's (O1-O3).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// lib/ch.ts reads these at import
process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "fed_a";
process.env.CLICKHOUSE_USER = "u";
process.env.CLICKHOUSE_PASSWORD = "p";
process.env.STUDY_ID = "s1";
for (const k of ["CLICKHOUSE2_URL", "FEDERATION_PEERS", "LOOPBACK_PEER", "CH_RUN_CACHE", "ONCOKB_PIN"]) delete process.env[k];

register("./support/tsx-loader.mjs", import.meta.url);
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");
const dataTable = await import("../app/_table/DataTable.tsx") as Record<string, unknown>;

const realLog = console.log;
before(() => { console.log = () => {}; });
after(() => { console.log = realLog; });

const COLS = [{ id: "sample", name: "Sample ID", numeric: false }];
const table = (total: number, all: number) => ({
  columns: COLS, shown: ["sample"], defaults: ["sample"], query: {},
  rows: [{ cohort: "A", study: "s1", patient: "P1", sample: "S1", values: ["S1"] }], offset: 0, pageSize: 25,
  lists: [{ cohort: "A", study: "s1", total, all }], total, all,
});
/** the markup of the table's bar (class "dt-bar") */
const barOf = (props: Record<string, unknown>): string => {
  const t = table(1, 1);
  const html = renderToStaticMarkup(createElement(dataTable.DataTable as never,
    { t, query: t.query, unit: "mutations", updating: false, vi: 0, onQuery: () => {}, docJson: () => "{}", ...props } as never));
  const i = html.search(/class="[^"]*\bdt-bar\b/);
  assert.ok(i >= 0, "the table has a dt-bar");
  return html.slice(i);
};
const at = (bar: string, s: string): number => {
  const i = bar.indexOf(s);
  assert.ok(i >= 0, `the bar holds ${JSON.stringify(s)}`);
  return i;
};
const SEARCH = 'type="search"';

describe("MUT-TB-2 toolbar order", () => {
  test("O1 table-tsv: Copy, download TSV, columns, search", () => {
    const bar = barOf({ downloadFormat: "table-tsv" });
    const copy = at(bar, "Copy"), tsv = at(bar, "download TSV ("), cols = at(bar, "columns ("), search = at(bar, SEARCH);
    assert.ok(copy < tsv, "Copy before download TSV");
    assert.ok(tsv < cols, "download TSV before columns");
    assert.ok(cols < search, "columns before search");
  });
  test("O2 default (csv): search, columns, download CSV", () => {
    const bar = barOf({});
    const search = at(bar, SEARCH), cols = at(bar, "columns ("), csv = at(bar, "download CSV (");
    assert.ok(search < cols, "search before columns");
    assert.ok(cols < csv, "columns before download CSV");
  });
  test("O3 plain table-tsv: no columns; Copy, download TSV, search", () => {
    const bar = barOf({ downloadFormat: "table-tsv", plain: true });
    assert.equal(bar.indexOf("columns ("), -1, "no columns button");
    const copy = at(bar, "Copy"), tsv = at(bar, "download TSV ("), search = at(bar, SEARCH);
    assert.ok(copy < tsv, "Copy before download TSV");
    assert.ok(tsv < search, "download TSV before search");
  });
});
