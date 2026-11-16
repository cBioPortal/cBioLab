// Tracks › Clinical lists the portal's special rows (Study of origin, Mutation spectrum, the
// "Profiled for …" rows, # Samples per Patient), and the automatic ones can be switched off
// (`hideTracks`). Written from the case table (S1–S15) and the legacy source
// (cbioportal-frontend @ cd8c6df), not from the implementation:
//   RVPS = src/pages/resultsView/ResultsViewPageStore.ts (1147-1200 the special attributes,
//          1300-1316 their counts), TM = src/pages/resultsView/oncoprint/TracksMenu.tsx (185-213 the
//          order, 242-256 Freq), RVO = src/shared/components/oncoprint/ResultsViewOncoprint.tsx
//          356-400 (the default tracks, removable like any clinical track), ACT =
//          src/pages/studyView/addChartButton/addChartByType/AddChartByType.tsx (193, 400).
//
// The modules are imported as namespaces so that each case fails on its own while the new
// exports are missing, rather than the whole file failing to link.
//
// S14 renders the Tracks menu, which needs a .tsx loader and module mocks:
//   node --experimental-test-module-mocks --import tsx --test test/oncoprint-hide-tracks.test.ts
// Under plain `npm test` those two tests are skipped, saying so.
import test, { describe, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as names from "../lib/profile-names.ts";
import * as edits from "../app/_oncoprint/track-edits.ts";
import { assembleContract, type AssembleInput, type EventRow } from "../lib/oncoprint-assemble.ts";
import { normalizeSpec } from "../lib/oncoprint.ts";

const te = edits as unknown as Record<string, any>;
const pn = names as unknown as Record<string, any>;

const STUDY = "Study of origin";
const SAMPLES = "# Samples per Patient";
const P_MUT = "Profiled for mutations";
const P_CNA = "Profiled for copy number alterations";
const P_SV = "Profiled for structural variants";
const P_MRNA = "Profiled for mRNA expression";
const P_PROT = "Profiled for protein expression";

// ---- engine fixture (as test/oncoprint-assemble.test.ts builds it) -----------------------------

const PIDS = ["P1", "P2", "P3", "P4", "P5"];
const base = (): AssembleInput => ({
  genes: ["TP53"],
  groups: [{ name: "all", pids: PIDS }],
  studies: ["s"],
  events: [],
  coverage: PIDS.map((pid) => ({ pid, genes: ["TP53"] })),
  isDriver: (r: EventRow & { driver?: boolean }) => !!r.driver,
  annotationSource: "fixture",
  clinical: [],
  heatmap: [], derived: [],
  sort: [{ track: "genomic", dir: "asc" }], lineGap: 90
});
/** two studies, a patient with three samples, and columns some profiles do not cover */
const twoStudies = (hideTracks?: string[]): AssembleInput => ({
  ...base(),
  studies: ["s1", "s2"],
  studyOf: new Map([["P1", "s1"], ["P2", "s1"], ["P3", "s2"], ["P4", "s2"], ["P5", "s2"]]),
  samples: [{ pid: "P1", n: 1 }, { pid: "P2", n: 3 }, { pid: "P3", n: 1 }, { pid: "P4", n: 1 }, { pid: "P5", n: 1 }],
  // bits over PROFILED_TYPES: 1 mutations, 2 CNA, 4 SV, 8 mRNA — mutations and SV everywhere,
  // CNA missing on P3, mRNA only on P5
  profiled: { types: ["MUTATION_EXTENDED", "COPY_NUMBER_ALTERATION", "STRUCTURAL_VARIANT", "MRNA_EXPRESSION"],
    masks: [{ pid: "P1", mask: 7 }, { pid: "P2", mask: 7 }, { pid: "P3", mask: 1 | 4 }, { pid: "P4", mask: 7 }, { pid: "P5", mask: 7 | 8 }] },
  ...(hideTracks ? { hideTracks } : {})
} as AssembleInput);
const labelsOf = (c: ReturnType<typeof assembleContract>) => c.tracks.map((t) => t.label);
const autoOf = (c: ReturnType<typeof assembleContract>) => (c.conventions as Record<string, unknown>).autoTracks as string[] | undefined;

// ---- menu fixture ------------------------------------------------------------------------------

const attr = (attribute: string, n: number, per: "sample" | "patient", displayName?: string, priority?: number) =>
  ({ attribute, kind: "cat", patients: n, per, ...(displayName ? { displayName } : {}), ...(priority != null ? { priority } : {}) });
// 8 patients, 10 samples (so # Samples per Patient applies), two studies, some samples not profiled for CNA
const TOTALS = { patients: 8, samples: 10 };
const ATTRS = [
  attr("METASTATIC_SITE", 4, "sample", "Metastatic Site"),
  attr("SEX", 8, "patient", "Sex"),
  attr("SAMPLE_TYPE", 10, "sample", "Sample Type", 1)
];
const AUTOS = [STUDY, SAMPLES, P_CNA];
const freq = (pct: number | null) => te.trackFreqText(pct);

// ---- lib/profile-names.ts ----------------------------------------------------------------------

describe("the automatic rows' labels", () => {
  test("S10: AUTO_TRACKS is Study of origin, # Samples per Patient and a Profiled-for row per profiled type", () => {
    assert.ok(Array.isArray(pn.AUTO_TRACKS), "AUTO_TRACKS is exported");
    assert.deepEqual([...pn.AUTO_TRACKS].sort(), [STUDY, SAMPLES, P_MUT, P_CNA, P_SV, P_MRNA, P_PROT].sort());
    for (const [t] of names.PROFILED_TYPES) assert.ok(pn.AUTO_TRACKS.includes(names.profiledTrackLabel(t)), t);
  });
  test("S10: isAutoTrack takes the automatic labels and nothing else", () => {
    assert.equal(typeof pn.isAutoTrack, "function", "isAutoTrack is exported");
    for (const l of [STUDY, SAMPLES, P_MUT, P_CNA, P_PROT]) assert.equal(pn.isAutoTrack(l), true, l);
    for (const l of ["SEX", "KRAS", "Profiled for nothing", "MUTATION_SPECTRUM", "Mutation spectrum", "study of origin", ""])
      assert.equal(pn.isAutoTrack(l), false, l);
  });
});

// ---- the engine --------------------------------------------------------------------------------

describe("engine: hideTracks (RVO 356-400)", () => {
  test("S7: two studies, hideTracks [Study of origin] — no Study of origin track, conventions.autoTracks still names it", () => {
    const shown = assembleContract(twoStudies());
    assert.ok(labelsOf(shown).includes(STUDY), "drawn when not hidden");
    const c = assembleContract(twoStudies([STUDY]));
    assert.ok(!labelsOf(c).includes(STUDY), "not drawn when hidden");
    assert.ok(labelsOf(c).includes(SAMPLES) && labelsOf(c).includes(P_CNA), "the other automatic rows stay");
    assert.deepEqual(autoOf(c), [STUDY, SAMPLES, P_CNA, P_MRNA], "every automatic row the input would draw, in draw order, hidden ones included");
    assert.deepEqual(autoOf(shown), [STUDY, SAMPLES, P_CNA, P_MRNA]);
  });

  test("S7: conventions.autoTracks is absent when the figure draws no automatic row", () => {
    const c = assembleContract(base());
    assert.equal(autoOf(c), undefined);
  });

  test("S8: hideTracks [Profiled for copy number alterations] — that row not drawn, the other Profiled-for rows drawn", () => {
    const c = assembleContract(twoStudies([P_CNA]));
    const clin = c.tracks.filter((t) => t.kind === "clinical").map((t) => t.label);
    assert.ok(!clin.includes(P_CNA));
    assert.deepEqual(clin, [STUDY, SAMPLES, P_MRNA], "the rest in their usual order");
    assert.deepEqual(autoOf(c), [STUDY, SAMPLES, P_CNA, P_MRNA]);
  });

  test("S8: hiding # Samples per Patient and every Profiled-for row together", () => {
    const c = assembleContract(twoStudies([SAMPLES, P_CNA, P_MRNA]));
    assert.deepEqual(c.tracks.filter((t) => t.kind === "clinical").map((t) => t.label), [STUDY]);
  });

  test("S9: hideTracks naming a row the figure would not draw (one study, Study of origin) changes nothing", () => {
    const plain = assembleContract(base());
    const c = assembleContract({ ...base(), hideTracks: [STUDY] } as AssembleInput);
    assert.deepEqual(labelsOf(c), labelsOf(plain));
    assert.deepEqual(c.columns, plain.columns);
    assert.equal(autoOf(c), undefined);
  });
});

describe("normalizeSpec: hideTracks", () => {
  test("S7: an automatic label is accepted and returned; absent is []; duplicates are dropped", () => {
    const spec = (h?: unknown) => normalizeSpec({ genes: ["TP53"], ...(h !== undefined ? { hideTracks: h } : {}) } as never) as Record<string, any>;
    assert.deepEqual(spec().hideTracks, []);
    assert.deepEqual(spec([STUDY]).hideTracks, [STUDY]);
    assert.deepEqual(spec([P_CNA, SAMPLES, P_CNA]).hideTracks, [P_CNA, SAMPLES]);
  });

  test("S9: one study and hideTracks [Study of origin] is accepted", () => {
    assert.doesNotThrow(() => normalizeSpec({ genes: ["TP53"], hideTracks: [STUDY] } as never));
  });

  for (const bad of ["SEX", "KRAS", "Profiled for nothing"]) {
    test(`S10: hideTracks ["${bad}"] is refused, naming the labels it takes`, () => {
      assert.throws(() => normalizeSpec({ genes: ["TP53"], hideTracks: [bad] } as never), (e: Error) => {
        assert.match(e.message, /^hideTracks:/);
        assert.ok(e.message.includes(STUDY), "names Study of origin: " + e.message);
        assert.ok(e.message.includes(P_MUT), "names Profiled for mutations: " + e.message);
        return true;
      });
    });
  }

  test("S10: hideTracks that is not an array is refused", () => {
    for (const bad of [STUDY, { 0: STUDY }, 1])
      assert.throws(() => normalizeSpec({ genes: ["TP53"], hideTracks: bad } as never), (e: Error) => /^hideTracks:/.test(e.message), JSON.stringify(bad));
  });
});

// ---- the Tracks menu's Clinical tab ------------------------------------------------------------

const menu = (over: Record<string, unknown> = {}) =>
  te.tracksMenuRows({ attrs: ATTRS, totals: TOTALS, spectrum: true, sequenced: 10, autoTracks: AUTOS, ...over }) as
    { attribute: string; label: string; pct: number | null; unit: string; kind: string }[];

describe("Tracks › Clinical rows (TM 185-213, RVPS 1300-1316)", () => {
  test("S1: two studies, some unprofiled for CNA, more samples than patients — the portal's order", () => {
    assert.equal(typeof te.tracksMenuRows, "function", "tracksMenuRows is exported");
    assert.deepEqual(menu().map((r) => r.label), [
      STUDY, "Mutation spectrum", P_CNA,
      // the rest by Freq ↓, priority ↓, name: Sample Type (100%, priority 1), then the 100% rows
      // of priority 0 by name ("#" sorts before "s"), then the 40% row
      "Sample Type", SAMPLES, "Sex", "Metastatic Site"
    ]);
  });

  test("S1: the Profiled-for rows come before every attribute, even at a lower Freq order, and sort among themselves by name", () => {
    const rows = menu({ autoTracks: [P_MRNA, P_CNA], spectrum: false });
    assert.deepEqual(rows.map((r) => r.label), [P_CNA, P_MRNA, "Sample Type", "Sex", "Metastatic Site"]);
  });

  test("S1: the spectrum row's attribute and kind; automatic rows' kind is \"auto\" and their attribute their label", () => {
    const rows = menu();
    const sp = rows.find((r) => r.label === "Mutation spectrum")!;
    assert.equal(sp.attribute, names.SPECTRUM_TRACK);
    assert.equal(sp.kind, "spectrum");
    for (const l of AUTOS) {
      const r = rows.find((x) => x.label === l)!;
      assert.ok(r, l + " listed");
      assert.equal(r.kind, "auto", l);
      assert.equal(r.attribute, l, l);
    }
    assert.equal(rows.find((r) => r.attribute === "SEX")!.kind, "cat", "an attribute keeps its own kind");
  });

  test("S1: no spectrum row when the figure has no spectrum; no automatic row the contract does not name", () => {
    const rows = menu({ spectrum: false, autoTracks: [] });
    assert.deepEqual(rows.map((r) => r.label), ["Sample Type", "Sex", "Metastatic Site"]);
  });

  test("S2: Study of origin, # Samples per Patient and a Profiled-for row are at \"100%\"", () => {
    const rows = menu();
    for (const l of AUTOS) assert.equal(freq(rows.find((r) => r.label === l)!.pct), "100.0%", l);
    // Profiled-for counts every queried sample, whatever share of them is profiled (RVPS 1313-1316)
    assert.equal(rows.find((r) => r.label === P_CNA)!.pct, 100);
  });

  test("S2: attributes keep the Freq clinicalTrackRows gives them", () => {
    const rows = menu();
    const expect = te.clinicalTrackRows(ATTRS, TOTALS) as { attribute: string; pct: number | null }[];
    for (const e of expect) assert.equal(rows.find((r) => r.attribute === e.attribute)!.pct, e.pct, e.attribute);
  });

  test("S3: Mutation spectrum's Freq is 100 × sequenced ÷ queried samples, in the portal's format", () => {
    const pct = (sequenced: number | undefined, totals = TOTALS) =>
      menu({ sequenced, totals }).find((r) => r.label === "Mutation spectrum")!.pct;
    assert.equal(pct(10), 100);
    assert.equal(freq(pct(7)), "70.0%");
    assert.equal(freq(pct(7, { patients: 8, samples: 9 })), "77.8%");
    assert.equal(freq(pct(0)), "0%");
  });

  test("S3: Mutation spectrum's Freq is \"NA\" when the sequenced count is unknown", () => {
    assert.equal(freq(menu({ sequenced: undefined }).find((r) => r.label === "Mutation spectrum")!.pct), "NA");
  });

  test("S15: Lab oncoprint (no totals) — automatic rows \"100%\", spectrum \"NA\"", () => {
    const rows = menu({ totals: undefined, sequenced: 4 });
    for (const l of AUTOS) assert.equal(freq(rows.find((r) => r.label === l)!.pct), "100.0%", l);
    assert.equal(freq(rows.find((r) => r.label === "Mutation spectrum")!.pct), "NA");
    assert.equal(rows.find((r) => r.attribute === "SEX")!.pct, null);
    assert.deepEqual(rows.slice(0, 3).map((r) => r.label), [STUDY, "Mutation spectrum", P_CNA], "the special rows still lead");
  });
});

describe("Tracks › Clinical: Update tracks writes the view (RVO)", () => {
  const view = { kind: "oncoprint", genes: ["KRAS"], clinical: ["SEX"] };

  test("S4: unticking an automatic row and Update tracks writes hideTracks: [label]", () => {
    assert.equal(typeof te.withClinicalTab, "function", "withClinicalTab is exported");
    const next = te.withClinicalTab(view, ["SEX", SAMPLES, P_CNA], AUTOS);
    assert.deepEqual(next.hideTracks, [STUDY]);
    assert.deepEqual(next.clinical, ["SEX"], "automatic rows never go into clinical");
    assert.deepEqual(next.genes, ["KRAS"], "the rest of the view is kept");
  });

  test("S4: the ticked attributes and the spectrum go to clinical, in the order given", () => {
    const next = te.withClinicalTab(view, [names.SPECTRUM_TRACK, STUDY, "AGE", "SEX", SAMPLES, P_CNA], AUTOS);
    assert.deepEqual(next.clinical, [names.SPECTRUM_TRACK, "AGE", "SEX"]);
    assert.equal("hideTracks" in next, false, "nothing hidden: no field");
  });

  test("S5: ticking a hidden automatic row takes it out of hideTracks; the field is dropped when empty", () => {
    const hidden = { ...view, hideTracks: [STUDY, P_CNA] };
    const one = te.withClinicalTab(hidden, ["SEX", STUDY, SAMPLES], AUTOS);
    assert.deepEqual(one.hideTracks, [P_CNA]);
    const all = te.withClinicalTab(hidden, ["SEX", STUDY, SAMPLES, P_CNA], AUTOS);
    assert.equal("hideTracks" in all, false);
  });

  test("S5: hideTracks lists the automatic rows in the contract's order", () => {
    const next = te.withClinicalTab(view, [], [P_CNA, STUDY, SAMPLES]);
    assert.deepEqual(next.hideTracks, [P_CNA, STUDY, SAMPLES]);
  });

  test("S6: Deselect all hides every listed automatic row as well; Select all shows them again", () => {
    const off = te.withClinicalTab(view, [], AUTOS);
    assert.deepEqual(off.clinical, []);
    assert.deepEqual(off.hideTracks, AUTOS);
    const rows = menu();
    const pct = (n: string) => rows.find((r) => r.attribute === n)?.pct;
    const sel = te.selectAll(rows.map((r) => r.attribute), [], pct, 100);
    const on = te.withClinicalTab(off, sel.next, AUTOS);
    assert.equal("hideTracks" in on, false, "every automatic row shown");
    assert.deepEqual([...on.clinical].sort(), [names.SPECTRUM_TRACK, "METASTATIC_SITE", "SAMPLE_TYPE", "SEX"].sort());
  });

  test("S12: unticking Study of origin drops its sort key, either direction", () => {
    const sorted = { ...view, sort: ["-" + STUDY, "-SEX"] };
    assert.deepEqual(te.withClinicalTab(sorted, ["SEX", SAMPLES, P_CNA], AUTOS).sort, ["-SEX"]);
    const asc = { ...view, sort: [STUDY] };
    assert.equal("sort" in te.withClinicalTab(asc, ["SEX", SAMPLES, P_CNA], AUTOS), false);
    assert.deepEqual(te.withClinicalTab(asc, ["SEX", STUDY], AUTOS).sort, [STUDY], "kept while shown");
  });
});

describe("the figure's track menu on an automatic row (RVO: Remove track)", () => {
  const view = { kind: "oncoprint", genes: ["KRAS"], clinical: ["SEX"] };

  test("S11: trackOwner says \"auto\" for an automatic row", () => {
    for (const l of [STUDY, SAMPLES, P_CNA, P_MUT]) assert.equal(edits.trackOwner(view, l), "auto", l);
    assert.equal(edits.trackOwner(view, "SEX"), "clinical");
    assert.equal(edits.trackOwner(view, "Profiled for nothing"), null);
  });

  test("S11: Remove track is offered on Study of origin and adds it to hideTracks", () => {
    assert.equal(edits.canRemoveTrack(view, STUDY), true);
    const next = edits.removeTrack(view, STUDY);
    assert.deepEqual(next.hideTracks, [STUDY]);
    assert.deepEqual(next.clinical, ["SEX"]);
    assert.deepEqual(edits.removeTrack(next, P_CNA).hideTracks, [STUDY, P_CNA], "appended to what is hidden");
  });

  test("S11: Remove track on # Samples per Patient and a Profiled-for row", () => {
    assert.equal(edits.canRemoveTrack(view, SAMPLES), true);
    assert.deepEqual(edits.removeTrack(view, SAMPLES).hideTracks, [SAMPLES]);
    assert.deepEqual(edits.removeTrack(view, P_MUT).hideTracks, [P_MUT]);
  });

  test("S12: removing Study of origin drops its sort key", () => {
    assert.deepEqual(edits.removeTrack({ ...view, sort: ["-" + STUDY, "SEX"] }, STUDY).sort, ["SEX"]);
  });
});

describe("pruneSort and a hidden Study of origin", () => {
  test("S12: a Study of origin sort key is dropped when the view hides it", () => {
    const v = { genes: ["KRAS"], clinical: ["AGE"], hideTracks: [STUDY] };
    assert.deepEqual(edits.pruneSort({ ...v, sort: [STUDY, "AGE"] }).sort, ["AGE"]);
    assert.deepEqual(edits.pruneSort({ ...v, sort: ["-" + STUDY, "-AGE"] }).sort, ["-AGE"]);
    assert.equal("sort" in edits.pruneSort({ ...v, sort: [STUDY] }), false);
  });

  test("S12: kept while it is shown (the existing rule)", () => {
    assert.deepEqual(edits.pruneSort({ genes: ["KRAS"], sort: ["-" + STUDY] }).sort, ["-" + STUDY]);
    assert.deepEqual(edits.pruneSort({ genes: ["KRAS"], hideTracks: [P_CNA], sort: [STUDY] }).sort, [STUDY]);
  });
});

// ---- S14: the Clinical tab's cosmetics, as rendered (as test/oncoprint-tracks-clinical-audit.test.ts) ----

let menuLoad: Promise<{ TracksMenu: React.ComponentType<any> } | string> | null = null;
function loadMenu() {
  menuLoad ??= (async () => {
    if (typeof (mock as { module?: unknown }).module !== "function") return "needs node --experimental-test-module-mocks";
    try {
      const gearUrl = new URL("../app/_ui/gear-menu.tsx", import.meta.url).href;
      const real = await import(gearUrl);
      mock.module(gearUrl, { namedExports: { ...real,
        GearMenu: ({ children, label }: { children: unknown; label: React.ReactNode }) =>
          React.createElement("div", { "data-menu": "open" }, label, typeof children === "function" ? (children as (c: () => void) => React.ReactNode)(() => {}) : children as React.ReactNode) } });
      return await import("../app/_oncoprint/OncoprintCard.tsx");
    } catch (e) {
      return "needs a .tsx loader (tsx): " + (e as Error).message.split("\n")[0];
    }
  })();
  return menuLoad;
}
const dec = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
async function renderMenu(t: { skip: (m: string) => void }, props: Record<string, unknown>): Promise<string | null> {
  const m = await loadMenu();
  if (typeof m === "string") { t.skip(m); return null; }
  return dec(renderToStaticMarkup(React.createElement(m.TracksMenu, {
    attrs: [], profiles: [], clinical: [], heatmap: [], cohorts: [], derivedCohorts: [], busy: false,
    onClinical() {}, onHeatmap() {}, onDerived() {}, ...props })));
}

describe("Tracks › Clinical cosmetics (ACT 193, 400)", () => {
  test("S14: the Freq column header's tooltip reads \"% samples with data\"", async (t) => {
    const html = await renderMenu(t, { attrs: [attr("SEX", 5, "patient", "Sex")], totals: { patients: 8, samples: 10 } });
    if (html == null) return;
    assert.ok(html.includes("% samples with data"), "no such header tooltip");
  });

  test("S14: while Freq is loading the tab reads \"Calculating data availability...\"", async (t) => {
    const html = await renderMenu(t, { attrs: [], loading: true });
    if (html == null) return;
    assert.ok(html.includes("Calculating data availability..."), "loading text");
  });
});
