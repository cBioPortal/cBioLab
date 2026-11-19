// The Somatic / Germline badges on the Mutations tab (MUT-HD-3 badges, MUT-FM-2): a filter on the
// Mutations table's status column. Both on: no filter; one on: { op: "equals", value } (compared
// lower-cased); none on: { values: [] }, which keeps no row (legacy react-mutation-mapper FilterUtils
// onFilterOptionSelect and applyDefaultMutationStatusFilter). The filter lives in the hotspots view's
// `table` (lib/lollipop.ts statusSelection / statusFilter / withStatusFilter), linkMutations
// (app/portal/results-layout.ts) copies it to the table, and HotspotsBody's GeneSummary draws the
// badges. Row ids are the spec table's (B1-B12); what the filter keeps on real rows is
// scripts/check-germline-frequency.ts's L1, and the page's behavior test/e2e/lollipop.cjs's E1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// lib/ch.ts reads these at import; nothing here reaches ClickHouse
process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "fed_a";
process.env.CLICKHOUSE_USER = "u";
process.env.CLICKHOUSE_PASSWORD = "p";
process.env.STUDY_ID = "s1";
for (const k of ["CLICKHOUSE2_URL", "FEDERATION_PEERS", "LOOPBACK_PEER", "CH_RUN_CACHE"]) delete process.env[k];

register("./support/tsx-loader.mjs", import.meta.url);
const { statusSelection, statusFilter, withStatusFilter, buildLollipopGene, pruneLollipopTable } = await import("../lib/lollipop.ts");
const { linkMutations } = await import("../app/portal/results-layout.ts");
const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { HotspotsBody } = await import("../app/_lollipop/HotspotsBody.tsx");
type View = import("../lib/types.ts").View;
type ColumnFilter = import("../lib/table-query.ts").ColumnFilter;
type LollipopRows = import("../lib/federation.ts").LollipopRows;
type HotspotGene = import("../lib/views/hotspots/types.ts").HotspotGene;

const GERMLINE: ColumnFilter = { op: "equals", value: "germline" };
const SOMATIC: ColumnFilter = { op: "equals", value: "somatic" };
const NONE: ColumnFilter = { values: [] };

// ---------------------------------------------------------------- B1-B6: the helpers

test("B1 statusSelection: no filter both; equals Somatic (any case) somatic only; equals germline germline only; values [] neither; another op both", () => {
  assert.deepEqual(statusSelection(undefined), { somatic: true, germline: true });
  assert.deepEqual(statusSelection({ op: "equals", value: "Somatic" }), { somatic: true, germline: false });
  assert.deepEqual(statusSelection({ op: "equals", value: "germline" }), { somatic: false, germline: true });
  assert.deepEqual(statusSelection({ values: [] }), { somatic: false, germline: false });
  assert.deepEqual(statusSelection({ op: "contains", value: "x" }), { somatic: true, germline: true });
});

test("B2 statusFilter: both undefined; somatic only equals somatic; germline only equals germline; neither values []", () => {
  assert.equal(statusFilter({ somatic: true, germline: true }), undefined);
  assert.deepEqual(statusFilter({ somatic: true, germline: false }), SOMATIC);
  assert.deepEqual(statusFilter({ somatic: false, germline: true }), GERMLINE);
  assert.deepEqual(statusFilter({ somatic: false, germline: false }), NONE);
});

test("B3 withStatusFilter(undefined, PTEN, f): a new table query for PTEN holding the status filter alone", () => {
  assert.deepEqual(withStatusFilter(undefined, "PTEN", GERMLINE), { gene: "PTEN", filters: { status: GERMLINE } });
});

test("B4 withStatusFilter removing the status filter keeps the search and the other filters", () => {
  const t = { gene: "PTEN", search: "R1", filters: { status: GERMLINE, vaf: { min: 0.1 } } };
  assert.deepEqual(withStatusFilter(t, "PTEN", undefined), { gene: "PTEN", search: "R1", filters: { vaf: { min: 0.1 } } });
  assert.deepEqual(t.filters, { status: GERMLINE, vaf: { min: 0.1 } }, "the given table is not changed");
});

