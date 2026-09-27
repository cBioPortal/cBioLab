// Structural checks for the paper-reproductions gallery (lib/reproductions.ts). No database here
// — that's what the live-verification pass this file was built from is for; this just guards the
// shape every entry must have for the /reproductions page and its "notes explain the paper
// connection" promise to hold, so a future entry can't silently skip the part that matters.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { REPRODUCTIONS } from "../lib/reproductions.ts";

describe("REPRODUCTIONS: every entry carries the notes that are this feature's whole point", () => {
  test("slugs are unique and url-safe", () => {
    const slugs = REPRODUCTIONS.map((r) => r.slug);
    assert.equal(new Set(slugs).size, slugs.length, "duplicate slug");
    for (const s of slugs) assert.match(s, /^[a-z0-9-]+$/, "slug '" + s + "' must be lowercase, digits and hyphens only");
  });

  test("every reproduction has a badge, a summary, and at least one finding", () => {
    for (const r of REPRODUCTIONS) {
      assert.ok(["full", "partial", "gap", "bugfound"].includes(r.badge), r.slug + ": bad badge");
      assert.ok(r.summary && r.summary.length > 20, r.slug + ": summary too short or missing");
      assert.ok(r.findings.length > 0, r.slug + ": no findings");
      for (const f of r.findings) {
        assert.ok(["match", "partial", "gap"].includes(f.verdict), r.slug + ": bad finding verdict");
        assert.ok(f.claim && f.result, r.slug + ": finding missing claim or result");
      }
    }
  });

  test("every document has doc-level notes AND every view has its own note — the actual mechanism", () => {
    for (const r of REPRODUCTIONS) {
      assert.ok(r.doc.notes && r.doc.notes.length > 20, r.slug + ": doc.notes missing or too short");
      assert.ok(r.doc.views && r.doc.views.length > 0, r.slug + ": document has no views");
      for (const v of r.doc.views!) {
        assert.ok((v as { note?: string }).note && (v as { note?: string }).note!.length > 20,
          r.slug + ": a view (" + v.kind + ") has no note explaining its paper connection");
      }
    }
  });

  test("every view's cohorts (when given) name a cohort that actually exists on the document", () => {
    for (const r of REPRODUCTIONS) {
      const names = new Set(Object.keys(r.doc.cohorts || {}));
      for (const v of r.doc.views!) {
        for (const c of (v as { cohorts?: string[] }).cohorts || [])
          assert.ok(names.has(c), r.slug + ": view names cohort '" + c + "' that isn't defined");
      }
    }
  });

  test("a bugfound-badged reproduction names the bug in its summary or notes", () => {
    for (const r of REPRODUCTIONS.filter((x) => x.badge === "bugfound")) {
      const text = (r.summary + " " + r.doc.notes).toLowerCase();
      assert.ok(/bug|correctness|false|silent/.test(text), r.slug + ": bugfound badge but no bug named in summary/notes");
    }
  });
});
