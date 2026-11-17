// The Genomic Alterations tab as one table under cBioPortal's checkbox tree of alteration types
// (lib/alteration-events.ts and runEnrichment's alteration "any"). Written from the legacy rules:
//   - cbioportal-frontend@cd8c6df src/shared/lib/comparison/ComparisonStoreUtils.ts:73-164 — the type
//     groups (missenseGroup … otherGroup, mutationGroup, cnaGroup);
//   - cbioportal-frontend@cd8c6df src/pages/resultsView/comparison/AlterationEnrichmentTypeSelector.tsx —
//     a parent row is ☑ when any of its group is selected; a click sets its whole group to !isAnySelected;
//   - cbioportal@03c0280 src/main/resources/mappers/clickhouse/alteration/ClickhouseAlterationFilterMapper.xml
//     mutationAlterationFilter — all selected → no type filter; else lower(mutation_type) IN (checked), or
//     NOT IN (unchecked) when Other is checked;
//   - docs/legacy-spec/21-comparison-molecular.md CMM-AT-1…5, CMM-STM-2.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MUTATION_UNITS, ALTERATION_EVENTS, EVENT_TREE, normalizeEvents, mutationTypeFilter, eventProfileTypes, eventsWord,
} from "../lib/alteration-events.ts";
import type { AlterationEvent, EventNode } from "../lib/alteration-events.ts";
import { runEnrichment } from "../lib/views/enrichment/run.ts";
import { fisherExact } from "../lib/stats.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation } from "../lib/types.ts";

// The legacy groups, copied from ComparisonStoreUtils.ts@cd8c6df.
const missenseGroup = ["missense", "missense_mutation", "missense_variant"];
const inframeDeletionGroup = ["inframe_del", "inframe_deletion", "in_frame_del", "in_frame_deletion", "nonframeshift_deletion"];
const inframeInsertionGroup = ["inframe_ins", "inframe_insertion", "in_frame_ins", "in_frame_insertion", "nonframeshift_insertion"];
const inframeGroup = ["indel", "nonframeshift", "inframe", ...inframeDeletionGroup, ...inframeInsertionGroup];
const nonsenseGroup = ["nonsense_mutation", "nonsense", "stopgain_snv", "stop_gained"];
const frameshiftInsertionGroup = ["frame_shift_ins", "frameshift_insertion"];
const frameshiftDeletionGroup = ["frame_shift_del", "frameshift_deletion"];
const frameshiftGroup = ["frameshift", "frameshift_variant", ...frameshiftDeletionGroup, ...frameshiftInsertionGroup];
const nonstartGroup = ["translation_start_site", "initiator_codon_variant", "start_codon_snp", "start_codon_del", "de_novo_start_outofframe"];
const nonstopGroup = ["nonstop_mutation", "stop_lost"];
const spliceGroup = ["splice_site", "splice", "splicing", "splice_site_snp", "splice_site_del", "splice_site_indel", "splice_region_variant", "splice_region"];
const truncationGroup = ["truncating", "feature_truncation", ...nonsenseGroup, ...frameshiftGroup, ...nonstartGroup, ...nonstopGroup, ...spliceGroup];
const otherGroup = ["silent", "synonymous_variant", "targeted_region", "other"];
const mutationGroup = [...missenseGroup, ...inframeGroup, ...truncationGroup, ...otherGroup];

const MUT_UNITS = ["missense", "inframe", "inframe_del", "inframe_ins", "truncating", "nonsense", "frameshift",
  "frameshift_del", "frameshift_ins", "nonstart", "nonstop", "splice", "other"] as const;

const sorted = (xs: readonly string[]) => [...xs].sort();
/** the mutation_type values a set of units stands for */
const valuesOf = (units: readonly AlterationEvent[]) =>
  units.flatMap((u) => (u in MUTATION_UNITS ? [...MUTATION_UNITS[u as keyof typeof MUTATION_UNITS]] : []));
