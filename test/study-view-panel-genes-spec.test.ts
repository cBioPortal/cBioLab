// Written from docs/legacy-spec/parity/gene-tables-cases.md, rows GP6–GP11, without reference to
// the implementation.
// Covered elsewhere, not here:
//   GP6, GP8  the panel link, the dialog's title, loading and closing (UI wiring)
//   GP7       each fixture panel's genes A to Z (scripts/check-chart-freq.ts, against the fixture database)
//   GP10      an unknown panel refused by name (scripts/check-chart-freq.ts, against the fixture database)
//   GP11      a federation peer's study refused (the /api/genes route)
import { test } from "node:test";
import assert from "node:assert/strict";
import { panelGenes } from "../lib/genes.ts";
import { panelNote } from "../lib/study-view-gene-tables.ts";
import { GenesRequest, parseBody } from "../lib/api-schemas.ts";
import type { ChConn } from "../lib/ch.ts";

/** a connection nothing listens on: any query on it fails */
const UNREACHABLE: ChConn = { id: "x", url: "http://127.0.0.1:9", user: "u", password: "p", db: "cbio_x", label: "unreachable" };

// ---- GP9. WES ----

test("GP9: panelGenes(\"WES\") lists no genes, without asking the database", async () => {
  assert.deepEqual(await panelGenes("WES", UNREACHABLE), []);
});

test("GP9: panelNote for WES says whole-exome sequencing profiles every gene", () => {
  const note = panelNote("WES", []);
  assert.equal(typeof note, "string");
  assert.match(note!, /whole.exome/i);
  assert.match(note!, /every gene/i);
});

test("panelNote for a panel listing no genes says so", () => {
  assert.equal(panelNote("EMPTY_PANEL", []), "This panel lists no genes.");
});

test("GP7: panelNote for an ordinary panel with genes is null", () => {
  assert.equal(panelNote("IMPACT341", ["BRAF", "EGFR", "KRAS", "TP53"]), null);
});

// ---- GP10/GP11. The request ----

test("GP10: GenesRequest takes a panel's id and its study", () => {
  const b = parseBody(GenesRequest, { panel: { id: "DFCI-ONCOPANEL-3", study: "msk_impact_2017" } });
  assert.deepEqual(b.panel, { id: "DFCI-ONCOPANEL-3", study: "msk_impact_2017" });
});

test("GP10: GenesRequest refuses a panel id with a quote", () => {
  assert.throws(() => parseBody(GenesRequest, { panel: { id: "IMPACT341' OR '1'='1", study: "msk_impact_2017" } }), /panel/);
});

test("GP10: GenesRequest refuses a panel id with a semicolon", () => {
  assert.throws(() => parseBody(GenesRequest, { panel: { id: "IMPACT341; DROP TABLE gene", study: "msk_impact_2017" } }), /panel/);
});

test("GP11: GenesRequest refuses a panel without its study", () => {
  assert.throws(() => parseBody(GenesRequest, { panel: { id: "IMPACT341" } }), /panel/);
});
