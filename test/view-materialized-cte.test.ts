// Materialized WITH subqueries in the views' statements (what needs no database; the rows are
// test/view-materialized-fixture.test.ts):
//   V1  viewAggregate hands build `materialized`: false, without asking the connection, unless
//       opts.materialize is true; then materializedCteSupported's answer for that resolver's connection
//   V2  each builder's trailing `materialized`: left out or false, the plain statement; true, exactly
//       its named CTEs `AS MATERIALIZED` and the setting appended, nothing else
//   V3  sideCountsTail materializes only `alt`; the paired and ctdna statements stay plain;
//       instabilityArmsSql has no materialized form
//   V4  the runners ask with { materialize: true } for acquired (funnel, genes), cancertypes,
//       txendpoints, rmst and instability scores, and not for instability arms
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import type { ChConn } from "../lib/ch.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult } from "../lib/types.ts";
import { materializedCases, SETTING } from "./support/view-mcte-cases.ts";

const FLAG = "CLICKHOUSE_MATERIALIZED_CTE";
delete process.env.CH_RUN_CACHE;
delete process.env[FLAG];
const { CTE_CHECK_SQL, materializedCteSupported, setChTransport, PRIMARY } = await import("../lib/ch.ts");
const { PatientLevelResolver, AggregateResolver } = await import("../lib/federation.ts");
const { sideCountsTail } = await import("../lib/federation-views.ts");
const { instabilityArmsSql } = await import("../lib/views/instability/sql.ts");
const { pairedCountsSql, pairedPatientsSql } = await import("../lib/views/paired/sql.ts");
const { ctdnaCountsSql, ctdnaFunnelSql, ctdnaSurvivalSql, ctdnaChRemovedSql } = await import("../lib/views/ctdna/sql.ts");
const { runAcquired } = await import("../lib/views/acquired/run.ts");
const { runCancertypes } = await import("../lib/views/cancertypes/run.ts");
const { runTxendpoints } = await import("../lib/views/txendpoints/run.ts");
const { runRmst } = await import("../lib/views/rmst/run.ts");
const { runInstability } = await import("../lib/views/instability/run.ts");

/** `plain` with each named CTE's one definition `name AS MATERIALIZED (`, and the setting at the end */
function materializedForm(plain: string, names: string[], setting = SETTING): string {
  let s = plain;
  for (const n of names) {
    const def = new RegExp("(^(?:WITH )?|\\n *)" + n + " AS \\(", "g");
    assert.equal([...s.matchAll(def)].length, 1, "`" + n + " AS (` is defined once in the plain statement");
    s = s.replace(def, "$1" + n + " AS MATERIALIZED (");
  }
  return s + setting;
}
const assertPlain = (sql: string, what: string) => {
  assert.doesNotMatch(sql, /MATERIALIZED/, what + " holds no materialized subquery");
  assert.doesNotMatch(sql, /enable_materialized_cte/, what + " carries no setting");
};

// ---------------------------------------------------------------------------------------------
// V1 viewAggregate, on resolvers whose connection is answered by a stand-in for the database
// ---------------------------------------------------------------------------------------------
const CHECK_WIRE = CTE_CHECK_SQL + "\nFORMAT JSON";
/** every statement sent, per connection url */
const sent: { url: string; body: string }[] = [];
/** urls whose server refuses the setting */
const refusing = new Set<string>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  if (!u.startsWith("http://fake-ch-")) return realFetch(url, init);
  const body = typeof init?.body === "string" ? init.body : "";
  sent.push({ url: u, body });
  const base = u.split("/?")[0];
  if (body === CHECK_WIRE) {
    if (refusing.has(base)) return new Response("Code: 115. DB::Exception: Unknown setting 'enable_materialized_cte'", { status: 500 });
    return new Response(JSON.stringify({ meta: [{ name: "ok", type: "UInt8" }], data: [{ ok: 1 }], rows: 1 }));
  }
  return new Response(JSON.stringify({ meta: [{ name: "n", type: "UInt64" }], data: [{ n: 7 }], rows: 1 }));
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; delete process.env[FLAG]; });

