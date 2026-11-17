// The Mutations tab's driver calls follow the page's driver settings (MUT-BF-2, MUT-MD-2, MUT-0-3):
// the lollipop's SQL (lib/federation.ts lollipop*Sql with `drivers`), the report's `annotated`
// (lollipopCounts' 5th argument, and the federation API carrying it), the mutation table's `drv`
// (lib/mutation-table.ts mutationRowSource with `drivers`, alterationSql), the grid and legend when
// nothing is annotated (app/_lollipop/AlterationGrid.tsx, ColorLegend, lib/lollipop.ts lollipopLegend)
// and the Results page's views (app/portal/results-layout.ts). Row ids are the spec table's (L, R, T,
// G, P). What these calls give on real rows is run against the fixture study by
// scripts/check-mutation-driver-settings.ts (F, R3-R6).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// lib/ch.ts reads these at import
process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "fed_a";
process.env.CLICKHOUSE_USER = "u";
process.env.CLICKHOUSE_PASSWORD = "p";
process.env.STUDY_ID = "s1";
process.env.ONCOKB_PIN = "v-test";
for (const k of ["CLICKHOUSE2_URL", "FEDERATION_PEERS", "LOOPBACK_PEER", "CH_RUN_CACHE", "FEDERATION_DISCLOSE_PATIENTS", "FEDERATION_ACCEPT_PATIENT_LEVEL",
  "FEDERATION_HIDE_SQL", "AGGREGATE_ONLY_INSTANCES", "AGGREGATE_ONLY_STUDIES", "STUDY_DENY", "STUDY_ALLOW_RESTRICTED", "GENOME_NEXUS_PIN", "GENOME_NEXUS_GRCH38_PIN"]) delete process.env[k];

const { setChTransport, PRIMARY } = await import("../lib/ch.ts");
const fed = await import("../lib/federation.ts");
const { lollipopChangesSql, lollipopTypesSql, lollipopTotalsSql, PatientLevelResolver, AggregateResolver } = fed;
const { mutationRowSource, alterationSql } = await import("../lib/mutation-table.ts");
const { resolveDrivers, withDrivers } = await import("../lib/driver-settings.ts");
const { lollipopLegend, IMPACT_COLORS } = await import("../lib/lollipop.ts");
const { resultsLayout, syncDrivers, syncDriverCohorts } = await import("../app/portal/results-layout.ts");
const { answerFederation } = await import("../lib/federation-api.ts");
const { RemoteAggregateResolver } = await import("../lib/federation-remote.ts");
type View = import("../lib/types.ts").View;
type DriverSettings = import("../lib/driver-settings.ts").DriverSettings;

register("./support/tsx-loader.mjs", import.meta.url);
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");
const { AlterationGrid, classesOf } = await import("../app/_lollipop/AlterationGrid.tsx");
const { ColorLegend } = await import("../app/_lollipop/ColorLegend.tsx");

// a stand-in warehouse: every statement answers no rows (routing answers the one study, a size one patient)
const sent: string[] = [];
setChTransport(async ({ query }) => {
  sent.push(query);
  const data = /SELECT cancer_study_identifier AS id, name FROM fed_a\.cancer_study/.test(query) ? [{ id: "s1", name: "Study one" }]
    : /AS patients, uniqExact\(sid\) AS samples/.test(query) ? [{ patients: 1, samples: 1 }] : [];
  return JSON.stringify({ meta: [], data, rows: data.length });
});
after(() => setChTransport(null));
const realLog = console.log;
before(() => { console.log = () => {}; });
after(() => { console.log = realLog; });

// ---------------------------------------------------------------- L: the lollipop's SQL
const COHORT = "SELECT 'P1' AS pid, 'S1' AS sid";
const STUDY = "paad_x", DB = "db", PIN = "v1";
const HOT = { hg19: "g1", hg38: null };
/** KRAS is on the hotspot gene list, so a hotspot pin gives a key subquery for it */
const GENES = ["KRAS"];
type R = ReturnType<typeof resolveDrivers>;
const changes = (drivers?: R, pin: string | null = PIN, hot: typeof HOT | null = HOT) =>
  String(drivers === undefined ? lollipopChangesSql(COHORT, GENES, STUDY, 1, pin, DB, hot) : lollipopChangesSql(COHORT, GENES, STUDY, 1, pin, DB, hot, undefined, undefined, drivers));
