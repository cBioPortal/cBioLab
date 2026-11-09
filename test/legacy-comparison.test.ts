// The Comparison page's "Open in cBioPortal": the session it saves, as cBioPortal's own "Compare"
// buttons save one (getGroupParameters, ComparisonSession), and the link to it (GroupComparisonTabs).
import test from "node:test";
import assert from "node:assert/strict";
import { comparisonSession, comparisonHref, legacyComparisonState, SESSION_MAX_GROUPS, SESSION_MAX_SAMPLES } from "../lib/legacy-comparison.ts";

test("a session holds each group's samples of the one study, in the page's order", () => {
  const s = comparisonSession("brca", [{ name: "Basal", samples: ["S2", "S1", "S1"] }, { name: "LumA", samples: ["S3"] }]);
  assert.deepEqual(s, {
    groups: [
      { name: "Basal", description: "", studies: [{ id: "brca", samples: ["S2", "S1"] }], origin: ["brca"] },
      { name: "LumA", description: "", studies: [{ id: "brca", samples: ["S3"] }], origin: ["brca"] },
    ],
    origin: ["brca"],
    groupNameOrder: ["Basal", "LumA"],
  });
});

test("a session is refused, not cut: no groups, an empty group, too many groups or samples", () => {
  assert.throws(() => comparisonSession("brca", []), /no groups/);
  assert.throws(() => comparisonSession("brca", [{ name: "A", samples: ["x"] }, { name: "B", samples: [] }]), /“B” has no samples in brca/);
  assert.throws(() => comparisonSession("brca", Array.from({ length: SESSION_MAX_GROUPS + 1 }, (_, i) => ({ name: "g" + i, samples: ["x"] }))), /at most 20/);
  const many = Array.from({ length: SESSION_MAX_SAMPLES + 1 }, (_, i) => "s" + i);
  assert.throws(() => comparisonSession("brca", [{ name: "A", samples: many }]), /at most 100000/);
});

test("the link opens the tab like the page's open one, or the first", () => {
  assert.equal(comparisonHref("https://www.cbioportal.org/", "abc", "Mutations"), "https://www.cbioportal.org/comparison/mutations?comparisonId=abc");
  assert.equal(comparisonHref("https://www.cbioportal.org", "abc", "Genomic Alterations"), "https://www.cbioportal.org/comparison/alterations?comparisonId=abc");
  assert.equal(comparisonHref("https://www.cbioportal.org", "abc", "Generic Assays"), "https://www.cbioportal.org/comparison?comparisonId=abc");
  assert.equal(comparisonHref("https://www.cbioportal.org", "abc"), "https://www.cbioportal.org/comparison?comparisonId=abc");
});

test("the button waits for the study list, says why it cannot, or what it will do", () => {
  assert.equal(legacyComparisonState("brca", ["A", "B"], "Mutations", null), null);
  assert.match(legacyComparisonState("brca", ["A", "B"], "Mutations", {})!.tip, /waiting for the study list/);
  assert.deepEqual(legacyComparisonState("brca", ["A", "B"], "Mutations", { brca: { why: "brca is a consortium study" } }), { ok: false, tip: "brca is a consortium study" });
  assert.equal(legacyComparisonState("brca", [], "Mutations", { brca: { portal: "https://www.cbioportal.org" } })!.ok, false);
  const ok = legacyComparisonState("brca", ["A", "B"], "Mutations", { brca: { portal: "https://www.cbioportal.org" } })!;
  assert.equal(ok.ok, true);
  assert.match(ok.tip, /save these 2 groups to www\.cbioportal\.org's session service .* on its Mutations tab/);
  assert.match(legacyComparisonState("brca", ["A"], "Generic Assays", { brca: { portal: "https://www.cbioportal.org" } })!.tip, /first tab — cBioPortal has no tab like “Generic Assays”/);
});