let k = 0;
/** a connection not asked about yet, answered by the stand-in; `refuses`: its server refuses the setting */
function freshConn(refuses = false): ChConn {
  const id = "fake" + (++k);
  const url = "http://fake-ch-" + id + ":8123";
  if (refuses) refusing.add(url);
  return { ...PRIMARY, id, url, user: "u", password: "p", db: "cbioportal", label: id } as ChConn;
}
const KINDS = {
  "patient-level": (c: ChConn) => new PatientLevelResolver("s1", { oncokbPin: null }, { id: c.id, mode: "patient-level", label: c.id, conn: c }),
  "aggregate-only": (c: ChConn) => new AggregateResolver("s1", { oncokbPin: null }, { id: c.id, mode: "aggregate-only", label: c.id, conn: c }),
} as const;
const checksTo = (c: ChConn) => sent.filter((s) => s.url.startsWith(c.url) && s.body === CHECK_WIRE).length;
/** viewAggregate on a fresh connection: what build was handed, the rows, and how many checks were sent */
async function aggregate(kind: keyof typeof KINDS, opts: unknown, c = freshConn()) {
  const r = KINDS[kind](c);
  const handed: unknown[] = [];
  const args = [(cohortSql: string, study: string, db: string, m: unknown) => {
    handed.push(m);
    return "SELECT count() AS n FROM " + db + ".t WHERE " + JSON.stringify(study) + " != '' AND 1 IN (SELECT 1 FROM (" + cohortSql + "))";
  }, ...(opts === "absent" ? [] : [opts])];
  const rows = await (r.viewAggregate as (...a: unknown[]) => Promise<unknown[]>)("v1", null, ...args);
  return { c, handed, rows, checks: checksTo(c), logged: r.queries.map((q) => q.label) };
}

describe("V1 viewAggregate hands build whether its statement may be materialized", () => {
  for (const kind of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
    for (const [what, opts] of [["no opts", "absent"], ["opts {}", {}], ["materialize: false", { materialize: false }],
      ["materialize undefined", { materialize: undefined }]] as const) {
      test(kind + ", " + what + ": false, and the connection is never asked", async () => {
        const a = await aggregate(kind, opts);
        assert.deepEqual(a.handed, [false]);
        assert.equal(a.checks, 0, "no check was sent");
        assert.deepEqual(a.rows, [{ n: 7 }], "the statement ran");
        assert.deepEqual(a.logged, ["v1"]);
        // asked now, the connection sends its first check: nothing had been remembered for it
        sent.length = 0;
        assert.equal(await materializedCteSupported(a.c), true);
        assert.equal(checksTo(a.c), 1, "the connection had not been asked before");
      });
    }
    test(kind + ", materialize: true, a server that runs the setting: true, asked once", async () => {
      const c = freshConn();
      const a = await aggregate(kind, { materialize: true }, c);
      assert.deepEqual(a.handed, [true]);
      assert.equal(a.checks, 1);
      assert.deepEqual(a.rows, [{ n: 7 }]);
      const b = await aggregate(kind, { materialize: true }, c);
      assert.deepEqual(b.handed, [true]);
      assert.equal(b.checks, 1, "the answer is remembered for the connection");
    });
    test(kind + ", materialize: true, a server that refuses the setting: false", async () => {
      const c = freshConn(true);
      const a = await aggregate(kind, { materialize: true }, c);
      assert.deepEqual(a.handed, [false]);
      assert.equal(a.checks, 1, "it was asked");
      assert.equal(await materializedCteSupported(c), false, "the same answer as materializedCteSupported");
    });
    test(kind + ", materialize: true, " + FLAG + "=0: false; =1: true; neither asks", async () => {
      try {
        process.env[FLAG] = "0";
        const off = await aggregate(kind, { materialize: true });
        assert.deepEqual([off.handed, off.checks], [[false], 0]);
        process.env[FLAG] = "1";
        const on = await aggregate(kind, { materialize: true }, freshConn(true));
        assert.deepEqual([on.handed, on.checks], [[true], 0]);
      } finally { delete process.env[FLAG]; }
    });
    test(kind + ", materialize: true with a transport set: false, as materializedCteSupported answers", async () => {
      const c = freshConn();
      setChTransport(async (_st, send) => send());
      try {
        assert.equal(await materializedCteSupported(c), false);
        const a = await aggregate(kind, { materialize: true }, c);
        assert.deepEqual([a.handed, a.checks], [[false], 0]);
      } finally { setChTransport(null); }
    });
  }
  test("each resolver asks about its own connection", async () => {
    const yes = freshConn(), no = freshConn(true);
    const [a, b] = await Promise.all([aggregate("patient-level", { materialize: true }, yes), aggregate("aggregate-only", { materialize: true }, no)]);
    assert.deepEqual([a.handed, b.handed], [[true], [false]]);
    assert.deepEqual([checksTo(yes), checksTo(no)], [1, 1]);
  });
});

// ---------------------------------------------------------------------------------------------
// V2 the builders
// ---------------------------------------------------------------------------------------------
const UNIT = { study: "x", db: "db", cohortSql: "SELECT 'x_P1' AS pid", genes: ["TP53", "ESR1", "KRAS"], pin: "v7.5",
  subtype: "Hormone", sampleEvent: "Sequencing", profiles: ["mutations", "cna", "structural_variants"] };

