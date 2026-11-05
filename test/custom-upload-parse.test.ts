// Uploaded tables into rows and columns (parseUpload, app/lab/custom-data-client.ts). A value with
// a separator in it must stay one value: splitting "Lower GI (Rectal, Colorectal, Anal)" on its
// commas shifts every later value of the row into the wrong column.
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseUpload } from "../app/lab/custom-data-client.ts";

const names = (p: ReturnType<typeof parseUpload>) => [p.idColumn, ...p.columns.map((c) => c.name)];

test("CSV with quoted commas in a header and in values, CRLF line ends", () => {
  const p = parseUpload('SAMPLE_ID,histology,"Therapy (chemo, IO)? (Yes=1,No=0)",n\r\n' +
    'P-1,"Lower GI (Rectal, Colorectal, Anal)",1,3\r\nP-2,Lung,0,4\r\n');
  assert.deepEqual(names(p), ["SAMPLE_ID", "HISTOLOGY", "THERAPY_CHEMO_IO_YES_1_NO_0", "N"]);
  assert.deepEqual(p.rows, [["P-1", "Lower GI (Rectal, Colorectal, Anal)", "1", "3"], ["P-2", "Lung", "0", "4"]]);
  assert.equal(p.level, "sample");
  assert.deepEqual(p.columns.map((c) => c.datatype), ["STRING", "NUMBER", "NUMBER"]);
});

test("doubled quotes and a line break inside quotes", () => {
  const p = parseUpload('PATIENT_ID,NOTE\nP-1,"said ""no""\nthen left"\nP-2,ok\n');
  assert.deepEqual(p.rows, [["P-1", 'said "no"\nthen left'], ["P-2", "ok"]]);
});

test("tab-separated: commas are ordinary characters", () => {
  const p = parseUpload("PATIENT_ID\tSITE\tKPS\nP-1\tBrain, left\t80\nP-2\tLiver\t70\n");
  assert.deepEqual(p.rows, [["P-1", "Brain, left", "80"], ["P-2", "Liver", "70"]]);
});

test("semicolon-separated (European spreadsheet export)", () => {
  const p = parseUpload("PATIENT_ID;SITE;KPS\nP-1;Brain;80\nP-2;Liver;70\n");
  assert.deepEqual(names(p), ["PATIENT_ID", "SITE", "KPS"]);
  assert.deepEqual(p.rows, [["P-1", "Brain", "80"], ["P-2", "Liver", "70"]]);
});

test("comment lines, blank lines, a byte-order mark and trailing empty fields are skipped", () => {
  const p = parseUpload("﻿# exported 2026-11-05\nPATIENT_ID,SITE\n\nP-1,Brain,,\n   \nP-2,Liver\n");
  assert.deepEqual(p.rows, [["P-1", "Brain"], ["P-2", "Liver"]]);
});

test("NA-like values become blanks", () => {
  assert.deepEqual(parseUpload("PATIENT_ID,KPS\nP-1,NA\nP-2,80\n").rows, [["P-1", ""], ["P-2", "80"]]);
});

test("a quote never closed is refused, not swallowed", () => {
  assert.throws(() => parseUpload('PATIENT_ID,SITE\nP-1,"Brain\nP-2,Liver\n'), /row \d+: .*quot/i);
});

test("a row with more values than the header is refused, naming the row", () => {
  assert.throws(() => parseUpload("PATIENT_ID,SITE\nP-1,Brain\nP-2,Lower GI (Rectal, Anal)\n"),
    /data row 2 has 3 fields but the header has 2/);
});

test("a header alone is refused", () => {
  assert.throws(() => parseUpload("PATIENT_ID,SITE\n"), /at least one row of data/);
});
