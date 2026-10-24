// What every view kind tells the page and the reader before any data arrives — its entry in the add
// menu, the spec a fresh view starts from, its card's title, limits and subtitle, its help, its
// federation needs and marks — pinned in test/snapshots/kinds.json, for a study that has everything
// a kind might look for and for one that has nothing. Read through the same functions the page calls
// (app/lab/use-view-options.ts, use-view-edits.ts, kind-cards.tsx, kinds/index.ts), with a fixed stand-in page.
// UPDATE_SNAPSHOTS=1 rewrites the file after an intended change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

register("./support/tsx-loader.mjs", import.meta.url);
const { useViewOptions } = await import("../app/lab/use-view-options.ts");
const { useViewEdits } = await import("../app/lab/use-view-edits.ts");
const kindCards = await import("../app/lab/kind-cards.tsx");
const { KIND_UI } = await import("../app/lab/kinds/index.ts");
const { viewHeadTitle } = await import("../app/lab/view-cards.tsx");
const { VIEW_HELP } = await import("../lib/view-help.ts");
const { viewNeed } = await import("../lib/view-coverage.ts");
const { previewPending } = await import("../lib/preview-kinds.ts");
const { isNewKind } = await import("../lib/new-in-lab.ts");
const { viewTitle } = await import("../lib/view-svg.ts");

const KINDS = ["compare", "survival", "cox", "logistic", "oncoprint", "hotspots", "plot", "cooccurrence", "clinical", "coexpression",
  "course", "sequence", "attrition", "genome", "pathways", "diffexpr", "paired", "clonality", "incidence", "labs", "riskmodel",
  "cancertypes", "overlap", "enrichment", "assays", "composition", "correlates", "table", "mutations", "alterations", "timeline",
  "acquired", "ctdna", "exclusivity", "txendpoints", "multistate", "rmst", "predictive", "cutpoint", "hla", "forest", "adjusted",
  "instability", "actionability", "drivernegative", "organotropism", "molsubtype", "germline"];

const RICH = {
  genes: ["TP53", "KRAS", "EGFR", "STK11", "KEAP1", "PIK3CA", "APC", "BRAF", "ERBB2"],
  attrs: [{ attribute: "TMB_NONSYNONYMOUS", kind: "num" }, { attribute: "AGE", kind: "num" }, { attribute: "OS_MONTHS", kind: "num" },
    { attribute: "SEX", kind: "cat" }, { attribute: "CANCER_TYPE", kind: "cat" }, { attribute: "HLA_A", kind: "cat" }, { attribute: "DMETS_DX_BRAIN", kind: "cat" }],
  profiles: ["mutations", "cna", "rna_seq_v2_mrna", "rna_seq_v2_mrna_median_Zscores"],
  assays: ["mutational_signatures_contribution_v2"],
  events: [{ canonical: "treatment", label: "Treatment", n: 900, perPatient: 3.2, hasDurations: true },
    { canonical: "diagnosis", label: "Diagnosis", n: 1000, perPatient: 2.1, hasDurations: false },
    { canonical: "lab_test", label: "Lab_Test", n: 400, perPatient: 9, hasDurations: false },
    { canonical: "sequencing", label: "Sequencing", n: 1000, perPatient: 1, hasDurations: false }],
};
const EMPTY = { genes: [], attrs: [], profiles: [], assays: [], events: [] };

const PATIENT_LEVEL = { instance: "primary", patientLevel: true, remote: false, shares: [] };
const AGGREGATE_ONLY = { instance: "primary", patientLevel: false, remote: false, shares: [] };

function page(study: typeof RICH, cohorts: string[], access: typeof PATIENT_LEVEL = PATIENT_LEVEL) {
  const doc = { study: "s1", cohorts: Object.fromEntries(cohorts.map((n) => [n, { all: [] }])), views: [] };
  const opts = useViewOptions({
    cat: study.events.length ? { endpoints: [{ months: "OS_MONTHS", status: "OS_STATUS" }], types: study.events } : null, catLoading: false,
    doc: doc as never, explore: null, exploreBusy: false, result: null,
    trackAttrs: { key: "s1", attrs: study.attrs.map((a) => ({ ...a, patients: 10 })), profiles: study.profiles, gaProfiles: study.assays } as never,
    trackAttrsLoading: false, studies: [{ id: "s1", access }] as never,
  });
  let added: unknown = null;
  const edits = useViewEdits({
    assayOptions: () => study.assays, busy: false, cantDrawCohort: () => null, catalogAttrs: () => study.attrs,
    contProfile: () => study.profiles.find((p) => /mrna/.test(p)) ?? null, doc: doc as never,
    docs: { current: { doc, ids: [] }, set: (d: { views: unknown[] }) => { added = d.views[0]; } } as never,
    numericAttrs: () => study.attrs.filter((a) => a.kind === "num").map((a) => a.attribute), profileOptions: () => study.profiles,
    result: null, viewAttrs: () => study.attrs.map((a) => a.attribute).slice(0, 3), viewEvents: () => study.events, viewGenes: () => study.genes,
    viewIds: [], VIEW_KINDS: opts.VIEW_KINDS, setChooser: () => {}, setToast: () => {}, study: "s1",
  });
  const addView = (kind: string) => { added = null; edits.addView(kind); return added; };
  return { opts, edits, addView };
}