const allNodes = (n: EventNode): EventNode[] => [n, ...(n.children || []).flatMap(allNodes)];
const node = (label: string): EventNode => {
  const found = [EVENT_TREE.mutation, EVENT_TREE.sv, EVENT_TREE.cna].flatMap(allNodes).filter((n) => n.label === label);
  assert.equal(found.length, 1, "one node labelled " + label);
  return found[0];
};
// The selector's two rules (AlterationEnrichmentTypeSelector): a row is ☑ when any of its group is
// selected; clicking it sets every unit of its group to !isAnySelected.
const isChecked = (n: EventNode, sel: Set<AlterationEvent>) => n.units.some((u) => sel.has(u));
const click = (n: EventNode, sel: Set<AlterationEvent>) => {
  const on = !isChecked(n, sel);
  const next = new Set(sel);
  for (const u of n.units) if (on) next.add(u); else next.delete(u);
  return next;
};
/** would the backend's mutationAlterationFilter count a mutation of this type? */
const counts = (events: AlterationEvent[], mutationType: string) => {
  const f = mutationTypeFilter(events);
  if (!f) return false;
  if (f.op === "all") return true;
  const t = mutationType.toLowerCase();
  return f.op === "in" ? f.types.includes(t) : !f.types.includes(t);
};
const ev = (...xs: string[]) => xs as AlterationEvent[];

describe("the units and the tree are the legacy groups (CMM-AT-1)", () => {
  test("ALTERATION_EVENTS: the 13 mutation units in order, then amp, homdel, sv", () => {
    assert.deepEqual(ALTERATION_EVENTS, [...MUT_UNITS, "amp", "homdel", "sv"]);
    assert.deepEqual(Object.keys(MUTATION_UNITS), [...MUT_UNITS]);
  });
  test("the units together are exactly mutationGroup, each value in one unit", () => {
    const all = Object.values(MUTATION_UNITS).flat();
    assert.equal(all.length, new Set(all).size, "no value in two units");
    assert.deepEqual(sorted(all), sorted(mutationGroup));
  });
  test("leaf units hold their legacy group; the parents only their own generic values", () => {
    assert.deepEqual(sorted(MUTATION_UNITS.missense), sorted(missenseGroup));
    assert.deepEqual(sorted(MUTATION_UNITS.inframe_del), sorted(inframeDeletionGroup));
    assert.deepEqual(sorted(MUTATION_UNITS.inframe_ins), sorted(inframeInsertionGroup));
    assert.deepEqual(sorted(MUTATION_UNITS.nonsense), sorted(nonsenseGroup));
    assert.deepEqual(sorted(MUTATION_UNITS.frameshift_del), sorted(frameshiftDeletionGroup));
    assert.deepEqual(sorted(MUTATION_UNITS.frameshift_ins), sorted(frameshiftInsertionGroup));
    assert.deepEqual(sorted(MUTATION_UNITS.nonstart), sorted(nonstartGroup));
    assert.deepEqual(sorted(MUTATION_UNITS.nonstop), sorted(nonstopGroup));
    assert.deepEqual(sorted(MUTATION_UNITS.splice), sorted(spliceGroup));
    assert.deepEqual(sorted(MUTATION_UNITS.other), sorted(otherGroup));
    assert.deepEqual(sorted(MUTATION_UNITS.inframe), ["indel", "inframe", "nonframeshift"]);
    assert.deepEqual(sorted(MUTATION_UNITS.truncating), ["feature_truncation", "truncating"]);
    assert.deepEqual(sorted(MUTATION_UNITS.frameshift), ["frameshift", "frameshift_variant"]);
  });
  test("every value is lower-case, as the backend compares lower(mutation_type) (row 6)", () => {
    for (const v of Object.values(MUTATION_UNITS).flat()) assert.equal(v, v.toLowerCase(), v);
  });
  test("the tree's shape and labels are the portal's", () => {
    const shape = (n: EventNode): unknown => (n.children ? { [n.label]: n.children.map(shape) } : n.label);
    assert.deepEqual(shape(EVENT_TREE.mutation), { Mutations: [
      "Missense",
      { Inframe: ["Inframe Insertion", "Inframe Deletion"] },
      { Truncating: ["Nonsense", { Frameshift: ["Frameshift Insertion", "Frameshift Deletion"] }, "Nonstart", "Nonstop", "Splice"] },
      "Other",
    ] });
    assert.equal(shape(EVENT_TREE.sv), "Structural Variants / Fusions");
    assert.deepEqual(shape(EVENT_TREE.cna), { "Copy Number Alterations": ["Amplification", "Deletion"] });
  });
  test("each node's units stand for the legacy group of the same name", () => {
    const groups: [string, string[]][] = [
      ["Mutations", mutationGroup], ["Missense", missenseGroup], ["Inframe", inframeGroup],
      ["Inframe Insertion", inframeInsertionGroup], ["Inframe Deletion", inframeDeletionGroup],
      ["Truncating", truncationGroup], ["Nonsense", nonsenseGroup], ["Frameshift", frameshiftGroup],
      ["Frameshift Insertion", frameshiftInsertionGroup], ["Frameshift Deletion", frameshiftDeletionGroup],
      ["Nonstart", nonstartGroup], ["Nonstop", nonstopGroup], ["Splice", spliceGroup], ["Other", otherGroup],
    ];
    for (const [label, group] of groups) assert.deepEqual(sorted(valuesOf(node(label).units)), sorted(group), label);
    assert.deepEqual(node("Structural Variants / Fusions").units, ["sv"]);
    assert.deepEqual(sorted(node("Copy Number Alterations").units), ["amp", "homdel"]);
    assert.deepEqual(node("Amplification").units, ["amp"]);
    assert.deepEqual(node("Deletion").units, ["homdel"]);
  });
  test("a parent's units are its own plus every descendant's", () => {
    for (const n of [EVENT_TREE.mutation, EVENT_TREE.sv, EVENT_TREE.cna].flatMap(allNodes)) {
      for (const c of n.children || []) for (const u of c.units) assert.ok(n.units.includes(u), `${n.label} has ${c.label}'s ${u}`);
    }
  });
});