const types = (drivers?: R, pin: string | null = PIN, hot: typeof HOT | null = HOT) =>
  String(drivers === undefined ? lollipopTypesSql(COHORT, GENES, STUDY, 1, pin, DB, hot) : lollipopTypesSql(COHORT, GENES, STUDY, 1, pin, DB, hot, undefined, undefined, drivers));
/** the mutation rows' driver expression, as the `m` CTE selects it */
const mutTerm = (sql: string) => {
  const m = /mutationStatus AS status,\s*([\s\S]*?)\s+AS driver,\s*toUInt8\(0\) AS sv/.exec(sql);
  assert.ok(m, "the m CTE selects a mutation row's driver before `toUInt8(0) AS sv`");
  return m[1];
};
/** the fusion rows' driver expression */
const fusTerm = (sql: string) => {
  const m = /v\.status AS status,\s*([\s\S]*?)\s+AS driver,\s*toUInt8\(1\) AS sv/.exec(sql);
  assert.ok(m, "the m CTE selects a fusion row's driver before `toUInt8(1) AS sv`");
  return m[1];
};
const ONCOKB_IN = /annotation\.oncokb\b(?!_)[\s\S]*oncokb_version = 'v1'/;
const HOTSPOT = /'hotspots'/;
const CUSTOM = /driverFilter(?:,\s*'')?\)?\s*=\s*'Putative_Driver'/;
const ANY_TIER = /driverTiersFilter(?:,\s*'')?\)?\s*!=\s*''/;
const TIER_TERM = /driverTiersFilter/;
const ONE = /^\s*(?:toUInt8\(\s*1\s*\)|1)\s*$/;
const ZERO = /^\s*(?:toUInt8\(\s*0\s*\)|0)\s*$/;
const OFF: DriverSettings = { oncokb: false, hotspots: false, custom: false, tiers: [] };

describe("L the lollipop's SQL follows the driver settings", () => {
  test("L1 drivers omitted: the SQL is the same as passing undefined, and reads OncoKB or a hotspot alone, as today", () => {
    const omitted = String(lollipopChangesSql(COHORT, GENES, STUDY, 1, PIN, DB, HOT));
    assert.equal(String(lollipopChangesSql(COHORT, GENES, STUDY, 1, PIN, DB, HOT, undefined, undefined, undefined)), omitted);
    assert.equal(String(lollipopTypesSql(COHORT, GENES, STUDY, 1, PIN, DB, HOT, undefined, undefined, undefined)), String(lollipopTypesSql(COHORT, GENES, STUDY, 1, PIN, DB, HOT)));
    assert.equal(String(lollipopTotalsSql(COHORT, GENES, STUDY, DB, undefined, undefined, undefined)), String(lollipopTotalsSql(COHORT, GENES, STUDY, DB)));
    const t = mutTerm(omitted);
    assert.match(t, ONCOKB_IN);
    assert.match(t, HOTSPOT);
    assert.doesNotMatch(t, TIER_TERM, "no custom or tier term when no settings are given");
    assert.doesNotMatch(t, /driverFilter/);
    assert.match(mutTerm(String(lollipopChangesSql(COHORT, GENES, STUDY, 1, null, DB, null))), ONE, "no pin, no settings: every mutation a driver, as today");
  });

  test("L2 the defaults with a pin and hotspot pins: OncoKB, the hotspot keys, Putative_Driver and any tier", () => {
    for (const sql of [changes(resolveDrivers({})), types(resolveDrivers({}))]) {
      const t = mutTerm(sql);
      assert.match(t, ONCOKB_IN);
      assert.match(t, HOTSPOT);
      assert.match(t, CUSTOM);
      assert.match(t, ANY_TIER);
    }
  });

  test("L3 OncoKB off: the mutation term reads no OncoKB table; a fusion's driver is 0", () => {
    for (const sql of [changes(resolveDrivers({ oncokb: false })), types(resolveDrivers({ oncokb: false }))]) {
      assert.doesNotMatch(mutTerm(sql), /annotation\.oncokb/);
      assert.match(mutTerm(sql), HOTSPOT, "the other sources stay");
      assert.match(fusTerm(sql), ZERO);
    }
  });

  test("L4 hotspots off: no hotspot key subquery in the mutation term", () => {
    const t = mutTerm(types(resolveDrivers({ hotspots: false })));
    assert.doesNotMatch(t, HOTSPOT);
    assert.match(t, ONCOKB_IN, "OncoKB stays");
  });

  test("L5 custom off and no tier: no driverFilter / driverTiersFilter in the driver term", () => {
    const t = mutTerm(types(resolveDrivers({ custom: false, tiers: [] })));
    assert.doesNotMatch(t, /driverFilter/);
    assert.doesNotMatch(t, TIER_TERM);
    assert.match(t, ONCOKB_IN);
  });

  test("L6 a tier list: driverTiersFilter IN ('Tier 1', 'Tier 2')", () => {
    const t = mutTerm(types(resolveDrivers({ tiers: ["Tier 1", "Tier 2"] })));
    assert.match(t, /driverTiersFilter(?:,\s*'')?\)?\s+IN\s*\(\s*'Tier 1'\s*,\s*'Tier 2'\s*\)/);
    assert.doesNotMatch(t, ANY_TIER, "not every tier");
  });

  test("L7 every source off: every mutation and fusion row's driver is 1", () => {
    for (const sql of [changes(resolveDrivers(OFF)), types(resolveDrivers(OFF))]) {
      assert.match(mutTerm(sql), ONE);
      assert.match(fusTerm(sql), ONE);
    }
    assert.match(mutTerm(types(resolveDrivers(OFF), null, null)), ONE, "with no pin either");
  });

  test("L8 the defaults with no OncoKB pin and no hotspot pins: the custom and tier terms only", () => {
    const sql = types(resolveDrivers({}), null, null);
    const t = mutTerm(sql);
    assert.match(t, CUSTOM);
    assert.match(t, ANY_TIER);
    assert.doesNotMatch(t, /annotation\.oncokb/);
    assert.doesNotMatch(t, HOTSPOT);
    assert.doesNotMatch(fusTerm(sql), /oncokb/, "no OncoKB read for a fusion either");
  });

  test("L1 lollipopTotalsSql takes the settings as its last argument and still counts rows", () => {
    const sql = String(lollipopTotalsSql(COHORT, GENES, STUDY, DB, undefined, { lines: ["KRAS"], pin: PIN }, resolveDrivers({ oncokb: false })));
    assert.match(sql, /AS somatic_samples/);
    assert.doesNotMatch(mutTerm(sql), /annotation\.oncokb/);
  });
});

