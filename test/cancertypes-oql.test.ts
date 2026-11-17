// The Cancer Types Summary follows the query's OQL (PR 5 of the OQL series): what needs no database.
// Written from the case table's rows (C*) before the code; each test cites its row and the legacy
// source (cbioportal-frontend at cd8c6df) it was read from:
//   CSC  = src/pages/resultsView/cancerSummary/CancerSummaryContainer.tsx
//   ACH  = src/shared/lib/alterationCountHelpers.ts
//   CSCt = src/pages/resultsView/cancerSummary/CancerSummaryContent.tsx
// The SQL (which units are altered, by which kind, profiled or not) is run against the fixture study
// in scripts/check-results-oql.ts, never read here as text.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runCancertypes } from "../lib/views/cancertypes/run.ts";
import { cancertypesPanelSvg } from "../lib/views/cancertypes/figure.ts";
import { cancerTypesSql } from "../lib/views/cancertypes/sql.ts";
import { resultsLayout, syncDriverCohorts, syncDrivers } from "../app/portal/results-layout.ts";
import { withDrivers } from "../lib/driver-settings.ts";
import { STYLE } from "../lib/oncoprint-style.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation, View, CohortDef } from "../lib/types.ts";
import { PRIMARY } from "../lib/ch.ts";

type Row = Record<string, unknown>;
const ALL = "\x01all";
const NEW_KINDS = ["mrnaHigh", "mrnaLow", "protHigh", "protLow"] as const;

/** a hand-made participant answering with `rows` (per group and gene) and `tot` (per group), recording what it was asked */
function ctx(rows: Row[], tot: Row[], pin: string | null = "v7.5") {
  const asked: string[] = [];
  const cohort: EvaluatedCohort = { studies: ["s1"], perStudy: { s1: { sql: "SELECT 1", count: 60, samples: 60, mode: "patient-level" } },
    count: 60, samples: 60, text: "" } as never;
  const site = {
    instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY },
    viewAggregate: async (label: string) => { asked.push(label); return label.startsWith("cancertypes:samples:") ? tot : rows; },
  };
  const run: ViewRun = {
    doc: { study: "s1", cohorts: { A: { study: "s1" } }, views: [] } as never,
    cohorts: { A: cohort }, resolvers: { s1: site } as never, vNames: ["A"], vStudies: ["s1"],
    participationFor: (studies: string[], requiresPatientLevel: boolean): ViewParticipation =>
      ({ studies: studies.map((study) => ({ study, mode: "patient-level" as const, instance: "local" })), requiresPatientLevel, aggregateOnly: [] }),
    pin, studyProfiles: async () => ({ profiles: ["mutations", "cna"], gaProfiles: [] }),
  };
  return { run, asked };
}

const row = (gene: string, grp: string, c: Partial<Record<string, number>>): Row =>
  ({ gene, grp, label: grp, profiled: 0, altered: 0, mutation: 0, amp: 0, homdel: 0, sv: 0, multiple: 0, mrnaHigh: 0, mrnaLow: 0, protHigh: 0, protLow: 0, ...c });
const TOT: Row[] = [{ grp: "NSCLC", samples: 50, mut: 50, cna: 50, sv: 50 }, { grp: "Small", samples: 4, mut: 4, cna: 4, sv: 4 }, { grp: ALL, samples: 54 }];

type Ct = { genes: string[]; panels: { groups: Row[]; categories: number; filtered?: true; perGene?: { gene: string; groups: Row[] }[] }[] };
const ct = (r: ViewResult) => (r as unknown as { cancertypes?: Ct }).cancertypes;
const err = (r: ViewResult) => String((r as { error?: string }).error || "");
const run = (view: Record<string, unknown>, rows: Row[] = [], pin: string | null = "v7.5") => {
  const c = ctx(rows, TOT, pin);
  return runCancertypes({ kind: "cancertypes", genes: ["KRAS"], minSamples: 10, ...view } as never, c.run).then((r) => ({ r, asked: c.asked }));
};