test("B5 withStatusFilter removing the only filter of a table with nothing else: undefined", () => {
  assert.equal(withStatusFilter({ gene: "PTEN", filters: { status: GERMLINE } }, "PTEN", undefined), undefined);
});

test("B6 withStatusFilter on a table for another gene starts it fresh for this one", () => {
  assert.deepEqual(withStatusFilter({ gene: "KRAS", search: "G12" }, "PTEN", GERMLINE), { gene: "PTEN", filters: { status: GERMLINE } });
});

// ---------------------------------------------------------------- B7-B9: linkMutations

const LP = { kind: "hotspots", genes: ["PTEN"], cohorts: ["Queried"] } as unknown as View;
const TB = { kind: "mutations", gene: "PTEN", cohorts: ["Queried"] } as unknown as View;
const lp = (extra: Record<string, unknown>) => ({ ...LP, ...extra }) as unknown as View;
const tb = (extra: Record<string, unknown>) => ({ ...TB, ...extra }) as unknown as View;
const filtersOf = (vs: View[]) => (vs[1] as unknown as { filters?: Record<string, ColumnFilter> }).filters;
const tableOf = (vs: View[]) => (vs[0] as unknown as { table?: LollipopRows }).table;

test("B7 linkMutations from the lollipop (changed 0): its table's status filter reaches the table view, and the lollipop keeps it", () => {
  const out = linkMutations([lp({ table: { gene: "PTEN", filters: { status: GERMLINE } } }), TB], 0);
  assert.deepEqual(filtersOf(out)?.status, GERMLINE);
  assert.deepEqual(tableOf(out)?.filters?.status, GERMLINE);
  assert.equal(tableOf(out)?.gene, "PTEN");
});

test("B8 linkMutations from the lollipop (changed 0) with its status filter removed: the table's status filter goes, its other filters stay, alteration/proteinPos as before", () => {
  const plot = lp({ hide: ["missense.vus"], codons: { PTEN: [92] } });
  const out = linkMutations([plot, tb({ filters: { status: GERMLINE, vaf: { min: 0.1 } } })], 0);
  const f = filtersOf(out) || {};
  assert.ok(!("status" in f), "status removed: " + JSON.stringify(f));
  assert.deepEqual(f.vaf, { min: 0.1 }, "the vaf range kept");
  const before = filtersOf(linkMutations([plot, tb({ filters: { vaf: { min: 0.1 } } })], 0)) || {};
  assert.deepEqual(f, before, "the same filters as a table that never had a status filter");
  assert.deepEqual(f.proteinPos, { values: ["92"] });
  assert.ok(f.alteration, "the hidden grid cell still filters the Alteration column");
  // the table emptied too: a lollipop whose table is left with nothing clears the table view's status
  const bare = linkMutations([LP, tb({ filters: { status: SOMATIC } })], 0);
  assert.ok(!filtersOf(bare)?.status, "a lollipop with no table: no status filter: " + JSON.stringify(filtersOf(bare)));
});

test("B9 linkMutations from the table (changed 1): the table's own status filter reaches the lollipop's table", () => {
  const out = linkMutations([LP, tb({ filters: { status: SOMATIC } })], 1);
  assert.equal(tableOf(out)?.gene, "PTEN");
  assert.deepEqual(tableOf(out)?.filters, { status: SOMATIC });
  const none = linkMutations([LP, tb({ filters: { status: NONE } })], 1);
  assert.deepEqual(tableOf(none)?.filters, { status: NONE }, "no badge on travels too");
});

// ---------------------------------------------------------------- B10-B12: the badges

