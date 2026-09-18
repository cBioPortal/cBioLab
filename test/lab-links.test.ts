import test from "node:test";
import assert from "node:assert/strict";
import { decodeSpec, encodeSpec, isLocalSpec, labLinks, SPEC_URL_MAX } from "../lib/lab-links.ts";

const SPEC = { study: "msk_chord_2024", genes: ["TP53", { label: "RTK", genes: ["EGFR", "MET"] }], display: { showUnaltered: false } };

test("the link is the spec: a round trip returns exactly what went in", () => {
  assert.deepEqual(decodeSpec(encodeSpec(SPEC)), SPEC);
});

test("base64url only — the encoding survives a query string untouched", () => {
  const s = encodeSpec({ note: "a spec with +/= producing bytes: ÿÿÿ?&#" });
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  assert.equal(encodeURIComponent(s), s);
});

test("an ordinary figure travels whole, in both lab links", () => {
  const l = labLinks(SPEC)!;
  assert.equal(l.cut, undefined);
  assert.ok(l.cli.startsWith("/oncoprint-lab/cli?spec="));
  assert.ok(l.python.startsWith("/oncoprint-lab/python?spec="));
  assert.deepEqual(decodeSpec(new URL("http://x" + l.cli).searchParams.get("spec")!), SPEC);
});

test("an explicit id list too long for a URL is cut, and the cut is stated", () => {
  const ids = Array.from({ length: 40000 }, (_, i) => "s:P-" + String(i).padStart(7, "0"));
  const l = labLinks({ study: "s", cohort: { dsl: { all: [{ kind: "patientList", ids }] } } })!;
  assert.ok(l.cut && /the first [\d,]+ of 40,000 ids/.test(l.cut), String(l.cut));
  const back = decodeSpec(new URL("http://x" + l.cli).searchParams.get("spec")!) as any;
  const backIds = back.cohort.dsl.all[0].ids;
  assert.ok(backIds.length < ids.length);
  assert.equal(backIds[0], ids[0]);
  assert.ok(l.cli.length < SPEC_URL_MAX + 200);
});

test("pasted tables are cut by rows, keeping the header", () => {
  const rows = ["patient\tgene\ttype", ...Array.from({ length: 5000 }, (_, i) => `P${i}\tTP53\tMISSENSE`)].join("\n");
  const l = labLinks({ events: rows })!;
  const back = decodeSpec(new URL("http://x" + l.python).searchParams.get("spec")!) as { events: string };
  assert.ok(l.cut && /events: the first [\d,]+ of 5,000 rows/.test(l.cut), String(l.cut));
  assert.equal(back.events.split("\n")[0], "patient\tgene\ttype");
  assert.ok(back.events.split("\n").length < 5000);
});

test("a spec that cannot be cut small enough gets no link at all, rather than a wrong one", () => {
  // one enormous string is not a list of ids or a table: there is nothing safe to drop
  assert.equal(labLinks({ note: "x".repeat(20000) }), null);
});

test("pasted tables are recognised, so the lab pages read them instead of querying", () => {
  assert.equal(isLocalSpec({ events: "patient\tgene\n" }), true);
  assert.equal(isLocalSpec(SPEC), false);
});

test("both encodings agree — the browser's Buffer shim has no base64url, so neither path may ask for one", () => {
  const spec = { study: "s", note: "unicode: αβγ ✓", ids: ["P-1", "P-2"] };
  const withWeb = encodeSpec(spec);
  const b64 = globalThis.btoa, a64 = globalThis.atob;
  try {
    // @ts-expect-error — force the Buffer fallback the way a runtime without btoa would
    delete globalThis.btoa; // @ts-expect-error
    delete globalThis.atob;
    assert.equal(encodeSpec(spec), withWeb);
    assert.deepEqual(decodeSpec(withWeb), spec);
  } finally { globalThis.btoa = b64; globalThis.atob = a64; }
  assert.equal(withWeb, Buffer.from(JSON.stringify(spec), "utf8").toString("base64url"));
});