// ---------------------------------------------------------------------------------------------
// refusals
// ---------------------------------------------------------------------------------------------

describe("C11: oql with measure \"driver\" is refused: DRIVER belongs in the OQL (ours)", () => {
  test("refused, naming the OQL spelling, before any query runs", async () => {
    const { r, asked } = await run({ oql: ["KRAS: MUT"], measure: "driver" });
    assert.ok(err(r), "refused; got " + JSON.stringify(r).slice(0, 200));
    assert.match(err(r), /DRIVER/, "names DRIVER in the OQL: " + err(r));
    assert.match(err(r), /oql|OQL/, err(r));
    assert.equal(ct(r), undefined);
    assert.deepEqual(asked, [], "no SQL was run");
  });
  test("the same lines with measure \"any\" (or none) are not refused for it", async () => {
    for (const measure of ["any", undefined]) {
      const { r } = await run({ oql: ["KRAS: MUT"], measure }, [row("KRAS", "NSCLC", { profiled: 50, altered: 5, mutation: 5 }), row("*", "NSCLC", { profiled: 50, altered: 5, mutation: 5 }), row("*", ALL, { profiled: 54, altered: 5 })]);
      assert.doesNotMatch(err(r), /DRIVER/, String(measure));
    }
  });
});

describe("C12: a line the parser refuses is refused with the parser's message", () => {
  test("GAIN (lib/oql-parse.ts: only high-level copy number is stored)", async () => {
    const { r, asked } = await run({ oql: ["KRAS: MUT=G12D", "TP53: GAIN"] });
    assert.match(err(r), /GAIN is not supported/, err(r));
    assert.match(err(r), /TP53: GAIN/, "names the line: " + err(r));
    assert.deepEqual(asked, []);
  });
  test("HETLOSS and a malformed line, likewise", async () => {
    assert.match(err((await run({ oql: ["KRAS: HETLOSS"] })).r), /HETLOSS is not supported/);
    assert.ok(err((await run({ oql: ["KRAS: EXP"] })).r), "EXP without a threshold is refused");
  });
  test("oql is one gene per line (the API, as the Download tab's view)", async () => {
    const { r, asked } = await run({ oql: ["KRAS: MUT; TP53"] });
    assert.ok(err(r), "a line naming two genes is refused");
    assert.deepEqual(asked, []);
    assert.ok(err((await run({ oql: [] })).r) || err((await run({ oql: [""] })).r), "an empty line list or line is refused");
  });
});

// ---------------------------------------------------------------------------------------------
// the runner with oql
// ---------------------------------------------------------------------------------------------

describe("with oql, the genes are the lines' genes (C1, C9)", () => {
  const rows = [
    row("KRAS", "NSCLC", { profiled: 50, altered: 5, mutation: 5 }), row("CDKN2A", "NSCLC", { profiled: 50, altered: 4, homdel: 4 }),
    row("*", "NSCLC", { profiled: 50, altered: 9, mutation: 5, homdel: 4 }), row("*", ALL, { profiled: 54, altered: 9 })];
  test("the view's genes give way to the lines' genes, in line order, each once (two lines of one gene count under it)", async () => {
    const { r } = await run({ genes: ["TP53"], oql: ["KRAS: MUT=G12D", "CDKN2A: HOMDEL", "KRAS: AMP"] }, rows);
    assert.equal(err(r), "");
    assert.deepEqual(ct(r)!.genes, ["KRAS", "CDKN2A"]);
    assert.deepEqual(ct(r)!.panels[0].perGene!.map((p) => p.gene), ["KRAS", "CDKN2A"], "one per-gene tab per gene, not per line");
  });
  test("the lines alone are enough: no genes needed beside them", async () => {
    const { r } = await run({ genes: undefined, oql: ["KRAS: MUT=G12D", "CDKN2A: HOMDEL"] }, rows);
    assert.equal(err(r), "");
    assert.deepEqual(ct(r)!.genes, ["KRAS", "CDKN2A"]);
  });
});