describe("normalizeEvents", () => {
  test("canonical order, deduplicated", () => {
    assert.deepEqual(normalizeEvents(["sv", "missense", "homdel", "missense", "amp", "other"]), ["missense", "other", "amp", "homdel", "sv"]);
    assert.deepEqual(normalizeEvents([...ALTERATION_EVENTS].reverse()), ALTERATION_EVENTS);
  });
  test("an unknown name → null (row 17)", () => {
    assert.equal(normalizeEvents(["missense", "fusion"]), null);
    assert.equal(normalizeEvents(["Missense"]), null);
  });
});

describe("the mutation-type filter (mutationAlterationFilter)", () => {
  test("every unit selected → no filter: 5'Flank, Intron and Fusion count (row 1)", () => {
    assert.deepEqual(mutationTypeFilter(ALTERATION_EVENTS), { op: "all" });
    assert.deepEqual(mutationTypeFilter(ev(...MUT_UNITS)), { op: "all" });
    for (const t of ["5'Flank", "Intron", "Fusion"]) assert.ok(counts(ALTERATION_EVENTS, t), t);
  });
  test("Other on, Truncating and its children off → NOT IN every truncating value; unknown types count (row 2)", () => {
    const truncating = new Set(node("Truncating").units);
    const events = ALTERATION_EVENTS.filter((e) => !truncating.has(e));
    const f = mutationTypeFilter(events);
    assert.equal(f?.op, "not in");
    assert.deepEqual(sorted((f as { types: string[] }).types), sorted(truncationGroup));
    assert.ok(counts(events, "5'Flank"));
    assert.ok(counts(events, "Missense_Mutation"));
    assert.ok(!counts(events, "Nonsense_Mutation"));
    assert.ok(!counts(events, "Frame_Shift_Del"));
  });
  test("Other off, Missense + Inframe on → IN (missense + inframe values); unknown types do not count (row 3)", () => {
    const events = normalizeEvents([...node("Missense").units, ...node("Inframe").units])!;
    const f = mutationTypeFilter(events);
    assert.equal(f?.op, "in");
    assert.deepEqual(sorted((f as { types: string[] }).types), sorted([...missenseGroup, ...inframeGroup]));
    assert.ok(!counts(events, "5'Flank"));
    assert.ok(!counts(events, "Nonsense_Mutation"));
    assert.ok(counts(events, "In_Frame_Del"));
  });
  test("mutation_type is matched lower-case (row 6)", () => {
    const events = ev("missense", "amp");
    assert.ok(counts(events, "Missense_Mutation"));
    assert.ok(counts(events, "MISSENSE_VARIANT"));
  });
  test("only CNA / SV units → no mutation filter at all (row 7)", () => {
    assert.equal(mutationTypeFilter(ev("amp", "homdel", "sv")), null);
    assert.equal(mutationTypeFilter([]), null);
  });
});

