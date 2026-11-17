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

test("the genomic overview is the patient's mutations and copy-number segments, shown when the study has either, as the portal's", () => {
  const l = patientLayout(q, { profileCatalog: [], held: ["MUTATION", "CNA"] });
  const v = l.doc.views![l.names.indexOf("Summary › Genomic overview")] as any;
  assert.equal(v.kind, "segments"); assert.equal(v.overview, true);
  assert.equal(patientLayout(q, { profileCatalog: [], held: ["MUTATION"] }).names.includes("Summary › Genomic overview"), true);
  assert.equal(patientLayout(q, { profileCatalog: [], held: ["CNA"] }).names.includes("Summary › Genomic overview"), true);
  assert.equal(patientLayout(q, { profileCatalog: [], held: ["SV"] }).names.includes("Summary › Genomic overview"), false);
});

const evo = (l: ReturnType<typeof patientLayout>) => l.tabs.some((t) => t.title === "Genomic Evolution");
const titlesOf = (l: ReturnType<typeof patientLayout>) => l.tabs.map((t) => t.title);

test("PTB-TAB-2, PTB-MD-1: Genomic Evolution is offered for a patient with mutations, more than one sample and allele counts", () => {
  assert.equal(evo(patientLayout(q, { profileCatalog: [], held: ["MUTATION"], samples: 2, vaf: true })), true);
});

test("PTB-MD-3: more than one sample but no mutation with VAF > 0 gives no Genomic Evolution", () => {
  assert.equal(evo(patientLayout(q, { profileCatalog: [], held: ["MUTATION"], samples: 2, vaf: false })), false);
});

test("PTB-MD-3: VAF not known yet gives no Genomic Evolution", () => {
  assert.equal(evo(patientLayout(q, { profileCatalog: [], held: ["MUTATION"], samples: 2 })), false);
  assert.equal(evo(patientLayout(q, { profileCatalog: [], held: ["MUTATION"], samples: 2, vaf: undefined })), false);
});

test("PTB-MD-2: a single sample gives no Genomic Evolution, nor does an unknown sample count", () => {
  assert.equal(evo(patientLayout(q, { profileCatalog: [], held: ["MUTATION"], samples: 1, vaf: true })), false);
  assert.equal(evo(patientLayout(q, { profileCatalog: [], held: ["MUTATION"], vaf: true })), false);
});

test("PTB-TAB-2: sample mode never has Genomic Evolution", () => {
  assert.equal(evo(patientLayout({ study: "s", sample: "S1" }, { profileCatalog: [], held: ["MUTATION"], samples: 3, vaf: true })), false);
});

test("PTB-TAB-2: a study holding no mutations gives no Genomic Evolution", () => {
  assert.equal(evo(patientLayout(q, { profileCatalog: [], held: ["CNA"], samples: 2, vaf: true })), false);
});

test("PTB-TAB-2: with everything present the tabs come in the legacy order", () => {
  const l = patientLayout(q, { profileCatalog: SIG, held: ["MUTATION", "CNA"], samples: 2, vaf: true });
  assert.deepEqual(titlesOf(l), ["Summary", "Genomic Evolution", "Pathways", "Clinical Data", "Files & Links", "Mutational Signatures"]);
});

test("PTB-TAB-3, PTB-MD-12: no Clinical Trials tab, whatever the patient holds", () => {
  const cases = [
    patientLayout(q, { profileCatalog: SIG, held: ["MUTATION", "CNA", "SV"], samples: 2, vaf: true }),
    patientLayout(q, { profileCatalog: [], held: [] }),
    patientLayout({ study: "s", sample: "S1" }, { profileCatalog: SIG, held: ["MUTATION"], samples: 1 }),
  ];
  for (const l of cases) assert.ok(!titlesOf(l).includes("Clinical Trials"), titlesOf(l).join(", "));
});

test("L1 PTB-CD-2: the Clinical Data tab's patient and sample tables are transposed", () => {
  const l = patientLayout(q, { profileCatalog: [], held: [] });
  const at = (n: string) => l.doc.views![l.names.indexOf(n)] as any;
  assert.ok(l.names.includes("Clinical Data › Patient") && l.names.includes("Clinical Data › Samples"), l.names.join(", "));
  assert.partialDeepStrictEqual(at("Clinical Data › Patient"), { kind: "table", unit: "patient", transpose: true });
  assert.partialDeepStrictEqual(at("Clinical Data › Samples"), { kind: "table", unit: "sample", transpose: true });
});

test("L2 PTB-CD-4: the Clinical Data tab's Timeline Data view is the event tables", () => {
  const l = patientLayout(q, { profileCatalog: [], held: ["MUTATION", "CNA"] });
  const at = l.names.indexOf("Clinical Data › Timeline Data");
  assert.ok(at >= 0, l.names.join(", "));
  assert.equal((l.doc.views![at] as { kind: string; tables?: boolean }).kind, "timeline");
  assert.equal((l.doc.views![at] as { tables?: boolean }).tables, true);
});