const report = (somaticSamples: number, germlineSamples: number, cohortSamples: number) => ({
  changes: [{ gene: "PTEN", pos: 92, change: "D92N", n: 3, rows: 3, driver: true, impact: "missense" }],
  types: [{ gene: "PTEN", pos: 92, mtype: "Missense_Mutation", driver: true, rows: 3 }],
  totals: [{ gene: "PTEN", patients: 3, pairs: 3, somaticSamples, germlineSamples }],
  cohortSamples, germlineCohortSamples: cohortSamples, minCount: 1, annotated: true,
});
const PROTEIN = { proteinLength: 403, transcriptId: "ENST00000371953", domains: [], ids: { refseq: "NM_000314", ensembl: "ENST00000371953.3" } };
/** PTEN: 3 somatic of 136 (2.2%), and `germline` germline of 136 (2: 1.5%) */
const gene = (germline: number): HotspotGene =>
  ({ ...buildLollipopGene("PTEN", [report(3, germline, 136)] as never, PROTEIN), germlineSamples: germline, germlineCohortSamples: 136 } as HotspotGene);
const V = (g: HotspotGene) => ({ kind: "hotspots", note: "the method caption", hotspots: [g] }) as never;
type Props = { table?: LollipopRows; onTable?: (next: LollipopRows | undefined) => void };
const props = (g: HotspotGene, p: Props) => ({ v: V(g), onHide: () => {}, onCodons: () => {}, ...p });
const html = (g: HotspotGene, p: Props = {}) => renderToStaticMarkup(React.createElement(HotspotsBody, props(g, p) as never));

/** each .lp-status button in the markup: its aria-pressed and its text */
const badges = (h: string) => [...h.matchAll(/<button([^>]*\bclass="[^"]*\blp-status\b[^"]*"[^>]*)>([\s\S]*?)<\/button>/g)]
  .map((m) => ({ pressed: /aria-pressed="([^"]*)"/.exec(m[1])?.[1], text: m[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() }));

// The badges' click handlers are reached by calling the components outside a renderer: hooks answer
// from a stand-in dispatcher (state is its initial value, memos run, effects never), and the tree is
// walked for the elements carrying class lp-status.
type El = { type: unknown; props: Record<string, unknown> };
const internals = (React as unknown as Record<string, { H: unknown }>).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
const noop = () => {};
const dispatcher = new Proxy({
  useState: (i: unknown) => [typeof i === "function" ? (i as () => unknown)() : i, noop],
  useReducer: (_r: unknown, a: unknown, init?: (x: unknown) => unknown) => [init ? init(a) : a, noop],
  useMemo: (f: () => unknown) => f(), useCallback: (f: unknown) => f, useRef: (current: unknown) => ({ current }),
  useContext: (c: { _currentValue?: unknown }) => c._currentValue, use: (c: { _currentValue?: unknown }) => c._currentValue,
  useId: () => ":r0:", useSyncExternalStore: (_s: unknown, get: () => unknown) => get(), useTransition: () => [false, (f: () => void) => f()],
  useDeferredValue: (x: unknown) => x, useOptimistic: (x: unknown) => [x, noop], useActionState: (_a: unknown, s: unknown) => [s, noop, false],
}, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : noop) });
const expand = (el: El): unknown => {
  const t = el.type as { $$typeof?: symbol; render?: (p: unknown, r: unknown) => unknown; type?: unknown };
  if (typeof t === "function") return (t as (p: unknown) => unknown)(el.props);
  if (t && t.$$typeof === Symbol.for("react.forward_ref")) return t.render!(el.props, null);
  if (t && t.$$typeof === Symbol.for("react.memo")) return expand({ type: t.type, props: el.props });
  return el.props.children;
};
const walk = (node: unknown, out: El[]): void => {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return; }
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const el = node as El;
  if (typeof el.type === "string") { out.push(el); walk(el.props.children, out); return; }
  // a component that needs a real renderer's context (a Radix menu) is walked by its children alone
  let inner: unknown;
  try { inner = expand(el); } catch { inner = el.props.children; }
  walk(inner, out);
};
const textOf = (node: unknown): string => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  const el = node as El;
  if (typeof el.type === "string") return textOf(el.props.children);
  return el.props ? textOf(expand(el)) : "";
};
const statusButtons = (g: HotspotGene, p: Props): El[] => {
  const prev = internals.H;
  internals.H = dispatcher;
  try {
    const out: El[] = [];
    walk((HotspotsBody as unknown as (p: unknown) => unknown)(props(g, p)), out);
    return out.filter((e) => /\blp-status\b/.test(String(e.props.className || "")));
  } finally { internals.H = prev; }
};