describe("the new kinds: mRNA high / low, protein high / low (C6)", () => {
  test("each group carries the participant's counts of each, per gene and together", async () => {
    const rows = [
      row("KRAS", "NSCLC", { profiled: 50, altered: 9, mutation: 3, multiple: 2, mrnaHigh: 2, mrnaLow: 1, protHigh: 1, protLow: 0 }),
      row("EGFR", "NSCLC", { profiled: 47, altered: 1, mrnaHigh: 1 }),
      row("*", "NSCLC", { profiled: 50, altered: 10, mutation: 3, multiple: 2, mrnaHigh: 3, mrnaLow: 1, protHigh: 1, protLow: 0 }),
      row("*", ALL, { profiled: 54, altered: 10 })];
    const { r } = await run({ oql: ["KRAS: MUT=G12D EXP>=2 EXP<=-2 PROT>=2 PROT<=-2", "EGFR: EXP>=2"] }, rows);
    assert.equal(err(r), "");
    const g = ct(r)!.panels[0].groups.find((x) => x.key === "NSCLC")!;
    assert.deepEqual(NEW_KINDS.map((k) => g[k]), [3, 1, 1, 0]);
    const kras = ct(r)!.panels[0].perGene!.find((p) => p.gene === "KRAS")!.groups.find((x) => x.key === "NSCLC")!;
    assert.deepEqual(NEW_KINDS.map((k) => kras[k]), [2, 1, 1, 0]);
  });
  test("a group drawn under a lower Min. # Total carries its own counts of each", async () => {
    const rows = [
      row("KRAS", "NSCLC", { profiled: 50, altered: 1, mrnaHigh: 1 }), row("KRAS", "Small", { profiled: 4, altered: 2, mrnaLow: 1, protLow: 1 }),
      row("*", "NSCLC", { profiled: 50, altered: 1, mrnaHigh: 1 }), row("*", "Small", { profiled: 4, altered: 2, mrnaLow: 1, protLow: 1 }),
      row("*", ALL, { profiled: 54, altered: 3 })];
    const hidden = ct((await run({ oql: ["KRAS: EXP>=2 EXP<=-2 PROT<=-2"] }, rows)).r)!.panels[0];
    assert.ok(!hidden.groups.some((g) => g.key === "Small") && hidden.categories === 2 && hidden.filtered, "Small (4 < 10) is hidden and counted");
    const small = ct((await run({ oql: ["KRAS: EXP>=2 EXP<=-2 PROT<=-2"], minSamples: 1 }, rows)).r)!.panels[0].groups.find((g) => g.key === "Small")!;
    assert.deepEqual(NEW_KINDS.map((k) => small[k]), [0, 1, 0, 1]);
  });
  test("0 when none: a group with no such count, and a view without oql, carry 0 for each", async () => {
    const plain = [{ gene: "*", grp: "NSCLC", label: "NSCLC", profiled: 50, altered: 5, mutation: 5, amp: 0, homdel: 0, sv: 0, multiple: 0 }, { gene: "*", grp: ALL, profiled: 54, altered: 5 }];
    const { r } = await run({}, plain);
    for (const g of ct(r)!.panels[0].groups) assert.deepEqual(NEW_KINDS.map((k) => g[k]), [0, 0, 0, 0], String(g.key));
    // "Small" has samples but no row: a group of totals alone
    const { r: r2 } = await run({ minSamples: 1 }, plain);
    for (const g of ct(r2)!.panels[0].groups) assert.deepEqual(NEW_KINDS.map((k) => g[k]), [0, 0, 0, 0], String(g.key));
  });
});

// ---------------------------------------------------------------------------------------------
// C14: the Results page
// ---------------------------------------------------------------------------------------------