describe("the checkbox tree (AlterationEnrichmentTypeSelector)", () => {
  test("clicking Inframe while any inframe unit is on turns every inframe unit off (row 4)", () => {
    const inframe = node("Inframe");
    for (const start of [new Set(ALTERATION_EVENTS), new Set(ev("inframe_ins", "missense")), new Set(ev("inframe", "other"))]) {
      assert.ok(isChecked(inframe, start));
      const after = click(inframe, start);
      for (const u of ["inframe", "inframe_ins", "inframe_del"] as const) assert.ok(!after.has(u), u + " off");
      assert.ok(!isChecked(inframe, after));
      assert.ok(!isChecked(node("Inframe Insertion"), after) && !isChecked(node("Inframe Deletion"), after));
      const f = mutationTypeFilter([...after]);
      if (f && f.op === "in") for (const t of inframeGroup) assert.ok(!f.types.includes(t), t);
      if (f && f.op === "not in") for (const t of inframeGroup) assert.ok(f.types.includes(t), t);
    }
    // and from all off, a click turns every inframe unit on
    const on = click(inframe, new Set(ev("missense")));
    for (const u of ["inframe", "inframe_ins", "inframe_del"] as const) assert.ok(on.has(u), u + " on");
  });
  test("Inframe Insertion and Deletion off, the parent's own values on: Inframe ☑ and indel counts (row 5)", () => {
    const sel = new Set(ev("missense", "inframe"));
    assert.ok(isChecked(node("Inframe"), sel));
    assert.ok(isChecked(node("Mutations"), sel));
    assert.ok(!isChecked(node("Inframe Insertion"), sel) && !isChecked(node("Inframe Deletion"), sel));
    const events = normalizeEvents([...sel])!;
    for (const t of ["indel", "nonframeshift", "inframe"]) assert.ok(counts(events, t), t);
    assert.ok(!counts(events, "In_Frame_Ins"));
    assert.ok(!counts(events, "nonframeshift_deletion"));
  });
  test("clicking a leaf toggles only that leaf; Truncating stays ☑ while any child is on", () => {
    const after = click(node("Nonsense"), new Set(ALTERATION_EVENTS));
    assert.deepEqual([...ALTERATION_EVENTS].filter((e) => !after.has(e)), ["nonsense"]);
    assert.ok(isChecked(node("Truncating"), after));
  });
});

describe("the profiles a selection draws on (rows 7-10)", () => {
  test("every event → mutation, CNA and SV profiles, in that order", () => {
    assert.deepEqual(eventProfileTypes(ALTERATION_EVENTS), ["MUTATION_EXTENDED", "COPY_NUMBER_ALTERATION", "STRUCTURAL_VARIANT"]);
    assert.deepEqual(eventProfileTypes(ev("sv", "homdel", "other")), ["MUTATION_EXTENDED", "COPY_NUMBER_ALTERATION", "STRUCTURAL_VARIANT"]);
  });
  test("no mutation unit → the mutation profile is left out (row 7)", () => {
    assert.deepEqual(eventProfileTypes(ev("amp", "homdel", "sv")), ["COPY_NUMBER_ALTERATION", "STRUCTURAL_VARIANT"]);
  });
  test("any single mutation unit draws on the mutation profile", () => {
    for (const u of MUT_UNITS) assert.deepEqual(eventProfileTypes(ev(u)), ["MUTATION_EXTENDED"], u);
  });
  test("no CNA unit → the CNA profile is left out (row 8)", () => {
    assert.deepEqual(eventProfileTypes(ev(...MUT_UNITS, "sv")), ["MUTATION_EXTENDED", "STRUCTURAL_VARIANT"]);
  });
  test("Amplification only or Deletion only still draws on the CNA profile (row 9)", () => {
    assert.deepEqual(eventProfileTypes(ev("amp")), ["COPY_NUMBER_ALTERATION"]);
    assert.deepEqual(eventProfileTypes(ev("homdel")), ["COPY_NUMBER_ALTERATION"]);
  });
  test("SV unchecked → the SV profile is left out (row 10)", () => {
    assert.deepEqual(eventProfileTypes(ev(...MUT_UNITS, "amp", "homdel")), ["MUTATION_EXTENDED", "COPY_NUMBER_ALTERATION"]);
  });
  test("eventsWord names the selected kinds", () => {
    assert.match(eventsWord(ev("missense")), /missense|mutation/i);
    assert.match(eventsWord(ev("sv")), /structural|fusion/i);
    assert.match(eventsWord(ev("amp")), /amplif|copy|cna/i);
    assert.match(eventsWord(ev("homdel")), /delet|copy|cna/i);
    assert.ok(eventsWord(ALTERATION_EVENTS).length > 0);
  });
});