function facts() {
  const rich = page(RICH, ["A"]), richTwo = page(RICH, ["A", "B"]), empty = page(EMPTY, ["A"]), aggregate = page(RICH, ["A"], AGGREGATE_ONLY);
  const known = (s: typeof RICH) => ({ ...s, cohorts: [] });
  const out: Record<string, unknown> = {};
  for (const kind of KINDS) {
    const menu = rich.opts.VIEW_KINDS.find((k) => k.kind === kind);
    const emptyMenu = empty.opts.VIEW_KINDS.find((k) => k.kind === kind);
    const aggregateMenu = aggregate.opts.VIEW_KINDS.find((k) => k.kind === kind);
    const ui = (KIND_UI as Record<string, any>)[kind];
    const card = kindCards.hasKindCard(kind)
      ? Object.fromEntries(["label", "title", "genes", "maxCohorts", "minCohorts", "cohortInHeader"].filter((f) => ui[f] !== undefined).map((f) => [f, ui[f]])) : null;
    const spec = rich.addView(kind) as Record<string, unknown> | null;
    out[kind] = {
      menu: menu ? { label: menu.label, why: menu.why?.() ?? null, loading: menu.loading?.() ?? false } : null,
      menuBareStudy: emptyMenu ? { why: emptyMenu.why?.() ?? null, loading: emptyMenu.loading?.() ?? false } : null,
      menuAggregateOnly: aggregateMenu ? { why: aggregateMenu.why?.() ?? null } : null,
      added: spec, addedBareStudy: empty.addView(kind), addedWithTwoCohorts: richTwo.addView(kind),
      maxCohorts: rich.edits.maxCohortsOf(kind) ?? null, emptyHint: rich.edits.emptyViewHint(kind), title: rich.edits.viewTitle(kind),
      headTitle: viewHeadTitle(kind),
      drawsOwnHead: { error: rich.opts.drawsOwnHead({ kind, error: "x" }), withData: rich.opts.drawsOwnHead({ kind, rows: [], hotspots: [], coexpression: [], clinical: [], pairs: [], curves: [], svg: "x", spec: {} }) },
      card: card ? { ...card, why: ui.why?.(known(RICH), {}) ?? null, whyBareStudy: ui.why?.(known(EMPTY), {}) ?? null,
        defaults: kindCards.defaultView(kind, known(RICH), {} as never), defaultsBareStudy: kindCards.defaultView(kind, known(EMPTY), {} as never) } : null,
      drawsOwnWaiting: kindCards.drawsOwnWaiting(kind),
      sub: spec && card ? (() => { const s = kindCards.kindSub(kind, spec, {}); return typeof s === "string" || s == null ? s : "(element)"; })() : null,
      help: VIEW_HELP[kind] ?? null, need: viewNeed(kind), preview: previewPending(kind), isNew: isNewKind(kind),
      figureTitle: viewTitle({ kind, cohorts: ["A", "B"] } as never),
    };
  }
  return { menuOrder: rich.opts.VIEW_KINDS.map((k) => k.kind), cardOrder: Object.keys(KIND_UI).filter(kindCards.hasKindCard), kinds: out };
}

/** a value with every object's keys in order, so the file pins what is said, not the order it was written in */
const sortKeys = (x: unknown): unknown => Array.isArray(x) ? x.map(sortKeys)
  : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys((x as Record<string, unknown>)[k])])) : x;

test("what every view kind tells the page before data arrives", () => {
  const file = join(import.meta.dirname, "snapshots", "kinds.json");
  const text = JSON.stringify(sortKeys(facts()), null, 2) + "\n";
  if (process.env.UPDATE_SNAPSHOTS || !existsSync(file)) writeFileSync(file, text);
  assert.equal(text, readFileSync(file, "utf8"), "kinds.json changed — review the diff; if intended, UPDATE_SNAPSHOTS=1 npm test");
});
