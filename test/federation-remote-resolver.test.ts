// The client half of federation (lib/federation-remote.ts), against a peer that is a stand-in fetch:
// what each resolver method sends (study-qualified, a definition never an id list, nothing sent when
// it would carry ids), how it reads the answer, and how it refuses an answer that is not the one it
// asked for — a peer is another program, so its answers are checked, never trusted.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { RemoteAggregateResolver, RemotePatientResolver, RemoteTimelineResolver, federationPeers, peerForStudy, peerPatientKinds, remoteFacets,
  remoteProfiles, remoteStudies } from "../lib/federation-remote.ts";
import { PRIMARY } from "../lib/ch.ts";
import type { Instance, PlotRequest } from "../lib/federation.ts";
import type { PatientKind } from "../lib/disclosure.ts";

const URL_ = "http://peer.invalid/api/federation/v1";
const INST: Instance = { id: "peer", mode: "aggregate-only", label: "test peer", conn: PRIMARY };
const ID_LIST = { all: [{ kind: "patientList", ids: ["P1"] }] } as never;
const OQL = { all: [{ kind: "oql", q: "TP53: MUT" }] } as never;
const SPEC: PlotRequest = { x: { source: "clinical", attribute: "AGE" }, y: { source: "clinical", attribute: "SEX" }, unit: "patient" };

// the federation log writes a line per call; keep the test output readable
const realLog = console.log;
before(() => { console.log = () => {}; });
after(() => { console.log = realLog; });

const withEnv = async (env: Record<string, string | undefined>, fn: () => Promise<void> | void) => {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
  try { await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
};

type Call = { url: string; op: string; body: Record<string, unknown> };
/** fetch answered by `answer` (a body, or a [status, body] pair), recording every call */
const withPeer = async (answer: (op: string, body: Record<string, unknown>, url: string) => unknown, fn: (calls: Call[]) => Promise<void>) => {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const op = String(url).split("/").pop()!;
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(url), op, body });
    const a = answer(op, body, String(url));
    const [status, payload] = Array.isArray(a) && typeof a[0] === "number" ? a as [number, unknown] : [200, a];
    return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try { await fn(calls); } finally { globalThis.fetch = original; }
};

const AGG_ANSWER = { study: "s1", instance: "peer", count: 7, samples: 9, geneCounts: [], survivalCounts: [], pairCounts: [], attributeStats: [], pairMoments: [],
  variantCounts: { variants: [], totals: [], minCount: 1 }, profileMoments: [], oncokbPin: null };

