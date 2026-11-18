// Explore's light mode at the route (app/api/explore/route.ts) and in the results page's hook
// (app/portal/study-known.ts useQueryKnown). Written from the rule's case table, not from the
// implementation:
//
//   E4c a request over one locally held study with attributesOnly true is answered light; false or
//       absent, in full
//   E4d a request over several studies answers the full explore, the flag ignored: two local studies,
//       and a local study with one a remote peer holds
//   E4e a request over a study a remote peer holds answers the peer's full facets, and the flag does
//       not travel to the peer
//   E5a the hook asks /api/explore with attributesOnly: true
//   E5b the StudyKnown it builds from the light answer equals the one from the full answer: profiles,
//       gaProfiles, profileCatalog, clinical (most covered first; facets tying on coverage compared
//       as a set, since their order is arbitrary even in the full explore), attrs (as a set, for the
//       same reason), patients, samples, sequenced
//
// The route is driven whole, through its POST handler, with the committed fixture study
// (test/fixtures/peer-study) as the primary warehouse: CLICKHOUSE_* are pointed where CLICKHOUSE2_*
// say the fixture is (`npm run peer-db` prints the lines; scripts/gate.sh sets them), and the file is
// skipped without them. A remote peer is a stand-in answering its federation API through fetch.
// `next/cache` exists only under Next, so a loader hook stands in for it (as in next-cache.test.ts).
// The hook runs in react-dom's real client renderer over a stand-in container (no DOM is drawn: its
// component renders nothing), with /api/explore answered by the route itself.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const STUB = "export function cacheLife() {}\nexport function cacheTag() {}\n";
const HOOK = "export async function resolve(s, c, next) { if (s === 'next/cache') return { url: " +
  JSON.stringify("data:text/javascript," + encodeURIComponent(STUB)) + ", shortCircuit: true }; return next(s, c); }\n";
register("data:text/javascript," + encodeURIComponent(HOOK));

const FIXTURE = "cbiolab_peer_fixture";
const REMOTE = "remote_stub_study";
const PEER = "http://peer.invalid/api/federation/v1/";
const noDb = process.env.CLICKHOUSE2_LABEL === "fixture peer" ? false : "needs the fixture study: CLICKHOUSE2_* from `npm run peer-db`";
if (!noDb) {
  process.env.CLICKHOUSE_URL = process.env.CLICKHOUSE2_URL;
  process.env.CLICKHOUSE_USER = process.env.CLICKHOUSE2_USER;
  process.env.CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE2_PASSWORD;
  process.env.CLICKHOUSE_DB = process.env.CLICKHOUSE2_DB;
  process.env.RESULT_CACHE = "off";
  process.env.FEDERATION_PEERS = REMOTE + "=" + PEER;
}
for (const k of ["CLICKHOUSE2_URL", "CLICKHOUSE2_USER", "CLICKHOUSE2_PASSWORD", "CLICKHOUSE2_DB", "CLICKHOUSE2_LABEL",
  "CH_RUN_CACHE", "LOOPBACK_PEER", "AGGREGATE_ONLY_INSTANCES", "AGGREGATE_ONLY_STUDIES"]) delete process.env[k];

type Row = Record<string, any>;
/** the remote peer's facets for its study: a full answer, with a value list */
const PEER_FACETS = {
  study: REMOTE, draftCount: null, studyBreakdown: [{ study: REMOTE, n: 7 }],
  clinical: [{ attribute: "SEX", per: "patient", kind: "cat", patients: 7, samples: 7, distinct: 1, values: [{ v: "Female", n: 7 }], na: 0 }],
  derived: [], declaredAttributes: [], events: [{ type: "TREATMENT", n: 3 }], caseLists: [{ id: "all", name: "All", n: 7 }],
  mutatedGenes: [], cnaGenes: [], svGenes: [], geneTotals: { mutated: 0, cna: 0, sv: 0 }, geneFacets: [],
  totals: { patients: 7, samples: 7 }, dataTypes: [], profiles: [], gaProfiles: [], stats: { ms: 0 },
};
/** what each call to the peer carried, by op */
const peerCalls: { op: string; body: Row }[] = [];
/** every statement the route sent, for the request in flight */
let sent: string[] = [];

let POST: (req: Request) => Promise<Response>;
const realFetch = globalThis.fetch;
before(async () => {
  if (noDb) return;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith(PEER)) {
      const op = u.slice(PEER.length), body = JSON.parse(String(init?.body || "{}"));
      peerCalls.push({ op, body });
      const answer = op === "facets" ? PEER_FACETS : op === "profiles" ? { profiles: [], gaProfiles: [], catalog: [] } : {};
      return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(url, init);
  }) as typeof fetch;
  const { setChTransport } = await import("../lib/ch.ts");
  setChTransport(async (st, send) => { sent.push(st.query); return send(); });
  ({ POST } = await import("../app/api/explore/route.ts"));
});
after(async () => {
  globalThis.fetch = realFetch;
  if (!noDb) (await import("../lib/ch.ts")).setChTransport(null);
});