// ── runEnrichment with alteration "any": the harness of test/view-enrichment.test.ts ──

/** per cohort: whole-exome samples, and per gene the altered samples and (panel) samples profiled */
type Site = Record<string, { wes: number; altered: Record<string, number>; panel?: Record<string, number> }>;

function ctx(site: Site): ViewRun {
  const vNames = Object.keys(site);
  const resolver = {
    instance: { id: "s1", mode: "patient-level", label: "s1", conn: {} },
    viewAggregate: async (label: string, def: { name: string }) => {
      const c = site[def.name];
      if (label.startsWith("enrichment:altered:")) return Object.entries(c.altered).map(([gene, altered]) => ({ gene, altered }));
      if (label.startsWith("enrichment:panels:")) return Object.entries(c.panel || {}).map(([gene, profiled]) => ({ gene, profiled }));
      if (label.startsWith("enrichment:wes:")) return [{ n: c.wes }];
      throw new Error("unexpected " + label);
    },
    viewAggregateMany: async () => [],
    viewMeta: async () => [],
  };
  const cohorts: Record<string, EvaluatedCohort> = Object.fromEntries(vNames.map((n) => [n, {
    studies: ["s1"], count: 100, samples: 100, text: "", perStudy: { s1: { sql: "", count: 100, samples: 100, mode: "patient-level" } } }]));
  return {
    doc: { study: "s1", cohorts: Object.fromEntries(vNames.map((n) => [n, { name: n }])), views: [] } as never,
    cohorts, resolvers: { s1: resolver } as never, vNames, vStudies: ["s1"],
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
}
const run = async (site: Site, view: object = {}) => (await runEnrichment({ kind: "enrichment", alteration: "any", ...view } as never, ctx(site))) as any;
const close = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), a + " ≠ " + b);

describe("runEnrichment with alteration \"any\"", () => {
  const site: Site = {
    A: { wes: 100, altered: { TP53: 30, KRAS: 8 } },
    B: { wes: 100, altered: { TP53: 5, KRAS: 7 } },
  };
  test("default events: every event; tested genes, Fisher p, enrichment.events", async () => {
    const v = await run(site);
    assert.equal(v.error, undefined, v.error);
    const e = v.enrichment;
    assert.equal(e.tested, 2);
    assert.deepEqual(e.events, ALTERATION_EVENTS);
    assert.equal(typeof e.alteration, "string");
    const tp53 = e.rows.find((g: { gene: string }) => g.gene === "TP53");
    close(tp53.p, fisherExact(30, 70, 5, 95));
  });
  test("given events are normalized into enrichment.events, and the words name them", async () => {
    const v = await run(site, { events: ["sv", "missense", "amp", "missense"] });
    assert.equal(v.error, undefined, v.error);
    assert.deepEqual(v.enrichment.events, ["missense", "amp", "sv"]);
    assert.equal(v.enrichment.alteration, eventsWord(ev("missense", "amp", "sv")));
  });
  test("nothing selected is refused in words (row 16)", async () => {
    const v = await run(site, { events: [] });
    assert.equal(typeof v.error, "string");
    assert.match(v.error, /no alteration type is selected/);
  });
  test("an unknown event name is refused, listing the valid names (row 17)", async () => {
    const v = await run(site, { events: ["missense", "fusion"] });
    assert.equal(typeof v.error, "string");
    assert.match(v.error, /missense/);
    assert.match(v.error, /homdel/);
  });
  test("events with a single-type alteration is refused (row 18)", async () => {
    for (const alteration of ["mutation", "cna", "sv"]) {
      const v = await run(site, { alteration, events: ["missense"] });
      assert.equal(typeof v.error, "string", alteration);
      assert.match(v.error, /events/);
      assert.match(v.error, /"any"/);
    }
  });
});