const rq = (entries: string[], extra: Record<string, unknown> = {}) =>
  ({ studies: ["a"], filters: [], entries, genes: [...new Set(entries.map((x) => x.split(":")[0].trim().toUpperCase()))], ...extra });
const rdata = { expr: "rna_seq_v2_mrna", cna: "gistic", clinical: ["AGE"], numeric: ["MUTATION_COUNT"], expressionAcross: true,
  held: { every: ["MUTATION", "CNA"], some: ["SV"] } } as unknown as Parameters<typeof resultsLayout>[1];
type CtView = { kind: string; genes?: unknown; oql?: string[]; exp?: string; prot?: string; ifHeld?: boolean; drivers?: unknown; measure?: string };
const ctView = (doc: { views?: View[] }) => (doc.views || []).find((v) => v.kind === "cancertypes") as unknown as CtView;
const oqlClause = (def: CohortDef) => (def.all || []).find((c) => (c as { kind?: string }).kind === "oql") as Record<string, unknown>;

describe("C14: the Results page's Cancer Types view carries the query's OQL (CSC 114: oqlFilteredAlterationsByGeneBySampleKey)", () => {
  test("oql is the query's entries, as the Download tab's", () => {
    const entries = ["KRAS: MUT=G12D", "TP53: HOMDEL", "EGFR"];
    const l = resultsLayout(rq(entries) as never, rdata);
    const v = ctView(l.doc);
    assert.deepEqual(v.oql, entries);
    const dl = (l.doc.views || []).find((x) => x.kind === "datafiles") as unknown as { oql: string[] };
    assert.deepEqual(v.oql, dl.oql, "the same lines the Download tab follows");
    assert.notEqual(v.measure, "driver", "never measure driver beside oql (C11)");
  });
  test("the query's exp / prot / ifHeld travel with the lines, as they do to the Download tab", () => {
    const entries = ["KRAS: EXP>=2", "TP53"];
    const one = ctView(resultsLayout(rq(entries, { exp: "rna_seq_v2_mrna_median_Zscores", prot: "rppa_Zscores" }) as never, rdata).doc);
    assert.equal(one.exp, "rna_seq_v2_mrna_median_Zscores");
    assert.equal(one.prot, "rppa_Zscores");
    assert.ok(!("ifHeld" in one));
    const many = ctView(resultsLayout(rq(entries, { studies: ["a", "b"], exp: "rna_seq_v2_mrna_median_Zscores", ifHeld: true }) as never, rdata).doc);
    assert.equal(many.exp, "rna_seq_v2_mrna_median_Zscores");
    assert.equal(many.ifHeld, true);
    const none = ctView(resultsLayout(rq(entries) as never, rdata).doc);
    assert.ok(!("exp" in none) && !("prot" in none) && !("ifHeld" in none), JSON.stringify(none));
  });
  test("drivers only when a line names DRIVER: then the page's settings, as the Altered cohort's clause carries them (C13)", () => {
    for (const entries of [["KRAS: MUT_DRIVER"], ["TP53: DRIVER", "KRAS"], ["BRAF: MUT_(500-600)_DRIVER"]]) {
      const l = resultsLayout(rq(entries) as never, rdata);
      const v = ctView(l.doc);
      assert.ok("drivers" in v, entries.join("; "));
      assert.deepEqual(v.drivers, oqlClause(l.doc.cohorts!.Altered).drivers, entries.join("; ") + ": the Altered clause's settings");
    }
    for (const entries of [["KRAS"], ["KRAS: MUT=G12D", "TP53: HOMDEL"], ["EGFR: AMP"]])
      assert.ok(!("drivers" in ctView(resultsLayout(rq(entries) as never, rdata).doc)), entries.join("; "));
  });
  test("C13: a change to the oncoprint's driver settings reaches a DRIVER Cancer Types view, as it reaches the cohorts' clauses", () => {
    const l = resultsLayout(rq(["KRAS: MUT_DRIVER", "TP53"]) as never, rdata);
    const views = l.doc.views || [];
    const at = views.findIndex((v) => v.kind === "oncoprint");
    const nextViews = views.map((v, i) => i === at ? withDrivers(v as never, { hotspots: false }) as unknown as View : v);
    // as the Results page applies an edit (app/portal/results/page.tsx onDoc)
    const doc = syncDriverCohorts({ ...l.doc, views: syncDrivers(views, nextViews) });
    assert.deepEqual(oqlClause(doc.cohorts!.Altered).drivers, { hotspots: false }, "the cohort clause follows (PR 3)");
    assert.deepEqual(ctView(doc).drivers, { hotspots: false }, "and so does the Cancer Types view");
    // a query without DRIVER: the view takes no settings
    const plain = resultsLayout(rq(["KRAS: MUT=G12D"]) as never, rdata);
    const pv = plain.doc.views || [];
    const pat = pv.findIndex((v) => v.kind === "oncoprint");
    const pdoc = syncDriverCohorts({ ...plain.doc, views: syncDrivers(pv, pv.map((v, i) => i === pat ? withDrivers(v as never, { hotspots: false }) as unknown as View : v)) });
    assert.ok(!("drivers" in ctView(pdoc)));
  });
});