async function explore(body: Row): Promise<{ j: Row; sent: string[] }> {
  sent = [];
  const r = await POST(new Request("http://app.invalid/api/explore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const j = await r.json();
  assert.equal(r.status, 200, "the route answered: " + JSON.stringify(j).slice(0, 300));
  return { j, sent };
}
/** the value-list statement: each attribute's values folded to a key and counted */
const sendsValueLists = (sent: string[]) => sent.some((q) => /\bvkey\b/.test(q));
/** light: no value lists, case lists, events or gene tables (explore-attributes-only.test.ts holds the rest) */
function isLight(j: Row): boolean {
  const cat = (j.clinical as Row[]).filter((f) => f.kind === "cat");
  return cat.length > 0 && cat.every((f) => !f.values?.length) && !j.caseLists.length && !j.events.length && !j.mutatedGenes.length;
}
const fixtureFacet = (j: Row, attr: string) => (j.clinical as Row[]).find((f) => f.attribute === attr);

describe("E4 the route", () => {
  test("E4c one local study: attributesOnly true is answered light", { skip: noDb }, async () => {
    const { j, sent } = await explore({ study: FIXTURE, attributesOnly: true });
    assert.ok(isLight(j), "light: " + JSON.stringify(j.clinical.slice(0, 2)));
    assert.equal(sendsValueLists(sent), false, "no value-list statement is sent");
  });
  for (const flag of [false, undefined]) {
    test("E4c one local study: attributesOnly " + flag + " is answered in full", { skip: noDb }, async () => {
      const { j, sent } = await explore({ study: FIXTURE, ...(flag === undefined ? {} : { attributesOnly: flag }) });
      assert.ok(fixtureFacet(j, "SEX")?.values.length > 0, "SEX has its value list");
      assert.ok(j.caseLists.length > 0 && j.mutatedGenes.length > 0 && j.events.length > 0, "case lists, gene tables, events");
      assert.ok(sendsValueLists(sent), "the value-list statement is sent");
    });
  }
  test("E4c a non-boolean attributesOnly is refused with 400, naming the field", { skip: noDb }, async () => {
    const r = await POST(new Request("http://app.invalid/api/explore", { method: "POST", body: JSON.stringify({ study: FIXTURE, attributesOnly: "yes" }) }));
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /attributesOnly/);
  });
  test("E4d several local studies: the full explore, the flag ignored", { skip: noDb }, async () => {
    // the fixture is the only study on the warehouse: named twice, it is two studies to the route
    const { j, sent } = await explore({ studies: [FIXTURE, FIXTURE], attributesOnly: true });
    assert.ok(fixtureFacet(j, "SEX")?.values.length > 0, "SEX has its value list");
    assert.ok(j.caseLists.length > 0 && j.mutatedGenes.length > 0, "case lists and gene tables");
    assert.ok(sendsValueLists(sent), "the value-list statement is sent");
  });
  test("E4d a local study with one a remote peer holds: the full explore, the flag ignored", { skip: noDb }, async () => {
    peerCalls.length = 0;
    const { j, sent } = await explore({ studies: [FIXTURE, REMOTE], attributesOnly: true });
    assert.ok(peerCalls.some((c) => c.op === "facets"), "the peer was asked for its facets");
    const sex = fixtureFacet(j, "SEX");
    assert.ok(sex && sex.values.some((v: Row) => v.v === "Male"), "the local study's SEX values are in the answer: " + JSON.stringify(sex?.values));
    assert.ok(j.mutatedGenes.length > 0, "the local study's gene tables are in the answer");
    assert.ok(sendsValueLists(sent), "the local study's value-list statement is sent");
  });
  test("E4e a study a remote peer holds: the peer's full facets, and the flag does not travel", { skip: noDb }, async () => {
    peerCalls.length = 0;
    const { j } = await explore({ study: REMOTE, attributesOnly: true });
    const facets = peerCalls.filter((c) => c.op === "facets");
    assert.equal(facets.length, 1);
    assert.equal("attributesOnly" in facets[0].body, false, "the peer was not asked for light facets: " + JSON.stringify(facets[0].body));
    assert.deepEqual(j.clinical, PEER_FACETS.clinical);
    assert.deepEqual(j.events, PEER_FACETS.events);
    assert.deepEqual(j.caseLists, PEER_FACETS.caseLists);
  });
});

// ---- E5: the results page's hook -----------------------------------------------------------------

type Known = import("../app/portal/study-known.ts").StudyKnown;
/** Runs useQueryKnown for the fixture until it settles, with /api/explore answered by the route (`full`: the flag stripped first). */
async function runHook(filters: unknown[], full: boolean): Promise<{ known: Known | null; error: string | null; bodies: Row[] }> {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { useQueryKnown } = await import("../app/portal/study-known.ts");
  const bodies: Row[] = [];
  const inner = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/explore") {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      const { attributesOnly, ...rest } = body;
      return POST(new Request("http://app.invalid/api/explore", { method: "POST", body: JSON.stringify(full ? rest : { ...rest, attributesOnly }) }));
    }
    if (u === "/api/studies") return Response.json({ studies: [{ id: FIXTURE, name: "Fixture", caps: { mut: true, cna: true, sv: true }, oncokb: true }] });
    if (u.startsWith("/api/")) return Response.json({}); // sign-in state and uploaded datasets: none
    return inner(url, init);
  }) as typeof fetch;
  // a stand-in container: the component draws nothing, so react-dom touches only these
  const noop = () => {};
  const doc: Row = { nodeType: 9, addEventListener: noop, removeEventListener: noop, activeElement: null };
  const win: Row = { document: doc, HTMLIFrameElement: class {}, event: undefined };
  const container: Row = { nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: doc,
    addEventListener: noop, removeEventListener: noop, childNodes: [], firstChild: null, removeChild: noop, appendChild: noop };
  Object.assign(doc, { documentElement: container, defaultView: win });
  const g = globalThis as Row;
  const hadWindow = "window" in g, oldWindow = g.window;
  g.window = win;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  let out: { known: Known | null; error: string | null } = { known: null, error: null };
  function Probe() { out = useQueryKnown([FIXTURE], filters as never); return null; }
  const root = createRoot(container as never);
  try {
    await React.act(async () => { root.render(React.createElement(Probe)); });
    for (let i = 0; i < 300 && !out.known && !out.error; i++)
      await React.act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    await React.act(async () => { root.unmount(); });
  } finally {
    globalThis.fetch = inner;
    if (hadWindow) g.window = oldWindow; else delete g.window;
  }
  return { ...out, bodies };
}