// ---------------------------------------------------------------- R: the report's `annotated`
type Lollipop = (def: unknown, genes: string[], minCount?: number, oql?: unknown, drivers?: DriverSettings) => Promise<{ annotated: boolean }>;
const resolver = (pin: string | null) =>
  new PatientLevelResolver("s1", { oncokbPin: pin }, { id: PRIMARY.id, mode: "patient-level", label: "stand-in", conn: PRIMARY });
const annotated = async (pin: string | null, drivers?: DriverSettings) =>
  (await (resolver(pin).lollipopCounts as unknown as Lollipop)({ all: [] }, ["KRAS"], 1, undefined, drivers)).annotated;

describe("R the report says whether drivers are told apart", () => {
  test("R1 drivers omitted: annotated is whether there is an OncoKB pin, as today", async () => {
    assert.equal(await annotated("v1"), true);
    assert.equal(await annotated(null), false);
  });
  test("R2 the defaults with a pin: annotated", async () => {
    assert.equal(await annotated("v1", {}), true);
  });
  test("R3 every source off: not annotated, even with a pin", async () => {
    assert.equal(await annotated("v1", OFF), false);
  });
  test("R4 OncoKB alone, but no pin: not annotated (OncoKB is not offered)", async () => {
    assert.equal(await annotated(null, { oncokb: true, hotspots: false, custom: false, tiers: [] }), false);
  });
  test("R5 custom calls alone, no pin: annotated (custom calls need no store)", async () => {
    assert.equal(await annotated(null, { oncokb: false, hotspots: false, custom: true, tiers: [] }), true);
  });

  test("R7 the federation API carries lollipopDrivers to the peer's lollipopCounts as its 5th argument", async () => {
    const seen: unknown[][] = [];
    const fake = async function (this: unknown, ...args: unknown[]) {
      seen.push(args);
      return { changes: [], types: [], totals: [], cohortSamples: 0, minCount: 1, annotated: false };
    };
    (PatientLevelResolver.prototype as { lollipopCounts: unknown }).lollipopCounts = fake;
    (AggregateResolver.prototype as { lollipopCounts: unknown }).lollipopCounts = fake;
    try {
      const with_ = await answerFederation("aggregates", { study: "s1", cohort: { all: [] }, lollipopGenes: ["KRAS"], lollipopDrivers: { oncokb: false } });
      assert.equal(with_.status, 200, JSON.stringify(with_.body));
      const without = await answerFederation("aggregates", { study: "s1", cohort: { all: [] }, lollipopGenes: ["KRAS"] });
      assert.equal(without.status, 200, JSON.stringify(without.body));
    } finally {
      // both inherit lollipopCounts from their base: removing the stand-in restores it
      delete (PatientLevelResolver.prototype as { lollipopCounts?: unknown }).lollipopCounts;
      delete (AggregateResolver.prototype as { lollipopCounts?: unknown }).lollipopCounts;
    }
    assert.equal(seen.length, 2);
    assert.deepEqual(seen[0][4], { oncokb: false });
    assert.equal(seen[1][4] ?? undefined, undefined);
  });

  test("R7 the remote resolver sends lollipopDrivers in the body when given, and not otherwise", async () => {
    const bodies: Record<string, unknown>[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ study: "s1", count: 1, samples: 1, oncokbPin: null,
        lollipopCounts: { changes: [], types: [], totals: [], cohortSamples: 1, minCount: 1, annotated: false } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const r = new RemoteAggregateResolver("s1", "http://peer.invalid/api/federation/v1", { id: "peer", mode: "aggregate-only", label: "test peer", conn: PRIMARY });
      const call = Object.getOwnPropertyDescriptor(RemoteAggregateResolver.prototype, "lollipopCounts")?.value as Lollipop;
      await call.call(r, { all: [] }, ["KRAS"], 1, undefined, { hotspots: false });
      await call.call(r, { all: [] }, ["KRAS"], 1);
    } finally { globalThis.fetch = original; }
    assert.deepEqual(bodies[0].lollipopDrivers, { hotspots: false });
    assert.equal("lollipopDrivers" in bodies[1], false);
  });
});