// ---------------------------------------------------------------------------------------------
// C16: the figure
// ---------------------------------------------------------------------------------------------

const optColor = (opts: { bit: string; color: string; label: string }[], bit: string) => opts.find((o) => o.bit === bit)!;
const KIND_STYLE = {
  mrnaHigh: optColor(STYLE.glyph.mrna.options, "MRNA_HIGH"), mrnaLow: optColor(STYLE.glyph.mrna.options, "MRNA_LOW"),
  protHigh: optColor(STYLE.glyph.protein.options, "PROT_HIGH"), protLow: optColor(STYLE.glyph.protein.options, "PROT_LOW"),
} as const;

describe("C16: the figure draws the new kinds in the oncoprint's mRNA / protein colours, keyed only when present (CSCt 21-53)", () => {
  const grp = (key: string, c: Partial<Record<string, number>>) =>
    ({ key, label: key, samples: 20, profiled: 20, altered: 0, mutation: 0, amp: 0, homdel: 0, sv: 0, multiple: 0, mrnaHigh: 0, mrnaLow: 0, protHigh: 0, protLow: 0, ...c });
  const result = (groups: Row[]) => ({ groupBy: "CANCER_TYPE", measure: "any", genes: ["KRAS"], minSamples: 1, show: "frequency", unit: "sample",
    panels: [{ cohort: "all", samples: 40, profiled: 40, altered: 10, groups }] }) as never;
  const titled = (svg: string, fill: string) => [...svg.matchAll(/<rect [^>]*fill="([^"]+)"[^>]*><title>([^<]*)<\/title>/g)].filter((m) => m[1].toLowerCase() === fill.toLowerCase()).map((m) => m[2]);

  test("each kind is a stacked segment in its STYLE colour, titled with its name and count", () => {
    const svg = cancertypesPanelSvg(result([grp("A", { altered: 7, mrnaHigh: 3, mrnaLow: 1, protHigh: 2, protLow: 1 }), grp("B", { altered: 2, mutation: 2 })]), 0).body;
    for (const [k, n] of [["mrnaHigh", 3], ["mrnaLow", 1], ["protHigh", 2], ["protLow", 1]] as const) {
      const s = KIND_STYLE[k];
      const t = titled(svg, s.color);
      assert.equal(t.length, 1, k + ": one segment in " + s.color + "; found " + JSON.stringify(t));
      assert.match(t[0], new RegExp("^A — " + s.label + ": " + n + " of 20 "), k);
    }
  });
  test("the legend keys each kind present, by STYLE's label and colour, and no other", () => {
    const svg = cancertypesPanelSvg(result([grp("A", { altered: 4, mrnaHigh: 3, protLow: 1 })]), 0).body;
    assert.ok(svg.includes(">" + KIND_STYLE.mrnaHigh.label + "<"), "mRNA High keyed");
    assert.ok(svg.includes(">" + KIND_STYLE.protLow.label + "<"), "Protein Low keyed");
    assert.ok(!svg.includes(KIND_STYLE.mrnaLow.label) && !svg.includes(KIND_STYLE.protHigh.label), "absent kinds not keyed");
    assert.ok(svg.toLowerCase().includes('fill="' + KIND_STYLE.mrnaHigh.color.toLowerCase() + '"'));
  });
  test("a result without the new kinds draws and keys none of them", () => {
    const svg = cancertypesPanelSvg(result([grp("A", { altered: 5, mutation: 3, amp: 2 })]), 0).body;
    for (const s of Object.values(KIND_STYLE)) assert.ok(!svg.includes(s.label), s.label);
    // a group from before the change, without the fields at all, draws as before
    const old = { key: "A", label: "A", samples: 20, profiled: 20, altered: 5, mutation: 5, amp: 0, homdel: 0, sv: 0, multiple: 0 };
    const svgOld = cancertypesPanelSvg(result([old]), 0).body;
    for (const s of Object.values(KIND_STYLE)) assert.ok(!svgOld.includes(s.label), s.label + " (no fields)");
  });
  test("the bar's segments still sum to its altered share: the new kinds stack with the old", () => {
    const svg = cancertypesPanelSvg(result([grp("A", { altered: 10, mutation: 4, mrnaHigh: 6 })]), 0).body;
    const rects = [...svg.matchAll(/<rect [^>]*height="([\d.]+)" fill="([^"]+)"/g)].map((m) => ({ h: Number(m[1]), fill: m[2].toLowerCase() }));
    const mrna = rects.filter((x) => x.fill === KIND_STYLE.mrnaHigh.color.toLowerCase());
    assert.equal(mrna.length, 1, "the mRNA High segment is drawn");
    const bar = rects.find((x) => x.fill === "none")!.h;
    const segs = rects.filter((x) => x.fill !== "none").reduce((a, x) => a + x.h, 0);
    assert.ok(Math.abs(segs - bar) <= 0.2, "segments " + segs + " = bar " + bar);
  });
});

