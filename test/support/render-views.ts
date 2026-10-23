// Renders an analysis result's view cards to HTML, as the lab page draws them (app/lab/view-cards.tsx),
// so the view snapshots pin each card's controls, subtitle and body as well as its numbers. The page
// context is a fixed stand-in: no study catalog, no edits, nothing loading, every cohort on offer.
import { register } from "node:module";
import type { AnalysisDoc, AnalysisResult } from "../../lib/types.ts";

register("./tsx-loader.mjs", import.meta.url);
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");
const { ViewCard } = await import("../../app/lab/view-cards.tsx");

const noop = () => {};
const none = () => [];

/**
 * Each view's card, as HTML: the card's own markup, not what other snapshots pin. Drawn without
 * the view's timings (they change on every run) and queries (<case>.sql has them), and with each
 * figure's SVG reduced to a mark (<case>.svg has it).
 */
export function renderViewCards(doc: AnalysisDoc, resultAsRun: AnalysisResult): string {
  const result = { ...resultAsRun, views: resultAsRun.views.map(({ ms: _ms, renderMs: _r, queries: _q, ...v }) => v) } as AnalysisResult;
  const views = doc.views || [];
  const ctx = {
    doc, study: doc.study, result, viewIds: views.map((_, i) => i), docHistory: { undo: noop, canUndo: false },
    pendingKeys: new Set(), busy: false, explore: null, cat: null, catLoading: false,
    trackAttrs: { key: "", attrs: [], profiles: [], gaProfiles: [] }, trackAttrsLoading: false,
    contracts: {}, setContracts: noop, menuOpenRef: { current: new Map() }, VIEW_KINDS: [],
    catalogAttrs: none, attrsLoading: () => false, profileOptions: none, profileCatalog: none, assayOptions: none, viewEvents: none,
    drawsOwnHead: () => true, maxCohortsOf: () => undefined,
    docView: (vi: number) => views[vi] || {}, ocView: (vi: number) => views[vi],
    cohortChoice: (_vi: number, v: { cohorts?: string[] }) => {
      const all = Object.keys(result.cohorts);
      return { chosen: v.cohorts || [], all, nodes: all.map((n) => ({ name: n, label: n, kind: "cohort", depth: 0, count: result.cohorts[n].count })),
        drawn: v.cohorts || [], busy: false, viewKey: 0, onChange: noop, onAdd: noop };
    },
    patchView: noop, updateView: noop, updateViewLocal: noop, setViewAttrs: noop, setViewCohorts: noop,
    moveView: noop, removeView: noop, noteEdit: () => undefined, openGenes: noop, openCohortChooser: noop,
    cohortFromSelection: async () => {}, featureFromSelection: async () => {},
  };
  return result.views.map((v, vi) => "<!-- view " + vi + " " + v.kind + " -->\n" +
    renderToStaticMarkup(createElement(ViewCard, { ctx: ctx as never, v, vi })).replace(/<svg\b[^>]*viewBox[\s\S]*?<\/svg>/g, "<svg><!-- figure --></svg>")).join("\n") + "\n";
}
