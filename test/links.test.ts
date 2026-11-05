// Stored links' rules (lib/links.ts, docs/LINKS.md): what a page stores, how its parameters read
// back, and what a write keeps. Pure, so no server and no browser. The store itself is
// test/support/store-contracts.ts (linkContract); the page's use of it, test/e2e/links.cjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LINK_PARAM, LONG_PARAM, LINK_URL_MAX, LINK_STORE_MAX, LINK_ID, linkUrlMax, validateLinkParams, canonicalLinkJson, effectiveParams,
  resolveWrite, planLink, shortSearch, type LinkParams } from "../lib/links.ts";
import { linkId, setRefsOf } from "../lib/link-store.ts";
import { encodeUrlJson } from "../lib/url-json.ts";
import { withdrawnMessage, withdrawalNote, WITHDRAWAL_NOTE_MAX } from "../lib/id-set-withdrawal.ts";

const LONG = "1." + "x".repeat(LONG_PARAM + 1);
const ID = "abcdefghijklmnopqrstuv";
const knownOnly = (id: string, p: LinkParams) => (x: string) => x === id ? p : undefined;

describe("which links are stored, and what stays in the URL", () => {
  test("a query string up to the limit stays as it is", () => {
    assert.equal(planLink("?doc=" + "x".repeat(100), 200), null);
    assert.equal(planLink("?" + "a=1&".repeat(500), 200), null, "past the limit but nothing long to store");
  });
  test("past the limit, the long parameters are stored and the short ones kept in order", () => {
    const search = "?tab=analysis&doc=" + LONG + "&study=luad_tcga&changes=" + LONG;
    assert.deepEqual(planLink(search, 100), { stored: { doc: LONG, changes: LONG }, kept: [["tab", "analysis"], ["study", "luad_tcga"]] });
  });
  test("the short URL names the link first, then what stayed", () => {
    assert.equal(shortSearch(ID, [["tab", "analysis"], ["s", "old"]]), "?s=" + ID + "&tab=analysis");
  });
  test("the limit defaults to LINK_URL_MAX and takes a deployment's or a test's own", () => {
    assert.equal(linkUrlMax(undefined), LINK_URL_MAX);
    assert.equal(linkUrlMax(""), LINK_URL_MAX);
    assert.equal(linkUrlMax("300"), 300);
    assert.equal(linkUrlMax("12"), LINK_URL_MAX, "a limit too small to hold ?s= itself is ignored");
    assert.equal(linkUrlMax("lots"), LINK_URL_MAX);
  });
});

describe("reading a page's parameters", () => {
  test("a stored link's parameters come back, and the URL's own win over them", () => {
    const q = effectiveParams("?s=" + ID + "&tab=explore", knownOnly(ID, { doc: LONG, tab: "analysis" }));
    assert.equal(q.get("doc"), LONG);
    assert.equal(q.get("tab"), "explore", "written in the URL after the link was opened");
    assert.equal(q.has(LINK_PARAM), false);
  });
  test("a link not yet read leaves the URL as it is, so the page can tell it is waiting", () => {
    const q = effectiveParams("?s=" + ID + "&tab=explore", () => undefined);
    assert.equal(q.get(LINK_PARAM), ID);
    assert.equal(q.get("doc"), null);
  });
});

describe("writing a page's URL", () => {
  test("a write beside a known link keeps what the link held and drops the link", () => {
    const known = knownOnly(ID, { doc: LONG, changes: "c1" });
    assert.equal(resolveWrite("?s=" + ID + "&tab=x&changes=c2", known), "?doc=" + encodeURIComponent(LONG).replace(/%20/g, "+") + "&tab=x&changes=c2");
  });
  test("a write naming an unknown link, or none, is written as it is", () => {
    assert.equal(resolveWrite("?s=" + ID + "&tab=x", () => undefined), "?s=" + ID + "&tab=x");
    assert.equal(resolveWrite("?tab=x", () => undefined), "?tab=x");
    assert.equal(resolveWrite("", () => undefined), "");
  });
  test("store, shorten, reopen: the page reads back exactly what it wrote", () => {
    const written = "?tab=analysis&doc=" + encodeURIComponent(LONG) + "&study=s1";
    const plan = planLink(written, 64)!;
    const id = linkId(plan.stored);
    const short = shortSearch(id, plan.kept);
    assert.ok(short.length < 64);
    const back = effectiveParams(short, knownOnly(id, plan.stored));
    assert.deepEqual(Object.fromEntries(back), Object.fromEntries(new URLSearchParams(written)));
  });
});

describe("what may be stored", () => {
  test("names, text values and size are checked", () => {
    assert.deepEqual(validateLinkParams({ doc: "a", tab: "b" }), { doc: "a", tab: "b" });
    assert.throws(() => validateLinkParams([]), /must be an object/);
    assert.throws(() => validateLinkParams({ "a b": "x" }), /letters, digits and _/);
    assert.throws(() => validateLinkParams({ s: "x" }), /cannot hold another stored link/);
    assert.throws(() => validateLinkParams({ doc: { a: 1 } }), /must be text/);
    assert.throws(() => validateLinkParams({ doc: "x".repeat(LINK_STORE_MAX) }), /holds at most/);
  });
  test("the id is the hash of the parameters, whatever order they were written in", () => {
    assert.equal(canonicalLinkJson({ b: "2", a: "1" }), canonicalLinkJson({ a: "1", b: "2" }));
    assert.equal(linkId({ b: "2", a: "1" }), linkId({ a: "1", b: "2" }));
    assert.notEqual(linkId({ a: "1" }), linkId({ a: "2" }));
    assert.match(linkId({ a: "1" }), LINK_ID);
  });
  test("the stored id sets a link names are found in any parameter that decodes", () => {
    const a = "0b7f9c1e-2f4a-4c3b-9d8e-1a2b3c4d5e6f", b = "1b7f9c1e-2f4a-4c3b-9d8e-1a2b3c4d5e6f";
    assert.deepEqual(setRefsOf({
      doc: encodeUrlJson({ cohorts: { x: { all: [{ kind: "sampleList", set: a }] } } }),
      cohort: encodeUrlJson({ all: [{ kind: "patientList", set: b }, { kind: "patientList", set: a }] }),
      tab: "analysis", junk: "1.not-deflate",
    }).sort(), [a, b]);
  });
});

describe("a withdrawn set's refusal", () => {
  const w = { set: "x", name: "responders", by: "pi@lab.org", at: "2026-11-05T10:00:00.000Z", note: null, replacedBy: null };
  test("says which set, who and when", () => {
    assert.equal(withdrawnMessage(w), "stored id set “responders” was withdrawn by its owner (pi@lab.org) on 2026-11-05.");
  });
  test("adds the owner's note, and where they point instead", () => {
    assert.equal(withdrawnMessage({ ...w, note: "pilot patients included.", replacedBy: { id: "y", name: "responders v2" } }),
      "stored id set “responders” was withdrawn by its owner (pi@lab.org) on 2026-11-05: pilot patients included. Its owner points to “responders v2” (set y) instead.");
  });
  test("a note is trimmed, empty is none, and a long one is refused", () => {
    assert.equal(withdrawalNote("  why  "), "why");
    assert.equal(withdrawalNote("   "), null);
    assert.equal(withdrawalNote(undefined), null);
    assert.throws(() => withdrawalNote(3), /must be text/);
    assert.throws(() => withdrawalNote("x".repeat(WITHDRAWAL_NOTE_MAX + 1)), /at most 1000 characters/);
  });
});