describe("the remote aggregate resolver: what it asks, and how it reads the answer", () => {
  test("each aggregate is one `aggregates` call for its own study, and returns that part of the answer", async () => {
    const answer = { ...AGG_ANSWER,
      timelineSpan: [{ eventType: "TREATMENT", patients: 3, events: 5, days: 10, firstDay: 0, lastDay: 9, intervalEvents: 2 }],
      treatmentSequence: [{ step: 1, from: "A", to: "B", n: 2, fate: 0 }],
      sequenceKeys: [{ key: "AGENT", label: "Agent", patients: 3, values: 4 }],
      eventCourse: [{ bin: 0, eventType: "TREATMENT", n: 3 }],
      pairCounts: [{ a: "TP53", b: "KRAS", both: 1, onlyA: 2, onlyB: 3, profiled: 10, neither: 4 }],
      attributeStats: [{ attribute: "SEX", per: "patient", kind: "cat", values: [{ v: "F", n: 4 }] }],
      profileMoments: [{ gene: "TP53", n: 3, sum: 1, sumsq: 2 }],
      pairMoments: [{ a: "TP53", b: "KRAS", n: 3, sx: 1, sy: 1, sxy: 1, sxx: 1, syy: 1 }],
      variantCounts: { variants: [{ gene: "TP53", variant: "R175H", type: "Missense", pos: 175, n: 3 }], totals: [], minCount: 2 },
      lollipopCounts: { changes: [], types: [], totals: [], cohortSamples: 9, minCount: 2, annotated: false },
      survivalEndpoints: ["OS", "PFS"] };
    await withPeer(() => answer, async (calls) => {
      const r = new RemoteAggregateResolver("s1", URL_, INST);
      assert.deepEqual(await r.timelineSpan(OQL), answer.timelineSpan);
      assert.deepEqual(await r.treatmentSequence(OQL, { eventType: "TREATMENT", labelKey: "AGENT", exclude: [], lineGap: 90, maxSteps: 3 }), answer.treatmentSequence);
      assert.deepEqual(await r.sequenceKeys(OQL, "TREATMENT"), answer.sequenceKeys);
      assert.deepEqual(await r.eventCourse(OQL, { anchor: null, eventTypes: ["TREATMENT"], binMonths: 3, from: 0, to: 12 }), answer.eventCourse);
      assert.deepEqual(await r.pairCounts(OQL, [["TP53", "KRAS"]]), answer.pairCounts);
      assert.deepEqual(await r.attributeStats(OQL, ["SEX"], { histograms: true, topValues: 5 }), answer.attributeStats);
      assert.deepEqual(await r.profileMoments(OQL, ["TP53"], "mrna"), answer.profileMoments);
      assert.deepEqual(await r.pairMoments(OQL, [["TP53", "KRAS"]], "mrna"), answer.pairMoments);
      assert.deepEqual(await r.variantCounts(OQL, ["TP53"], 2), answer.variantCounts);
      assert.deepEqual(await r.lollipopCounts(OQL, ["TP53"], 2), answer.lollipopCounts);
      assert.deepEqual(await r.survivalEndpoints(), ["OS", "PFS"]);
      assert.ok(calls.every((c) => c.op === "aggregates" && c.body.study === "s1"));
      const bodies = calls.map((c) => c.body);
      assert.deepEqual(bodies[0], { study: "s1", cohort: OQL, timelineSpan: true });
      assert.deepEqual(bodies[3].course, { anchor: null, eventTypes: ["TREATMENT"], binMonths: 3, from: 0, to: 12 });
      assert.equal(bodies[2].sequenceKeys, "TREATMENT");
      assert.deepEqual(bodies[5], { study: "s1", cohort: OQL, attributes: ["SEX"], attributeHistograms: true, attributeTopValues: 5 });
      assert.deepEqual(bodies[6], { study: "s1", cohort: OQL, momentGenes: ["TP53"], profileType: "mrna" });
      assert.deepEqual(bodies[8], { study: "s1", cohort: OQL, variantGenes: ["TP53"], minCount: 2 });
      assert.deepEqual(bodies[9], { study: "s1", cohort: OQL, lollipopGenes: ["TP53"], minCount: 2 });
      assert.deepEqual(bodies[10], { study: "s1", cohort: {}, survivalEndpoints: true });
    });
  });

  test("an answer missing a part reads as empty, never as undefined", async () => {
    await withPeer(() => ({ study: "s1", count: 1, samples: 1, oncokbPin: null }), async () => {
      const r = new RemoteAggregateResolver("s1", URL_, INST);
      assert.deepEqual(await r.timelineSpan(null), []);
      assert.deepEqual(await r.treatmentSequence(null, { eventType: "T", labelKey: "AGENT", exclude: [], lineGap: 90, maxSteps: 3 }), []);
      assert.deepEqual(await r.sequenceKeys(null, "T"), []);
      assert.deepEqual(await r.eventCourse(null, { anchor: null, eventTypes: ["T"], binMonths: 3, from: 0, to: 12 }), []);
      assert.deepEqual(await r.pairCounts(null, [["A", "B"]]), []);
      assert.deepEqual(await r.attributeStats(null, ["SEX"]), []);
      assert.deepEqual(await r.profileMoments(null, ["A"], "mrna"), []);
      assert.deepEqual(await r.pairMoments(null, [["A", "B"]], "mrna"), []);
      assert.deepEqual(await r.variantCounts(null, ["A"], 3), { variants: [], totals: [], minCount: 3 });
      assert.deepEqual(await r.survivalEndpoints(), []);
    });
  });

  test("nothing to ask is answered here, without a call", async () => {
    await withPeer(() => { throw new Error("no call expected"); }, async (calls) => {
      const r = new RemoteAggregateResolver("s1", URL_, INST);
      assert.deepEqual(await r.geneCounts(null, []), []);
      assert.deepEqual(await r.pairCounts(null, []), []);
      assert.deepEqual(await r.attributeStats(null, []), []);
      assert.deepEqual(await r.profileMoments(null, [], "mrna"), []);
      assert.deepEqual(await r.profileMoments(null, ["A"], ""), []);
      assert.deepEqual(await r.pairMoments(null, [], "mrna"), []);
      assert.deepEqual(await r.pairMoments(null, [["A", "B"]], ""), []);
      assert.deepEqual(await r.variantCounts(null, [], 4), { variants: [], totals: [], minCount: 4 });
      assert.deepEqual(await r.lollipopCounts(null, [], 4), { changes: [], types: [], totals: [], cohortSamples: 0, minCount: 4, annotated: false });
      assert.equal(calls.length, 0);
    });
  });

  test("a peer that cannot say its survival endpoints offers none, rather than failing the view", async () => {
    await withPeer(() => [500, { error: "down" }], async () => {
      assert.deepEqual(await new RemoteAggregateResolver("s1", URL_, INST).survivalEndpoints(), []);
    });
  });

  test("a peer on an older build is refused by name, not guessed at", async () => {
    await withPeer(() => ({ study: "s1", count: 4, oncokbPin: null }), async () => {
      const r = new RemoteAggregateResolver("s1", URL_, INST);
      await assert.rejects(r.sizes(null), /does not report a cohort's samples .*update that instance/);
      await assert.rejects(r.lollipopCounts(null, ["TP53"]), /does not report per-codon lollipop counts .*update that instance/);
    });
  });

  test("a percentile cutoff is refused against a peer study, without a call", async () => {
    await withPeer(() => ({}), async (calls) => {
      const r = new RemoteAggregateResolver("s1", URL_, INST);
      await assert.rejects(r.attributeQuantile(null, "AGE", 0.5), /percentile-based cutoff is not supported against s1 yet/);
      await assert.rejects(r.attributeQuantile(ID_LIST, "AGE", 0.5), /explicit sample or patient list/);
      assert.equal(calls.length, 0);
    });
  });

  test("every method refuses an id-carrying cohort before the network is touched", async () => {
    await withPeer(() => AGG_ANSWER, async (calls) => {
      const r = new RemoteAggregateResolver("s1", URL_, INST);
      const asks: (() => Promise<unknown>)[] = [
        () => r.count(ID_LIST), () => r.geneCounts(ID_LIST, ["TP53"]), () => r.survivalCounts(ID_LIST),
        () => r.timelineSpan(ID_LIST), () => r.treatmentSequence(ID_LIST, {} as never), () => r.sequenceKeys(ID_LIST, "T"),
        () => r.eventCourse(ID_LIST, {} as never), () => r.pairCounts(ID_LIST, [["A", "B"]]), () => r.attributeStats(ID_LIST, ["SEX"]),
        () => r.profileMoments(ID_LIST, ["A"], "mrna"), () => r.variantCounts(ID_LIST, ["A"]), () => r.lollipopCounts(ID_LIST, ["A"]),
        () => r.pairMoments(ID_LIST, [["A", "B"]], "mrna"),
        () => r.plot(ID_LIST, SPEC), () => r.plotExtent(ID_LIST, SPEC, "num", "num"),
        () => r.plotHighlightCount(OQL, ID_LIST), () => r.plotHighlightBins(OQL, ID_LIST, SPEC, "num", "num", [2, 2], { x0: 0, x1: 1, y0: 0, y1: 1 }),
      ];
      for (const ask of asks) await assert.rejects(ask(), /explicit sample or patient list, which is not sent to remote peer test peer/);
      assert.equal(calls.length, 0);
    });
  });
});

describe("a federated plot over a peer: the `plot` op", () => {
  const EXT = { x0: 0, x1: 10, y0: 0, y1: 5 };
  test("each piece is one call naming its op, carrying only the plot's axes, unit and grid", async () => {
    await withPeer((_op, body) => ({ op: body.op, result: { piece: body.op }, cohortSql: null, queries: null }), async (calls) => {
      const r = new RemoteAggregateResolver("s1", URL_, INST);
      const spec = { ...SPEC, bins: [10, 5] as [number, number], colorBy: { source: "clinical", attribute: "STAGE" }, ringBy: { source: "clinical", attribute: "GRADE" },
        somethingElse: "dropped" } as PlotRequest;
      const results = [
        await r.plot(OQL, spec), await r.plotAxisKinds(spec), await r.plotExtent(OQL, spec, "num", "num"),
        await r.plotBinCounts(OQL, spec, "num", "num", [10, 5], EXT), await r.plotMoments(OQL, spec, "num", "num"),
        await r.plotTableCells(OQL, spec, "cat", "cat"), await r.plotBoxRows(OQL, spec, "num", "cat"),
        await r.plotViolinCounts(OQL, spec, "num", "cat", 20, [0, 10]), await r.plotCoverage(OQL, spec, "num", "cat"),
        await r.plotHighlightCount(OQL, OQL), await r.plotHighlightBins(OQL, OQL, spec, "num", "num", [10, 5], EXT),
        await r.plotHighlightBoxRows(OQL, OQL, spec, "num", "cat"),
      ];
      const ops = ["plot", "axisKinds", "extent", "bins", "moments", "table", "box", "violin", "coverage", "highlightCount", "highlightBins", "highlightBox"];
      assert.deepEqual(results, ops.map((op) => ({ piece: op })));
      assert.deepEqual(calls.map((c) => c.body.op), ops);
      assert.ok(calls.every((c) => c.op === "plot" && c.body.study === "s1"));
      assert.deepEqual(calls[0].body.spec, { x: spec.x, y: spec.y, unit: "patient", colorBy: spec.colorBy, ringBy: spec.ringBy, bins: [10, 5] });
      assert.deepEqual(calls[1].body.cohort, {}, "the axes alone decide their kinds: no cohort");
      assert.deepEqual(calls[3].body.kinds, { xk: "num", yk: "num" });
      assert.deepEqual([calls[3].body.bins, calls[3].body.extent], [[10, 5], EXT]);
      assert.deepEqual([calls[7].body.violinBins, calls[7].body.range], [20, [0, 10]]);
      assert.deepEqual(calls[9].body.highlight, OQL);
      assert.deepEqual(calls[9].body.spec, { x: { source: "none" }, y: { source: "none" } });
    });
  });

  test("an answer for another op than asked is refused, naming both", async () => {
    await withPeer(() => ({ op: "moments", result: {} }), async () => {
      await assert.rejects(new RemoteAggregateResolver("s1", URL_, INST).plotExtent(OQL, SPEC, "num", "num"),
        /the peer serving s1 answered 'moments' when asked for 'extent'/);
    });
  });
});

describe("provenance from a peer", () => {
  test("before it answers: where it is, and that it ran remotely without disclosing its SQL", () => {
    const r = new RemoteAggregateResolver("s1", URL_, INST);
    assert.deepEqual(r.provenance(), { url: URL_, reported: null, answeredAt: null });
    const sql = String(r.cohortSql());
    assert.match(sql, /evaluated remotely by test peer \(http:\/\/peer\.invalid/);
    assert.match(sql, /the peer did not disclose its SQL/);
  });

  test("after: its first self-report is kept, its SQL shown as run BY THE PEER, its queries marked remote", async () => {
    let n = 0;
    await withPeer(() => ({ ...AGG_ANSWER, cohortSql: "SELECT peer_sql", queries: [{ label: "sizes", sql: "SELECT 1", ms: 4 }],
      source: { name: "peer-db-" + (++n), build: "b" } }), async () => {
      const r = new RemoteAggregateResolver("s1", URL_, INST);
      assert.deepEqual(await r.sizes(OQL), { patients: 7, samples: 9 });
      await r.sizes(OQL);
      const p = r.provenance();
      assert.deepEqual(p.reported, { name: "peer-db-1", build: "b" }, "the first report, not a later one");
      assert.ok(p.answeredAt && !Number.isNaN(Date.parse(p.answeredAt)));
      assert.match(String(r.cohortSql()), /compiled and run BY THE PEER[^\n]*\nSELECT peer_sql$/);
      assert.deepEqual(r.queries[0], { label: "sizes", sql: "SELECT 1", ms: 4, remote: true });
      assert.equal(r.queries.length, 2);
    });
  });

  test("a blank SQL from the peer does not replace what it disclosed before", async () => {
    let sql = "SELECT first";
    await withPeer(() => ({ ...AGG_ANSWER, cohortSql: sql }), async () => {
      const r = new RemoteAggregateResolver("s1", URL_, INST);
      await r.count(null);
      sql = "   ";
      await r.count(null);
      assert.match(String(r.cohortSql()), /SELECT first$/);
    });
  });
});

describe("the peer call", () => {
  test("a refusal without an error body is reported by status and op; a non-JSON or empty success is refused", async () => {
    await withPeer(() => [502, "<html>bad gateway</html>"], async () => {
      await assert.rejects(remoteProfiles("s1", URL_), /peer rejected: HTTP 502 for profiles/);
    });
    await withPeer(() => "not json", async () => {
      await assert.rejects(remoteProfiles("s1", URL_), /peer returned no result for profiles/);
    });
    await withPeer(() => "", async () => {
      await assert.rejects(remoteProfiles("s1", URL_), /peer returned no result for profiles/);
    });
  });

  test("a trailing slash on the peer's address does not change where the call goes", async () => {
    await withPeer(() => ({ study: "s1" }), async (calls) => {
      await remoteProfiles("s1", URL_ + "///");
      assert.equal(calls[0].url, URL_ + "/profiles");
    });
  });
});

describe("study-level calls", () => {
  test("profiles: the peer's description of the study it was asked about, defaults for what it leaves out", async () => {
    await withPeer(() => ({ study: "s1", profiles: ["mutations"] }), async (calls) => {
      assert.deepEqual(await remoteProfiles("s1", URL_), { profiles: ["mutations"], gaProfiles: [], catalog: [] });
      assert.deepEqual(calls[0].body, { study: "s1" });
    });
    await withPeer(() => ({ study: "s2", profiles: [] }), async () => {
      await assert.rejects(remoteProfiles("s1", URL_), /peer answered the profiles of 's2' for 's1'/);
    });
  });

  test("facets: the draft travels as its definition, each study row is badged as the peer's, and an id list never leaves", async () => {
    await withPeer(() => ({ studyBreakdown: [{ study: "s1", n: 3 }], attributes: [] }), async (calls) => {
      const r = await remoteFacets("s1", URL_, OQL, "GENIE peer", "TP");
      assert.deepEqual(calls[0].body, { study: "s1", draft: OQL, geneSearch: "TP" });
      assert.deepEqual(r.studyBreakdown, [{ study: "s1", n: 3, instance: "peer", instanceLabel: "GENIE peer" }]);
      calls.length = 0;
      await assert.rejects(remoteFacets("s1", URL_, ID_LIST, "GENIE peer"), /draft contains an explicit sample or patient list, which is not sent to remote peer GENIE peer/);
      assert.equal(calls.length, 0);
    });
    await withPeer(() => ({}), async (calls) => {
      const r = await remoteFacets("s1", URL_, undefined, "p");
      assert.equal(calls[0].body.draft, null);
      assert.deepEqual(r.studyBreakdown, []);
    });
  });
});

describe("which peer holds a study (FEDERATION_PEERS)", () => {
  test("STUDY=URL pairs, separated by commas or spaces; the first mapping of a study wins and malformed entries are ignored", async () => {
    await withEnv({ FEDERATION_PEERS: "s1=http://a/v1, s2=http://b/v1  s1=http://c/v1 junk =http://d s3=", PEER_LABEL: undefined, LOOPBACK_PEER: undefined }, async () => {
      assert.deepEqual([...federationPeers()], [["s1", "http://a/v1"], ["s2", "http://b/v1"]]);
      assert.deepEqual(await peerForStudy("s1"), { url: "http://a/v1", label: "federated peer" });
      assert.equal(await peerForStudy("elsewhere"), null);
    });
    await withEnv({ FEDERATION_PEERS: "s1=http://a/v1", PEER_LABEL: "GENIE" }, async () => {
      assert.deepEqual(await peerForStudy("s1"), { url: "http://a/v1", label: "GENIE" });
    });
  });

  test("the kinds this instance accepts from a study's peer come from its own FEDERATION_ACCEPT_PATIENT_LEVEL rules", async () => {
    await withEnv({ FEDERATION_ACCEPT_PATIENT_LEVEL: "s1:timeline+plot, *:alterations" }, () => {
      assert.deepEqual([...peerPatientKinds("s1")].sort(), ["alterations", "plot", "timeline"]);
      assert.deepEqual([...peerPatientKinds("s2")], ["alterations"]);
    });
    await withEnv({ FEDERATION_ACCEPT_PATIENT_LEVEL: undefined }, () => {
      assert.equal(peerPatientKinds("s1").size, 0);
    });
  });

  test("the study list keeps only the studies routed to each peer, asks each peer once, and reports one that fails", async () => {
    await withEnv({ FEDERATION_PEERS: "s1=http://a/v1,s2=http://a/v1,s9=http://down/v1", PEER_LABEL: "P", LOOPBACK_PEER: undefined }, () =>
      withPeer((_op, _b, url) => url.startsWith("http://down") ? [503, { error: "down" }]
        : { studies: [{ id: "s1", name: "S1" }, { id: "s2", name: "S2" }, { id: "s3", name: "not routed here" }] }, async (calls) => {
        const { rows, failed } = await remoteStudies();
        assert.deepEqual(rows.map((r) => r.id).sort(), ["s1", "s2"], "a peer cannot add a study this instance did not route to it");
        assert.ok(rows.every((r) => r.instance === "peer" && r.instanceLabel === "P"));
        assert.deepEqual(failed, ["http://down/v1"]);
        assert.equal(calls.filter((c) => c.url === "http://a/v1/studies").length, 1);
      }));
  });
});

describe("the patient-level peer (opt-in kinds)", () => {
  const resolver = (kinds: PatientKind[]) => new RemotePatientResolver("s1", URL_, INST, kinds);

  test("plot cases exist on the object only where `plot` is accepted, and each is one `plot-cases` call", async () => {
    assert.equal((resolver(["timeline"]) as unknown as Record<string, unknown>).plotPoints, undefined);
    await withPeer((_op, body) => ({ op: body.op, points: [{ id: "P1", op: body.op }], queries: [{ label: "points", sql: "SELECT p", ms: 1 }] }), async (calls) => {
      const r = resolver(["plot"]) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      const ws = [{ g: "F", loWhisker: 1, hiWhisker: 2 }];
      const sparse = { grid: [10, 10], extent: { x0: 0, x1: 1, y0: 0, y1: 1 }, cellMax: 3 };
      await r.plotPoints(OQL, SPEC, 100);
      await r.plotPoints(OQL, SPEC);
      await r.plotOutlierPoints(OQL, SPEC, 50, ws);
      await r.plotScatterPoints(OQL, SPEC, 100, sparse);
      await r.plotScatterPoints(OQL, SPEC);
      await r.plotRankedPoints(OQL, SPEC, "num", "num", { by: "x", n: 5 });
      assert.deepEqual(await r.plotHighlightPoints(OQL, OQL, SPEC, "num", "cat", 10), [{ id: "P1", op: "highlightPoints" }]);
      assert.ok(calls.every((c) => c.op === "plot-cases" && c.body.study === "s1"));
      const b = calls.map((c) => c.body);
      assert.deepEqual(b.map((x) => x.op), ["points", "points", "outliers", "scatterPoints", "scatterPoints", "ranked", "highlightPoints"]);
      assert.equal(b[0].cap, 100);
      assert.equal("cap" in b[1], false, "no cap asked: the peer's own cap applies");
      assert.deepEqual([b[2].cap, b[2].outside], [50, ws]);
      assert.deepEqual(b[3].sparse, sparse);
      assert.deepEqual(b[5], { study: "s1", cohort: OQL, op: "ranked", spec: { x: SPEC.x, y: SPEC.y, unit: "patient" }, kinds: { xk: "num", yk: "num" }, rank: { by: "x", n: 5 } });
      assert.deepEqual([b[6].highlight, b[6].cap], [OQL, 10]);
      assert.ok((r as unknown as RemotePatientResolver).queries.every((q) => q.remote === true));
    });
  });

  test("a plot-cases answer for another op is refused; an id list in either cohort never leaves", async () => {
    await withPeer(() => ({ op: "points", points: [] }), async (calls) => {
      const r = resolver(["plot"]) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      await assert.rejects(r.plotOutlierPoints(OQL, SPEC, 5, []), /answered 'points' when asked for 'outliers'/);
      calls.length = 0;
      await assert.rejects(r.plotPoints(ID_LIST, SPEC), /explicit sample or patient list, which is not sent to remote peer/);
      await assert.rejects(r.plotHighlightPoints(OQL, ID_LIST, SPEC, "num", "cat"), /explicit sample or patient list/);
      assert.equal(calls.length, 0);
    });
  });

  test("a peer's refusal is said in terms of the setting that decides it", async () => {
    const r = resolver(["plot"]) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    await withPeer(() => [404, { error: "no federation op 'plot-cases' here" }], async () => {
      await assert.rejects(r.plotPoints(OQL, SPEC), /does not share patient-level data \(it has not set FEDERATION_DISCLOSE_PATIENTS\), though this instance's FEDERATION_ACCEPT_PATIENT_LEVEL accepts plot cases/);
    });
    await withPeer(() => [422, { error: "s1 is not a study this instance discloses plot cases of" }], async () => {
      await assert.rejects(r.plotPoints(OQL, SPEC), /the peer serving s1 does not share plot cases of s1 \(its FEDERATION_DISCLOSE_PATIENTS does not allow it\)/);
    });
    await withPeer(() => [422, { error: "something else entirely" }], async () => {
      await assert.rejects(r.plotPoints(OQL, SPEC), /peer rejected: something else entirely/);
    });
  });

  test("oncoprint columns are refused before any call when the kind is not accepted", async () => {
    await withPeer(() => ({}), async (calls) => {
      await assert.rejects(resolver(["plot"]).oncoprintCall({ groups: null } as never), /does not accept oncoprint columns from the peer serving s1/);
      assert.equal(calls.length, 0);
    });
  });
});

describe("patient rows from a peer", () => {
  const ROWS_REQ = { table: "timeline" as const, parts: [{ cohort: "A", def: OQL }], query: {}, defaults: ["patient"], mode: "page" as const };

  test("only the rows of the asked study and cohorts are kept, whatever else the peer sends", async () => {
    await withPeer(() => ({ table: "timeline", rows: [{ study: "s1", cohort: "A", patient: "P1" }, { study: "s2", cohort: "A", patient: "X" }, { study: "s1", cohort: "B", patient: "Y" }],
      counts: [{ study: "s1", cohort: "A", n: 1, all: 2 }, { study: "s1", cohort: "Z", n: 9, all: 9 }], rank: 3, oncokbPin: "v".repeat(60),
      queries: [{ label: "page", sql: "SELECT", ms: 2 }] }), async (calls) => {
      const r = new RemotePatientResolver("s1", URL_, INST, ["timeline"]);
      const out = await r.patientRows({ ...ROWS_REQ, limit: 10, offset: 20, column: "age", patient: "P1", oncokbPin: "v7", samples: "patient" } as never);
      assert.deepEqual(out.rows, [{ study: "s1", cohort: "A", patient: "P1" }]);
      assert.deepEqual(out.counts, [{ study: "s1", cohort: "A", n: 1, all: 2 }]);
      assert.equal(out.rank, 3);
      assert.equal(out.oncokbPin, "v".repeat(40));
      assert.deepEqual(out.values, []);
      const b = calls[0].body;
      assert.deepEqual(b.parts, [{ cohort: "A", cohortDef: OQL }]);
      assert.deepEqual([b.limit, b.offset, b.column, b.patient, b.oncokbPin, b.source], [10, 20, "age", "P1", "v7", "test peer"]);
      assert.equal("samples" in b, false, "every sample of a patient is the default; only `cohort` is sent");
      assert.equal(r.queries.at(-1)!.remote, true);
    });
  });

  test("a table of one patient's keeps that patient's rows only; a rank that is not a place is none", async () => {
    await withPeer(() => ({ table: "alterations:samples", samples: "cohort", rows: [{ study: "s1", cohort: "A", patient: "P1" }, { study: "s1", cohort: "A", patient: "P2" }], rank: -1 }), async (calls) => {
      const r = new RemotePatientResolver("s1", URL_, INST, ["alterations"]);
      const out = await r.patientRows({ table: "alterations:samples", parts: [{ cohort: "A", def: null }], query: {}, defaults: [], mode: "page",
        subject: { patient: "P1" }, samples: "cohort" } as never);
      assert.deepEqual(out.rows!.map((x) => x.patient), ["P1"]);
      assert.equal(out.rank, null);
      assert.equal(out.oncokbPin, null);
      assert.deepEqual(calls[0].body.parts, [{ cohort: "A", cohortDef: {} }]);
      assert.equal(calls[0].body.samples, "cohort");
    });
  });

  test("a peer that predates named tables or the cohort-only setting is refused, not shown", async () => {
    await withPeer(() => ({ rows: [] }), async () => {
      const r = new RemotePatientResolver("s1", URL_, INST, ["alterations"]);
      await assert.rejects(r.patientRows({ ...ROWS_REQ, table: "alterations" } as never), /answered with timeline rows when asked for alterations; it predates sharing patient alterations/);
    });
    await withPeer(() => ({ table: "alterations", samples: "patient", rows: [] }), async () => {
      const r = new RemotePatientResolver("s1", URL_, INST, ["alterations"]);
      await assert.rejects(r.patientRows({ ...ROWS_REQ, table: "alterations", samples: "cohort" } as never), /did not limit alterations to the cohort's samples/);
    });
  });

  test("an unknown table, a kind not accepted, or an id list is refused before any call", async () => {
    await withPeer(() => ({}), async (calls) => {
      const r = new RemotePatientResolver("s1", URL_, INST, ["timeline"]);
      await assert.rejects(r.patientRows({ ...ROWS_REQ, table: "secrets" } as never), /not a table a peer serves: secrets/);
      await assert.rejects(r.patientRows({ ...ROWS_REQ, table: "alterations:mutations" } as never), /does not accept patient alterations from the peer serving s1/);
      await assert.rejects(r.patientRows({ ...ROWS_REQ, parts: [{ cohort: "A", def: ID_LIST }] } as never), /explicit sample or patient list/);
      assert.equal(calls.length, 0);
    });
  });
});

describe("one patient's timeline from a peer", () => {
  test("events are read field by field: attributes kept as string pairs, an unreadable end is open", async () => {
    await withPeer(() => ({ study: "s1", patient: "P1",
      events: [{ type: "TREATMENT", start: "5", end: "x", attrs: [["AGENT", "drug"], ["bad"], "nope", ["N", 3]] }, { type: "STATUS", start: 9, end: 12 }],
      samples: [{ id: "S1", type: "Primary" }, { id: "S2" }], queries: [{ label: "t", sql: "S", ms: 1 }] }), async (calls) => {
      const r = new RemoteTimelineResolver("s1", URL_, INST, ["timeline"]);
      const t = await r.patientTimeline("P1");
      assert.deepEqual(calls[0].body, { study: "s1", patient: "P1" });
      assert.deepEqual(t.events, [
        { type: "TREATMENT", start: 5, end: null, attrs: [["AGENT", "drug"], ["N", "3"]] },
        { type: "STATUS", start: 9, end: 12, attrs: [] }]);
      assert.deepEqual(t.samples, [{ id: "S1", type: "Primary" }, { id: "S2", type: "" }]);
      assert.deepEqual(t.source, { label: "test peer", remote: true });
      assert.equal(r.queries[0].remote, true);
    });
  });

  test("an event it cannot read, or an answer about someone else, is refused", async () => {
    await withPeer(() => ({ study: "s1", patient: "P1", events: [{ type: "X", start: "never" }], samples: [] }), async () => {
      await assert.rejects(new RemoteTimelineResolver("s1", URL_, INST, ["timeline"]).patientTimeline("P1"), /peer sent a timeline event this instance cannot read/);
    });
    await withPeer(() => ({ study: "s1", patient: "P2", events: [], samples: [] }), async () => {
      await assert.rejects(new RemoteTimelineResolver("s1", URL_, INST, ["timeline"]).patientTimeline("P1"), /peer answered for s1\/P2, not s1\/P1/);
    });
    await withPeer(() => ({ study: "s1", patient: "P1" }), async () => {
      const t = await new RemoteTimelineResolver("s1", URL_, INST, ["timeline"]).patientTimeline("P1");
      assert.deepEqual([t.events, t.samples], [[], []]);
    });
  });

  test("not asked at all where timelines are not accepted", async () => {
    await withPeer(() => ({}), async (calls) => {
      await assert.rejects(new RemoteTimelineResolver("s1", URL_, INST, ["alterations"]).patientTimeline("P1"), /does not accept patient timelines from the peer serving s1/);
      assert.equal(calls.length, 0);
    });
  });
});