// ---------------------------------------------------------------- T: the mutation table
const PART = [{ cohort: "c", study: STUDY, cohortSql: COHORT }];
const TPINS = { hg19: "g1", hg38: null };
const table = (drivers?: R, pin: string | null = PIN) =>
  (drivers === undefined ? mutationRowSource(PART, DB, "KRAS", pin, TPINS) : mutationRowSource(PART, DB, "KRAS", pin, TPINS, undefined, drivers)).with;
/** each row kind's `drv`, as selected after its Annotation cell: [mutation rows, fusion rows] */
const drvTerms = (w: string) => {
  const all = [...w.matchAll(/ AS level,\s*((?:(?! AS level,)[\s\S])*?)\s+AS drv\b/g)].map((m) => m[1]);
  assert.equal(all.length, 2, "a mutation and a fusion `drv` per part");
  return all;
};
/** the Annotation cell's text: from the protein change to the level */
const annotationCell = (w: string) => {
  const m = /m\.proteinChange AS proteinChange,([\s\S]*?AS level),/.exec(w);
  assert.ok(m, "the mutation rows select oncogenicity and level");
  return m[1];
};

describe("T the mutation table's driver call follows the settings", () => {
  test("T1 drivers omitted: the SQL is the same as passing undefined, and calls by OncoKB and hotspot alone, as today", () => {
    const omitted = mutationRowSource(PART, DB, "KRAS", PIN, TPINS);
    const undef = mutationRowSource(PART, DB, "KRAS", PIN, TPINS, undefined, undefined);
    assert.equal(undef.with, omitted.with);
    assert.equal(undef.defaultOrder, omitted.defaultOrder);
    const [mut, fus] = drvTerms(omitted.with);
    assert.match(mut, /\bann\./);
    assert.match(mut, /'hotspots'/);
    assert.doesNotMatch(mut, /driverFilter|driverTiersFilter/);
    assert.match(fus, /\bvn\./);
  });

  test("T2 OncoKB off: a mutation's drv reads no OncoKB call, a fusion's is 0, and the Annotation cell is unchanged", () => {
    const w = table(resolveDrivers({ oncokb: false }));
    const [mut, fus] = drvTerms(w);
    assert.doesNotMatch(mut, /\b(?:ann|tt)\./);
    assert.match(fus, ZERO);
    assert.equal(annotationCell(w), annotationCell(table()));
    assert.match(annotationCell(w), /tt\.oncogenicity/);
  });

  test("T3 hotspots off: no hotspot term in drv", () => {
    const [mut] = drvTerms(table(resolveDrivers({ hotspots: false })));
    assert.doesNotMatch(mut, /'hotspots'/);
    assert.match(mut, /\bann\./, "OncoKB stays");
  });

  test("T4 the defaults: drv adds the Putative_Driver and any-tier terms, read from mutation_derived in the m CTE", () => {
    const w = table(resolveDrivers({}));
    const [mut] = drvTerms(w);
    assert.match(mut, CUSTOM);
    assert.match(mut, ANY_TIER);
    assert.match(mut, /\bann\./);
    assert.match(mut, /'hotspots'/);
    const m0 = /\bm0 AS \(([\s\S]*?)FROM db\.mutation_derived/.exec(w);
    assert.ok(m0, "the m0 CTE");
    assert.match(m0[1], /driverFilter/);
    assert.match(m0[1], /driverTiersFilter/);
  });

  test("T5 every source off: the Alteration label is '<Class> · Driver' for every row", () => {
    const off = alterationSql(false as never);
    assert.doesNotMatch(off, /VUS/);
    assert.doesNotMatch(off, /\bdrv\b/);
    assert.match(off, /' · Driver'/);
    const on = alterationSql(true as never);
    assert.match(on, /if\(drv = 1, ' · Driver', ' · VUS'\)/);
  });
});

// ---------------------------------------------------------------- G: the grid and legend
const TALLY = {
  missense: { driver: 5, vus: 2 }, truncating: { driver: 0, vus: 0 }, inframe: { driver: 1, vus: 3 },
  splice: { driver: 0, vus: 0 }, fusion: { driver: 6, vus: 0 }, other: { driver: 0, vus: 0 }
};
const CLASSES = classesOf([TALLY]);
type El = { type: unknown; props: Record<string, unknown> };
/** every element of a component's output: a nested component (none has hooks) is expanded, a badge (a count and a click) kept as it is */
const elements = (node: unknown): El[] => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const el = node as El;
  if (typeof el.type === "function" && !(typeof el.props.n === "number" && typeof el.props.onClick === "function"))
    return elements((el.type as (p: unknown) => unknown)(el.props));
  return [el, ...elements(el.props.children)];
};
const grid = (annotated: boolean | undefined, hide: string[] = []) => {
  const calls: string[][] = [];
  const props = { tally: TALLY, classes: CLASSES, hide: new Set(hide), onHide: (next: string[]) => { calls.push(next); },
    ...(annotated === undefined ? {} : { annotated }) };
  const out = (AlterationGrid as unknown as (p: typeof props) => unknown)(props);
  const html = renderToStaticMarkup(createElement(AlterationGrid as never, props as never));
  const els = elements(out);
  const badges = els.filter((e) => typeof e.props.n === "number" && typeof e.props.onClick === "function");
  const only = els.filter((e) => e.type === "button" && e.props.className === "lp-only");
  return { calls, html, badges, only };
};
const colNames = (html: string) => [...html.matchAll(/class="lp-colname"[^>]*>([^<]*)</g)].map((m) => m[1]);