describe("C6/C8 (SQL builder): a line's EXP / PROT read the study's expression profile", () => {
  const lines = ["KRAS: MUT=G12D EXP>=2", "EGFR: PROT<=-2"];
  test("a study with no mRNA or protein profile is refused, naming what it has (lib/oql.ts expressionProfileFor)", () => {
    assert.throws(() => cancerTypesSql("SELECT 1", "s", "db", ["KRAS", "EGFR"], "CANCER_TYPE", null, "any", "patient", { lines, profiles: ["mutations"] }),
      /OQL EXP requires an mRNA profile; this study has: mutations/);
    assert.throws(() => cancerTypesSql("SELECT 1", "s", "db", ["KRAS", "EGFR"], "CANCER_TYPE", null, "any", "patient", { lines, profiles: ["mutations", "mrna_seq_zscores"] }),
      /OQL PROT requires an protein profile/);
  });
  test("with the profiles, and with a named one, the query builds", () => {
    assert.doesNotThrow(() => cancerTypesSql("SELECT 1", "s", "db", ["KRAS", "EGFR"], "CANCER_TYPE", null, "any", "sample",
      { lines, profiles: ["mutations", "mrna_seq_zscores", "rppa_zscores"] }));
    assert.throws(() => cancerTypesSql("SELECT 1", "s", "db", ["KRAS", "EGFR"], "CANCER_TYPE", null, "any", "sample",
      { lines, profiles: ["mutations", "mrna_seq_zscores", "rppa_zscores"], pins: { EXP: "nope_zscores" } }), /nope_zscores/);
  });
});