test("B10 a gene with germline samples and onTable: two .lp-status buttons, pressed per the table's status filter; clicking Somatic with both on writes equals germline", async (t) => {
  const g = gene(2);
  const pressed = (table?: LollipopRows) => badges(html(g, { table, onTable: () => {} })).map((b) => b.pressed);
  await t.test("no table: both pressed", () => {
    const b = badges(html(g, { onTable: () => {} }));
    assert.equal(b.length, 2, JSON.stringify(b));
    assert.match(b[0].text, /Somatic/);
    assert.match(b[1].text, /Germline/);
    assert.deepEqual(b.map((x) => x.pressed), ["true", "true"]);
  });
  await t.test("equals germline: Germline alone pressed", () => assert.deepEqual(pressed({ gene: "PTEN", filters: { status: GERMLINE } }), ["false", "true"]));
  await t.test("equals somatic: Somatic alone pressed", () => assert.deepEqual(pressed({ gene: "PTEN", filters: { status: SOMATIC } }), ["true", "false"]));
  await t.test("values []: neither pressed", () => assert.deepEqual(pressed({ gene: "PTEN", filters: { status: NONE } }), ["false", "false"]));
  await t.test("a table for another gene: both pressed", () => assert.deepEqual(pressed({ gene: "KRAS", filters: { status: GERMLINE } }), ["true", "true"]));
  await t.test("clicking Somatic with both on", () => {
    const calls: (LollipopRows | undefined)[] = [];
    const btns = statusButtons(g, { onTable: (next) => { calls.push(next); } });
    assert.equal(btns.length, 2);
    const somatic = btns.find((b) => /Somatic/.test(textOf(b.props.children)) || /Somatic/.test(String(b.props["aria-label"] || "")));
    assert.ok(somatic, "a Somatic button");
    (somatic.props.onClick as (e?: unknown) => void)({ preventDefault: noop, stopPropagation: noop });
    assert.deepEqual(calls, [{ gene: "PTEN", filters: { status: GERMLINE } }]);
  });
});

test("B11 no germline samples, or no onTable: no .lp-status buttons, the somatic rate line as before", async (t) => {
  await t.test("germlineSamples 0, with onTable", () => {
    const h = html(gene(0), { onTable: () => {} });
    assert.equal(badges(h).length, 0);
    assert.match(h, /class="lp-freq/);
    assert.match(h, /Somatic Mutation Frequency<\/span> <b>2\.2%<\/b>/);
    assert.doesNotMatch(h, /Germline Mutation Frequency/);
  });
  await t.test("germlineSamples 2, no onTable", () => {
    const h = html(gene(2));
    assert.equal(badges(h).length, 0);
    assert.match(h, /class="lp-freq/);
    assert.match(h, /Somatic Mutation Frequency<\/span> <b>2\.2%<\/b>/);
    assert.match(h, /Germline Mutation Frequency<\/span> <b>1\.5%<\/b>/);
  });
});

test("B12 the rates' text does not change with the selection", () => {
  const g = gene(2);
  const texts = [undefined, GERMLINE, SOMATIC, NONE].map((f) =>
    badges(html(g, { ...(f ? { table: { gene: "PTEN", filters: { status: f } } } : {}), onTable: () => {} })).map((b) => b.text));
  assert.match(texts[0][0], /2\.2%/);
  assert.match(texts[0][1], /1\.5%/);
  for (const t of texts.slice(1)) assert.deepEqual(t, texts[0]);
});

// the Reviewer's case (#396): a badge's filter on a gene the lab card then removes must go with the gene
test("B13 pruneLollipopTable: kept while its gene is drawn, dropped with the gene", () => {
  const t = { gene: "PTEN", filters: { status: { op: "equals" as const, value: "germline" } } };
  assert.deepEqual(pruneLollipopTable(t, ["PTEN", "KRAS"]), t);
  assert.equal(pruneLollipopTable(t, ["KRAS"]), undefined);
  assert.equal(pruneLollipopTable(undefined, ["KRAS"]), undefined);
});