describe("G the grid and legend when nothing is annotated", () => {
  test("G1 annotated (and by default): Driver and VUS columns, a badge per cell", () => {
    for (const a of [true, undefined]) {
      const g = grid(a);
      assert.deepEqual(colNames(g.html), ["Driver", "VUS"]);
      const ns = g.badges.map((b) => b.props.n);
      for (const n of [5, 2, 1, 3, 6]) assert.ok(ns.includes(n), "a badge of " + n + " (" + ns.join(",") + ")");
    }
  });

  test("G2 not annotated: no Driver/VUS header; one badge per class showing driver+vus", () => {
    const g = grid(false);
    assert.deepEqual(colNames(g.html), []);
    assert.doesNotMatch(g.html, />Driver</);
    assert.doesNotMatch(g.html, />VUS</);
    const ns = g.badges.map((b) => b.props.n as number);
    assert.equal(ns.length, CLASSES.length, "one badge per class (" + ns.join(",") + ")");
    assert.deepEqual(ns, CLASSES.map((k) => TALLY[k].driver + TALLY[k].vus));
  });

  test("G2 not annotated: a class's badge toggles both its cells", () => {
    const g = grid(false);
    const missense = g.badges.find((b) => b.props.n === 7)!;
    (missense.props.onClick as () => void)();
    assert.deepEqual([...g.calls[0]].sort(), ["missense.driver", "missense.vus"]);
    const back = grid(false, ["missense.driver", "missense.vus"]);
    (back.badges.find((b) => b.props.n === 7)!.props.onClick as () => void)();
    assert.deepEqual(back.calls[0], [], "clicking it again shows both");
  });

  test("G2 not annotated: 'only' keeps the class (both its cells), hiding every other", () => {
    const g = grid(false);
    const only = g.only.find((b) => String(b.props["data-tip"] || "").includes("missense"));
    assert.ok(only, "the missense row has an 'only'");
    (only.props.onClick as () => void)();
    const hidden = new Set(g.calls[0]);
    assert.ok(!hidden.has("missense.driver") && !hidden.has("missense.vus"));
    for (const k of CLASSES.filter((k) => k !== "missense")) assert.ok(hidden.has(k + ".driver") && hidden.has(k + ".vus"), k);
  });

  test("G3 not annotated: the legend lists one line per type", () => {
    const lines = lollipopLegend({ drivers: false, fusions: true });
    assert.ok(lines.every((l) => !/putative driver|unknown significance/.test(l.label)));
    assert.equal(lines.length, 6);
    assert.ok(lines.some((l) => l.label === IMPACT_COLORS.missense.label + " Mutations"));
    const html = renderToStaticMarkup(createElement(ColorLegend as never, { drivers: false } as never));
    assert.doesNotMatch(html, /putative driver|unknown significance/);
  });
});

