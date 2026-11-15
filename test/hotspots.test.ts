// Cancer Hotspots as a putative-driver source (lib/hotspots.ts): the gene list the portal asks about
// and the one-mutation call cBioPortal makes from Genome Nexus's hotspot list (isLinearClusterHotspot,
// packages/cbioportal-utils/src/hotspot/CancerHotspotsUtils.ts 98-126, after
// filterMutationsOnNonHotspotGenes, src/shared/lib/CancerHotspotsUtils.ts 33-40). The rows cited are
// the spec table's (H*, D*). The SQL form is run against the fixture study by
// scripts/check-hotspot-drivers.ts, never matched here as text.
import test from "node:test";
import assert from "node:assert/strict";
import { HOTSPOT_GENES, isHotspotCall, hotspotKeysSql } from "../lib/hotspots.ts";

const single = { type: "single residue" }, indel = { type: "in-frame indel" }, splice = { type: "splice site" }, d3 = { type: "3d" };

test("the gene list is the portal's hotspotGenes.json", () => {
  assert.equal(HOTSPOT_GENES.size, 684);
  for (const g of ["KRAS", "TP53", "PIK3CA", "BRAF", "CTNNB1", "H3F3A", "ABCB1"]) assert.ok(HOTSPOT_GENES.has(g), g);
  // H1: the list predates the H3F3A -> H3-3A rename, and TERT is not on it
  for (const g of ["H3-3A", "TERT", "kras", ""]) assert.equal(HOTSPOT_GENES.has(g), false, g);
});

test("H1: a gene not on the list is never asked, whatever is stored for it", () => {
  assert.equal(isHotspotCall("H3-3A", "Missense_Mutation", [single]), false);
  assert.equal(isHotspotCall("TERT", "5'Flank", [single, splice]), false);
  // the list is matched exactly (Array.includes), so a lowercase symbol is not on it
  assert.equal(isHotspotCall("kras", "Missense_Mutation", [single]), false);
});

test("H1 (CHU 37): a mutation with no gene symbol is kept by the gene filter", () => {
  // filterMutationsOnNonHotspotGenes keeps `!m.gene.hugoGeneSymbol`; the type rule then decides
  assert.equal(isHotspotCall(null, "Missense_Mutation", [single]), true);
  assert.equal(isHotspotCall(undefined, "Missense_Mutation", [single]), true);
  assert.equal(isHotspotCall("", "Missense_Mutation", [single]), true);
  assert.equal(isHotspotCall(null, "Missense_Mutation", [d3]), false);
});

test("H2, H3: a non-splice mutation is a hotspot on a single-residue or in-frame-indel hotspot", () => {
  assert.equal(isHotspotCall("KRAS", "Missense_Mutation", [single]), true, "H2");
  assert.equal(isHotspotCall("CTNNB1", "In_Frame_Del", [indel]), true, "H3");
  assert.equal(isHotspotCall("EGFR", "In_Frame_Ins", [indel]), true, "H3");
  // the type is not tied to the mutation's own class: a missense on an in-frame-indel hotspot counts
  assert.equal(isHotspotCall("PIK3CA", "Missense_Mutation", [indel]), true, "H3 (type alone decides)");
  assert.equal(isHotspotCall("TP53", "Nonsense_Mutation", [single]), true, "H2 (any non-splice class)");
});

test("H2: a location with a 3d and a single-residue hotspot (the warehouse's common mix) is a hotspot", () => {
  assert.equal(isHotspotCall("BRAF", "Missense_Mutation", [d3, single]), true);
  assert.equal(isHotspotCall("TP53", "Missense_Mutation", [single, d3]), true);
});

test("H4, H5: a non-splice mutation on only a 3d or only a splice-site hotspot is not one", () => {
  assert.equal(isHotspotCall("PBRM1", "Missense_Mutation", [d3]), false, "H4");
  assert.equal(isHotspotCall("TP53", "Missense_Mutation", [splice]), false, "H5");
  assert.equal(isHotspotCall("TP53", "Missense_Mutation", [d3, splice]), false, "H4 + H5");
});

