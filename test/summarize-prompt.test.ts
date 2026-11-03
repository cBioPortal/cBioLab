// The patient page's Summarize prompt (lib/summarize-prompt.ts): it names the patient and the
// tools, and carries each rule a summary is held to, so a rewrite cannot drop one unnoticed.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { patientSummaryPrompt, SUMMARY_SECTIONS } from "../lib/summarize-prompt.ts";
import { portalTools } from "../app/portal/agent-tools.ts";

const p = patientSummaryPrompt({ kind: "patient", study: "s1", id: "P-1" });

describe("the patient summary prompt", () => {
  test("names the patient and the study; a sample's names the sample", () => {
    assert.match(p, /patient P-1 of study s1/);
    assert.match(patientSummaryPrompt({ kind: "sample", study: "s1", id: "S-1" }), /sample S-1 of study s1/);
  });
  test("asks for the sections in order", () => {
    const at = SUMMARY_SECTIONS.map((s) => p.indexOf("**" + s + "**"));
    assert.ok(at.every((i) => i >= 0), "every section is named");
    assert.deepEqual([...at].sort((a, b) => a - b), at);
  });
  test("names only tools the portal pages expose", () => {
    const have = portalTools(() => { throw new Error("not called"); }).map((t) => t.name);
    for (const name of p.match(/portal_[a-z_]+/g) || []) assert.ok(have.includes(name), name + " is not a portal tool");
    assert.ok((p.match(/portal_[a-z_]+/g) || []).length >= 2);
  });
  test("carries the rules: sources, not profiled, no events recorded, truncation, no advice", () => {
    assert.match(p, /tab or view it came from/);
    assert.match(p, /"not profiled", never wild-type/);
    assert.match(p, /"no events recorded", never "none occurred"/);
    assert.match(p, /left out/);
    assert.match(p, /no prognosis, no treatment advice/);
  });
});
