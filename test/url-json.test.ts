import test from "node:test";
import assert from "node:assert/strict";
import { decodeUrlJson, encodeUrlJson, readUrlJson } from "../lib/url-json.ts";
import { EXAMPLES } from "../lib/dsl-reference.ts";
import { inflateRawSync } from "node:zlib";

const DOC = { dsl: "2.9", study: "luad_tcga", cohorts: { "EGFR-mutant": { all: [{ kind: "oql", q: "EGFR: MUT" }] }, "KRAS-mutant": { all: [{ kind: "oql", q: "KRAS: MUT" }] } },
  views: [{ kind: "survival", cohorts: ["EGFR-mutant", "KRAS-mutant"], endpoint: "OS" }] };
const plain = (x: unknown) => Buffer.from(JSON.stringify(x)).toString("base64url");

test("a round trip returns exactly what went in, for every gallery example", () => {
  for (const ex of EXAMPLES) assert.deepEqual(decodeUrlJson(encodeUrlJson(ex.doc)), ex.doc, ex.title);
});

test("the value survives a query string untouched", () => {
  const s = encodeUrlJson({ note: "+/= and ÿÿÿ?&# and ünïcode" });
  assert.match(s, /^1\.[A-Za-z0-9_-]+$/);
  assert.equal(encodeURIComponent(s), s);
  assert.deepEqual(decodeUrlJson(s), { note: "+/= and ÿÿÿ?&# and ünïcode" });
});

test("a link written before compression still opens", () => {
  assert.deepEqual(decodeUrlJson(plain(DOC)), DOC);
  assert.deepEqual(readUrlJson(plain({ note: "ünïcode" })), { note: "ünïcode" });
});

test("format 1 is plain raw deflate: any zlib reads it, and a link written with it reads forever", () => {
  const link = "1.q1ZKKc5RslIy0rNU0lEqLilNqQTyckoTU-JLktMTgWLJ-Rn5RSXFSlbVSq7ubkG6uaUliXklIG5iDlBndLVSdmZeClBTfmEOUHkhkAVSZ6XgGxqiVBtbq6PkHeQYTIw2kDq4NqC-sszUcqC9CKXFpUVlmWWJIPVwV0WjuArVslgdpdS8lIL8TJDFSv7BIHMB";
  assert.deepEqual(decodeUrlJson(link), DOC);
  assert.deepEqual(JSON.parse(inflateRawSync(Buffer.from(link.slice(2), "base64url")).toString("utf8")), DOC);
  assert.deepEqual(JSON.parse(inflateRawSync(Buffer.from(encodeUrlJson(DOC).slice(2), "base64url")).toString("utf8")), DOC);
});

test("a format this page does not know is refused by name, not misread", () => {
  assert.throws(() => decodeUrlJson("9.abc"), /newer format \(9\)/);
  assert.equal(readUrlJson("9.abc"), null);
  assert.equal(readUrlJson("1.not-deflate"), null);
  assert.equal(readUrlJson(null), null);
});

test("the gallery's documents are about half their plain size", () => {
  let before = 0, after = 0;
  for (const ex of EXAMPLES) { before += plain(ex.doc).length; after += encodeUrlJson(ex.doc).length; }
  assert.ok(after < before * 0.55, after + " of " + before);
});