test("H6: a mutation type containing 'splice', in any case, is a hotspot on a splice-site hotspot", () => {
  for (const t of ["Splice_Site", "Splice_Region", "splice_site", "splice", "SPLICE_SITE"])
    assert.equal(isHotspotCall("TP53", t, [splice]), true, t);
  assert.equal(isHotspotCall("TP53", "Splice_Site", [d3, splice]), true, "mixed list");
});

test("H7: a splice mutation is not a hotspot on a single-residue, in-frame-indel or 3d hotspot", () => {
  for (const t of ["Splice_Site", "Splice_Region", "splice"]) {
    assert.equal(isHotspotCall("TP53", t, [single]), false, t + " single residue");
    assert.equal(isHotspotCall("TP53", t, [indel]), false, t + " in-frame indel");
    assert.equal(isHotspotCall("TP53", t, [d3]), false, t + " 3d");
    assert.equal(isHotspotCall("TP53", t, [single, indel, d3]), false, t + " all three");
  }
});

test("H8: no hotspot at the location is no hotspot", () => {
  assert.equal(isHotspotCall("KRAS", "Missense_Mutation", []), false);
  assert.equal(isHotspotCall("TP53", "Splice_Site", []), false);
});

test("H11: an absent mutation type takes the non-splice branch", () => {
  for (const t of [null, undefined, ""]) {
    assert.equal(isHotspotCall("KRAS", t, [single]), true, String(t) + " single residue");
    assert.equal(isHotspotCall("KRAS", t, [indel]), true, String(t) + " in-frame indel");
    assert.equal(isHotspotCall("KRAS", t, [splice]), false, String(t) + " splice site");
  }
});

test("H12: the hotspot's own gene is not compared; the type rule alone decides", () => {
  assert.equal(isHotspotCall("KRAS", "Missense_Mutation", [{ type: "single residue", hugoSymbol: "NRAS", transcriptId: "ENST00000369535" } as { type: string }]), true);
  assert.equal(isHotspotCall("KRAS", "Missense_Mutation", [{ type: "3d", hugoSymbol: "KRAS" } as { type: string }]), false);
});

test("the hotspot type is matched as legacy does: lowercased, by substring", () => {
  // PCHU 108-122: hotspot.type.toLowerCase().includes('single' | 'indel' | 'splice')
  assert.equal(isHotspotCall("KRAS", "Missense_Mutation", [{ type: "Single Residue" }]), true);
  assert.equal(isHotspotCall("EGFR", "In_Frame_Del", [{ type: "In-Frame Indel" }]), true);
  assert.equal(isHotspotCall("TP53", "Splice_Site", [{ type: "Splice Site" }]), true);
  assert.equal(isHotspotCall("TP53", "Missense_Mutation", [{ type: "3D" }]), false);
});

test("an entry without a type matches neither branch", () => {
  // legacy would throw on hotspot.type.toLowerCase(); a record that lacks it is no hotspot here
  assert.equal(isHotspotCall("KRAS", "Missense_Mutation", [{}]), false);
  assert.equal(isHotspotCall("KRAS", "Missense_Mutation", [{ type: null }]), false);
  assert.equal(isHotspotCall("TP53", "Splice_Site", [{ type: null }, {}]), false);
  assert.equal(isHotspotCall("KRAS", "Missense_Mutation", [{ type: null }, single]), true, "another entry still counts");
});

test("H13: no Genome Nexus pin for either genome: no hotspot SQL at all", () => {
  assert.equal(hotspotKeysSql("db", ["s"], null, { hg19: null, hg38: null }), null);
  assert.equal(hotspotKeysSql("db", ["s"], ["KRAS"], { hg19: null, hg38: null }), null);
});

test("a pin for either genome gives SQL", () => {
  for (const pins of [{ hg19: "r1", hg38: null }, { hg19: null, hg38: "r2" }, { hg19: "r1", hg38: "r2" }]) {
    const sql = hotspotKeysSql("db", ["s"], null, pins);
    assert.equal(typeof sql, "string", JSON.stringify(pins));
    assert.ok(sql!.length > 0);
  }
});

