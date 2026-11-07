// The Patient page's tabs (app/portal/patient-layout.ts): laid out from what the study holds, then
// from its profiles, which only add the Mutational Signatures tab.
import { test } from "node:test";
import assert from "node:assert/strict";
import { patientLayout } from "../app/portal/patient-layout.ts";
import type { ProfileInfo } from "../lib/profile-catalog.ts";

const q = { study: "s", patient: "P1" };
const SIG = [{ profile: "mutational_signatures_contribution_SBS", type: "GENERIC_ASSAY", assayType: "MUTATIONAL_SIGNATURE" } as unknown as ProfileInfo];

test("before the profiles are known, every tab but Mutational Signatures is laid out, under its final name", () => {
  const first = patientLayout(q, { profileCatalog: [], held: ["MUTATION", "CNA"], partial: true });
  const full = patientLayout(q, { profileCatalog: SIG, held: ["MUTATION", "CNA"] });
  assert.equal(first.partial, true);
  assert.equal(full.partial, undefined);
  const titles = (l: typeof first) => l.tabs.map((t) => t.title);
  assert.deepEqual(titles(full).filter((t) => t !== "Mutational Signatures"), titles(first));
  assert.ok(titles(full).includes("Mutational Signatures"));
  first.names.forEach((n, i) => assert.deepEqual(full.doc.views![full.names.indexOf(n)], first.doc.views![i], n));
});

test("the Summary's views are the timeline, the genomic overview and the alterations", () => {
  const l = patientLayout(q, { profileCatalog: [], held: ["MUTATION", "CNA"], partial: true });
  assert.deepEqual(l.names.filter((n) => n.startsWith("Summary")), ["Summary › Clinical timeline", "Summary › Genomic overview", "Summary › Genomic alterations"]);
});

test("the Mutational Signatures tab draws the signatures view, over the sample alone in sample mode", () => {
  const l = patientLayout(q, { profileCatalog: SIG, held: ["MUTATION"] });
  const at = l.names.indexOf("Mutational Signatures › Mutational signatures");
  assert.ok(at >= 0, l.names.join(", "));
  assert.deepEqual(l.doc.views![at], { kind: "signatures", cohorts: ["Patient"] });
  const s = patientLayout({ study: "s", sample: "S1" }, { profileCatalog: SIG, held: ["MUTATION"] });
  assert.deepEqual(s.doc.views![s.names.indexOf("Mutational Signatures › Mutational signatures")], { kind: "signatures", samples: "cohort", cohorts: ["Sample"] });
  // a generic assay that is not a signature contribution profile adds no tab
  const other = [{ profile: "armlevel_cna", type: "GENERIC_ASSAY", assayType: "ARMLEVEL_CNA" } as unknown as ProfileInfo];
  assert.ok(!patientLayout(q, { profileCatalog: other, held: ["MUTATION"] }).tabs.some((t) => t.title === "Mutational Signatures"));
});