/** clinical, most covered first, with each run of facets tying on coverage taken as a set */
function coverageRuns(k: Known, j: Row[]): string[][] {
  const cov = new Map<string, number>();
  for (const f of j) cov.set(f.attribute, Math.max(cov.get(f.attribute) ?? 0, f.patients || 0));
  const runs: string[][] = [];
  let last: number | null = null;
  for (const a of k.clinical) {
    const n = cov.get(a) ?? -1;
    if (n !== last) runs.push([]);
    runs.at(-1)!.push(a);
    last = n;
  }
  return runs.map((r) => r.sort());
}
const attrKey = (a: Known["attrs"][number]) => (a.per || "") + "|" + a.attribute;

const HOOK_FILTERS: [string, unknown[]][] = [
  ["the whole study", []],
  ["a clinical filter", [{ kind: "clinical", attribute: "SEX", values: ["Female"] }]],
];
for (const [name, filters] of HOOK_FILTERS) {
  describe("E5 the results page's hook, " + name, () => {
    let light: Awaited<ReturnType<typeof runHook>>, full: Awaited<ReturnType<typeof runHook>>;
    let lightJ: Row, fullJ: Row;
    before(async () => {
      if (noDb) return;
      light = await runHook(filters, false);
      full = await runHook(filters, true);
      assert.equal(light.error, null);
      assert.equal(full.error, null);
      assert.ok(light.known && full.known, "the hook settled");
      // what the hook read, to group ties by coverage
      const scope = { study: FIXTURE, draft: filters.length ? { study: FIXTURE, all: filters } : null };
      lightJ = (await explore({ ...scope, attributesOnly: true })).j;
      fullJ = (await explore(scope)).j;
    });
    test("E5a it asks /api/explore with attributesOnly: true", { skip: noDb }, () => {
      assert.equal(light.bodies.length, 1);
      assert.equal(light.bodies[0].attributesOnly, true);
      assert.equal(light.bodies[0].study, FIXTURE);
      assert.deepEqual(light.bodies[0].draft, filters.length ? { study: FIXTURE, all: filters } : null);
    });
    test("E5b the StudyKnown from the light answer equals the one from the full answer", { skip: noDb }, () => {
      const l = light.known!, f = full.known!;
      assert.ok(isLight(lightJ), "the light answer is light, so the comparison says something");
      assert.deepEqual(l.profiles, f.profiles, "profiles");
      assert.deepEqual(l.gaProfiles, f.gaProfiles, "gaProfiles");
      assert.deepEqual(l.profileCatalog, f.profileCatalog, "profileCatalog");
      assert.ok(f.profileCatalog.length > 0, "the fixture describes its profiles");
      assert.deepEqual(coverageRuns(l, lightJ.clinical), coverageRuns(f, fullJ.clinical), "clinical, most covered first");
      assert.ok(f.clinical.length > 5, "the fixture has clinical attributes");
      assert.deepEqual(l.attrs.slice().sort((a, b) => attrKey(a).localeCompare(attrKey(b))), f.attrs.slice().sort((a, b) => attrKey(a).localeCompare(attrKey(b))), "attrs");
      assert.equal(l.patients, f.patients, "patients");
      assert.equal(l.samples, f.samples, "samples");
      assert.equal(l.sequenced, f.sequenced, "sequenced");
      assert.ok((f.sequenced ?? 0) > 0, "the fixture has a mutation profile");
      for (const k of ["name", "names", "held", "noDrivers", "portal"] as const) assert.deepEqual(l[k], f[k], k);
    });
  });
}
