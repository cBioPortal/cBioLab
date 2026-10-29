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