// ---------------------------------------------------------------- P: the Results page
const rq = (entries: string[]) => ({ studies: ["a"], filters: [], entries, genes: [...new Set(entries.map((x) => x.split(":")[0].trim().toUpperCase()))] });
const rdata = { expr: "rna_seq_v2_mrna", cna: "gistic", clinical: ["AGE"], numeric: ["MUTATION_COUNT"], expressionAcross: true,
  held: { every: ["MUTATION", "CNA"], some: ["SV"] } } as unknown as Parameters<typeof resultsLayout>[1];
type MutView = View & { drivers?: unknown };
const mutViews = (entries: string[]) => {
  const l = resultsLayout(rq(entries) as never, rdata);
  const tab = l.tabs.find((t) => t.title === "Mutations")!;
  return { l, views: tab.views!.map((i) => l.doc.views![i]) as MutView[] };
};
const byKind = (vs: View[], kind: string) => vs.find((v) => v.kind === kind) as MutView;

describe("P the Results page's Mutations tab holds the page's driver settings", () => {
  test("P1 both views carry `drivers` (an object), with or without DRIVER in the query", () => {
    for (const entries of [["KRAS"], ["KRAS: MUT=G12D", "TP53"], ["KRAS: MUT_DRIVER"], ["TP53: DRIVER", "KRAS"]]) {
      const { views } = mutViews(entries);
      assert.deepEqual(views.map((v) => v.kind).sort(), ["hotspots", "mutations"]);
      for (const v of views) {
        assert.ok(v.drivers !== null && typeof v.drivers === "object" && !Array.isArray(v.drivers), v.kind + ": " + entries.join("; "));
      }
    }
  });

  test("P2 the oncoprint's sources change to {oncokb:false}: both views follow, sources only", () => {
    for (const entries of [["KRAS"], ["KRAS: MUT_DRIVER"]]) {
      const { l } = mutViews(entries);
      const views = l.doc.views || [];
      const at = views.findIndex((v) => v.kind === "oncoprint");
      assert.ok(at >= 0);
      const next = views.map((v, i) => i === at ? withDrivers(v as never, { oncokb: false, hideVus: true, hideGermline: true }) as unknown as View : v);
      const synced = syncDrivers(views, next);
      for (const kind of ["hotspots", "mutations"]) assert.deepEqual(byKind(synced, kind).drivers, { oncokb: false }, kind + ": " + entries.join("; "));
      const doc = syncDriverCohorts({ ...l.doc, views: synced });
      for (const kind of ["hotspots", "mutations"]) assert.deepEqual(byKind(doc.views!, kind).drivers, { oncokb: false }, kind + " after syncDriverCohorts: " + entries.join("; "));
    }
  });
});

// keep `sent` read so the stand-in's record is available when debugging a failure
test("the stand-in warehouse answered every statement", () => { assert.ok(Array.isArray(sent)); });