describe("V2 builders: materialized false is the plain statement; true changes exactly the named CTEs and appends the setting", () => {
  for (const c of materializedCases(UNIT)) {
    test(c.name + " (" + c.names.join(", ") + ")", () => {
      const plain = c.build(), off = c.build(false), on = c.build(true);
      assertPlain(plain, "the plain statement");
      assert.equal(off, plain, "false is byte for byte the statement built without the argument");
      assert.equal(on, materializedForm(plain, c.names));
      assert.equal(on.split("AS MATERIALIZED (").length - 1, c.names.length, "only the named CTEs are materialized");
      assert.equal(on.split("enable_materialized_cte").length - 1, 1, "the setting once, at the very end");
    });
  }
  test("cancerTypesSql: the cohort CTE stays plain", () => {
    const on = materializedCases(UNIT).find((c) => c.name.startsWith("cancerTypesSql"))!.build(true);
    assert.match(on, /^WITH cohort AS \(/);
  });
});

describe("V3 sideCountsTail, the paired and ctdna statements, instability arms", () => {
  const tails: [string, Parameters<typeof sideCountsTail>][] = [
    ["genes, driver", ["x", "db", ["TP53", "ESR1"], "v7.5", "driver"]],
    ["scan, any", ["x", "db", null, null, "any"]],
    ["genes, any, exclude", ["x", "db", ["EGFR"], null, "any", "ps.side = 'a'"]],
    ["scan, driver, exclude", ["x", "db", null, "v7.5", "driver", "1 = 1"]],
  ];
  for (const [what, a] of tails) {
    test("sideCountsTail " + what + ": false is the default; true materializes only alt, with no setting of its own", () => {
      const [study, db, genes, pin, measure, exclude] = a;
      const plain = sideCountsTail(study, db, genes, pin, measure, exclude);
      assertPlain(plain, "the plain tail");
      assert.equal(sideCountsTail(study, db, genes, pin, measure, exclude, false), plain);
      const on = sideCountsTail(study, db, genes, pin, measure, exclude, true);
      assert.equal(on, materializedForm(plain, ["alt"], ""));
    });
  }
  const C = "SELECT 'x_P1' AS pid";
  const CTD = { attribute: "SAMPLE_CLASS", plasma: ["cfDNA"], tissue: ["Tumor"], plasmaPanels: [] as string[], withinDays: null as number | null, sampleEvents: ["Sequencing"], sampleKey: "SAMPLE_ID" };
  const BY = { attribute: "SAMPLE_TYPE", a: ["Primary"], b: ["Metastasis"] };
  const plainOnes: [string, () => string][] = [
    ["pairedCountsSql genes driver", () => pairedCountsSql(C, "x", "db", ["TP53"], BY, "v7.5", "driver")],
    ["pairedCountsSql scan any", () => pairedCountsSql(C, "x", "db", null, BY, null, "any")],
    ["pairedPatientsSql", () => pairedPatientsSql(C, "x", "db", BY)],
    ["ctdnaCountsSql", () => ctdnaCountsSql(C, "x", "db", ["EGFR"], CTD, "v7.5", "driver")],
    ["ctdnaCountsSql scan, dated, CH", () => ctdnaCountsSql(C, "x", "db", null, { ...CTD, withinDays: 90, ch: { genes: ["DNMT3A"], normalMinAlt: 2, normalMinRatio: 0.3 } }, null, "any")],
    ["ctdnaFunnelSql", () => ctdnaFunnelSql(C, "x", "db", CTD, "v7.5", "driver")],
    ["ctdnaSurvivalSql", () => ctdnaSurvivalSql(C, "x", "db", { ...CTD, withinDays: 30 }, null, "any")],
    ["ctdnaChRemovedSql", () => ctdnaChRemovedSql(C, "x", "db", { ...CTD, ch: { genes: ["DNMT3A"], normalMinAlt: 2, normalMinRatio: 0.3 } })],
  ];
  for (const [what, f] of plainOnes) test(what + " stays plain", () => assertPlain(f(), what));
  for (const includeX of [false, true]) {
    test("instabilityArmsSql (includeX " + includeX + ") has no materialized form, even handed a true", () => {
      const o = { threshold: 0.2, armShare: 0.5, includeX };
      assertPlain(instabilityArmsSql(C, "x", "db", o), "instabilityArmsSql");
      const loose = instabilityArmsSql as unknown as (...a: unknown[]) => string;
      assertPlain(loose(C, "x", "db", o, true), "instabilityArmsSql handed true");
      assert.equal(loose(C, "x", "db", o, true), instabilityArmsSql(C, "x", "db", o));
    });
  }
});

// ---------------------------------------------------------------------------------------------
// V4 the runners, through a hand-made participant that records each statement's opts
// ---------------------------------------------------------------------------------------------
interface Asked { label: string; opts: unknown; sql: string }
/** a participant whose viewAggregate builds with materialized = opts.materialize === true, as a supporting connection would */
function participant(asked: Asked[]) {
  return {
    instance: { id: "s1", mode: "patient-level", label: "s1", conn: PRIMARY },
    async viewAggregate(label: string, _def: unknown, build: (c: string, s: string, d: string, m: boolean) => string, opts?: { materialize?: boolean }) {
      asked.push({ label, opts, sql: build("SELECT 's1_P1' AS pid", "s1", "db", opts?.materialize === true) });
      if (label.startsWith("instability:coverage")) return [{ samples: 1, segmented: 1 }];
      return [];
    },
    async viewMeta(label: string, build: (s: string, d: string) => string) { build("s1", "db"); return label === "instability:build" ? [{ build: "hg19" }] : []; },
    async survivalCounts() { return []; },
    async survivalEndpoints() { return ["OS"]; },
  };
}
const cohort: EvaluatedCohort = { studies: ["s1"], perStudy: { s1: { sql: "", count: 5, samples: 5, mode: "patient-level" } }, count: 5, samples: 5, text: "" } as EvaluatedCohort;
function ctx(asked: Asked[]): ViewRun {
  return {
    doc: { study: "s1", cohorts: { A: { name: "A" } }, views: [] } as never,
    cohorts: { A: cohort }, resolvers: { s1: participant(asked) } as never, vNames: ["A"], vStudies: ["s1"],
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: "v7.5", studyProfiles: async () => ({ profiles: ["mutations", "cna", "structural_variants"], gaProfiles: [] }),
  };
}
type Runner = (view: never, c: ViewRun) => Promise<ViewResult>;
const RUNS: { what: string; run: Runner; view: Record<string, unknown>; materialized: string[]; plain: string[] }[] = [
  { what: "acquired, genes", run: runAcquired as Runner, view: { kind: "acquired", genes: ["TP53"], anchor: { eventType: "Treatment" } },
    materialized: ["acquired:funnel:A", "acquired:genes:A"], plain: [] },
  { what: "acquired, scan, driver", run: runAcquired as Runner, view: { kind: "acquired", measure: "driver", anchor: { eventType: "Treatment", key: "SUBTYPE", value: "Hormone" } },
    materialized: ["acquired:funnel:A", "acquired:genes:A"], plain: [] },
  { what: "cancertypes", run: runCancertypes as Runner, view: { kind: "cancertypes", genes: ["KRAS"], groupBy: "SEX" }, materialized: ["cancertypes:A"], plain: [] },
  { what: "cancertypes, OQL, patients", run: runCancertypes as Runner, view: { kind: "cancertypes", oql: ["KRAS: MUT"], groupBy: "CANCER_TYPE", unit: "patient" },
    materialized: ["cancertypes:A"], plain: [] },
  ...(["ttnt", "tot", "rwpfs"] as const).map((endpoint) => ({ what: "txendpoints " + endpoint, run: runTxendpoints as Runner,
    view: { kind: "txendpoints", endpoint, anchor: { eventType: "Treatment" } }, materialized: ["txendpoints:" + endpoint + ":A"], plain: [] })),
  { what: "rmst from a treatment anchor", run: runRmst as Runner, view: { kind: "rmst", anchor: { eventType: "Treatment" } }, materialized: ["rmst:anchor:A"], plain: [] },
  { what: "instability", run: runInstability as Runner, view: { kind: "instability" }, materialized: ["instability:scores:A"], plain: ["instability:arms:A"] },
];

describe("V4 runners ask for a materialized statement where it pays", () => {
  for (const r of RUNS) {
    test(r.what + ": " + r.materialized.join(", ") + " with { materialize: true }" + (r.plain.length ? "; " + r.plain.join(", ") + " without" : ""), async () => {
      const asked: Asked[] = [];
      await r.run(r.view as never, ctx(asked));
      for (const label of r.materialized) {
        const a = asked.filter((x) => x.label === label);
        assert.equal(a.length, 1, label + " was asked once; asked: " + asked.map((x) => x.label).join(", "));
        assert.deepEqual(a[0].opts, { materialize: true }, label);
        assert.match(a[0].sql, / AS MATERIALIZED \(/, label + " built its statement with what it was handed");
        assert.ok(a[0].sql.endsWith(SETTING), label + " ends with the setting");
      }
      for (const label of r.plain) {
        const a = asked.filter((x) => x.label === label);
        assert.equal(a.length, 1, label + " was asked once");
        assert.notEqual((a[0].opts as { materialize?: boolean } | undefined)?.materialize, true, label + " does not ask to be materialized");
        assertPlain(a[0].sql, label);
      }
    });
  }
  test("rmst without an anchor runs no txendpoint statement", async () => {
    const asked: Asked[] = [];
    await runRmst({ kind: "rmst" } as never, ctx(asked));
    assert.deepEqual(asked.filter((a) => a.label.startsWith("rmst:anchor")), []);
  });
});
