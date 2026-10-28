// An oncoprint over a federation peer's study: the peer answers its share (oncoprint-columns), and
// the contract draws its patients as columns beside this instance's — only where both sides allow
// the `oncoprint` kind, and never for a cohort carrying an id list.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as federation from "../lib/federation.ts";
import { RemoteAggregateResolver, RemotePatientResolver, RemoteTimelineResolver } from "../lib/federation-remote.ts";
import { buildContract, checkStudyInputs, type StudyInputs } from "../lib/oncoprint.ts";
import { cantDraw, type StudyAccess } from "../lib/view-coverage.ts";
import { PRIMARY } from "../lib/ch.ts";
import type { Instance } from "../lib/federation.ts";

const AGG: Instance = { id: "peer", mode: "aggregate-only", label: "test peer", conn: PRIMARY };
const URL_ = "http://peer.invalid/api/federation/v1";

const withEnv = async (env: Record<string, string | undefined>, fn: () => Promise<void> | void) => {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
  try { await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
};

/** fetch answered by `answer` for every call, recording what was asked */
const withFetch = async (answer: (op: string, body: Record<string, unknown>) => unknown, fn: (calls: { op: string; body: Record<string, unknown> }[]) => Promise<void>) => {
  const original = globalThis.fetch;
  const calls: { op: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const op = String(url).split("/").pop()!;
    const body = JSON.parse(String(init.body));
    calls.push({ op, body });
    return new Response(JSON.stringify(answer(op, body)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try { await fn(calls); } finally { globalThis.fetch = original; }
};

const SHARE: StudyInputs = {
  genes: ["TP53", "KRAS"],
  groups: [["P1", "P2", "P3"]],
  events: [["P1", "TP53", "mutation", "Missense_Mutation", "R175H", ""], ["P2", "KRAS", "cna", "", "", "2"]],
  coverage: [["P1", 3], ["P2", 3], ["P3", 1]],
  facts: [["P1", 1, 7], ["P2", 2, 7], ["P3", 1, 1]],
  clinical: [], heatmap: [], overlays: [], profileTypes: ["mutations"], assays: [],
};
const ENV = { FEDERATION_PEERS: "s1=" + URL_, FEDERATION_ACCEPT_PATIENT_LEVEL: "s1:oncoprint", ONCOKB_PIN: "test-pin" };
const SPEC = { study: "s1", genes: ["TP53", "KRAS"], display: { annotate: "none" } } as never;

describe("oncoprint columns from a federation peer", () => {
  test("a peer's share is drawn as the figure's columns, from one call that carries definitions, never SQL", async () => {
    await withEnv(ENV, () => withFetch(() => ({ study: "s1", ...SHARE, queries: [{ label: "oncoprint:columns", sql: "SELECT 1", ms: 3 }] }), async (calls) => {
      const log: { label: string; sql: string; study?: string; remote?: boolean }[] = [];
      const c = await buildContract(SPEC, { log });
      assert.deepEqual([...c.columns].sort(), ["P1", "P2", "P3"]);
      assert.equal(c.stats.nColumns, 3);
      const tp53 = c.tracks.find((t) => t.label === "TP53")!;
      assert.ok(tp53 && tp53.freqPct! > 0, "the peer's alteration counts in the gene's frequency");
      assert.deepEqual(calls.map((x) => x.op), ["oncoprint-columns"]);
      assert.equal(calls[0].body.study, "s1");
      assert.equal(calls[0].body.groups, null);
      assert.equal(JSON.stringify(calls[0].body).includes("SELECT"), false, "the peer is sent the spec, not compiled SQL");
      assert.ok(log.some((q) => q.remote && q.study === "s1"), "the peer's queries are logged as the peer's");
    }));
  });

  test("a group's cohort travels as its definition, and an id list in it is refused before the network is touched", async () => {
    const groups = (dsl: unknown) => ({ ...(SPEC as object), layout: { groupBy: { kind: "cohorts", groups: [{ name: "g", dsl }] } } }) as never;
    await withEnv(ENV, () => withFetch(() => ({ study: "s1", ...SHARE }), async (calls) => {
      await buildContract(groups({ study: "s1", all: [{ kind: "oql", q: "TP53: MUT" }] }));
      assert.deepEqual(calls[0].body.groups, [{ study: "s1", all: [{ kind: "oql", q: "TP53: MUT" }] }]);
      calls.length = 0;
      await assert.rejects(buildContract(groups({ study: "s1", all: [{ kind: "patientList", ids: ["P1"] }] })), /explicit sample or patient list/);
      assert.equal(calls.length, 0);
    }));
  });

  test("a peer this instance does not accept oncoprint columns from is refused by name, not drawn without its patients", async () => {
    await withEnv({ ...ENV, FEDERATION_ACCEPT_PATIENT_LEVEL: "s1:alterations" }, () => withFetch(() => ({}), async (calls) => {
      await assert.rejects(buildContract(SPEC), /does not share oncoprint columns of s1/);
      assert.equal(calls.length, 0);
    }));
  });

  test("a share for other genes, or one the checks cannot read, is refused", async () => {
    await withEnv(ENV, () => withFetch(() => ({ study: "s1", ...SHARE, genes: ["KRAS", "TP53"] }), async () => {
      await assert.rejects(buildContract(SPEC), /read a different oncoprint/);
    }));
    await withEnv(ENV, () => withFetch(() => ({ study: "other", ...SHARE }), async () => {
      await assert.rejects(buildContract(SPEC), /answered for other/);
    }));
    assert.throws(() => checkStudyInputs({ ...SHARE, groups: [] }, 1), /column groups/);
    assert.throws(() => checkStudyInputs({ ...SHARE, events: [["P1", "TP53"]] }, 1), /alterations/);
    assert.throws(() => checkStudyInputs({ ...SHARE, groups: [[1, 2]] }, 1), /column ids/);
  });

  test("the method is the object's own, only where the kind is accepted", () => {
    for (const C of [RemoteAggregateResolver, RemotePatientResolver, RemoteTimelineResolver])
      assert.equal(typeof (C.prototype as unknown as Record<string, unknown>).oncoprintInputs, "undefined");
    const without = new RemotePatientResolver("s", URL_, AGG, ["alterations", "plot"]);
    assert.equal(federation.sharesOncoprint(without), false);
    const sharing = new RemotePatientResolver("s", URL_, AGG, ["oncoprint"]);
    assert.ok(Object.prototype.hasOwnProperty.call(sharing, "oncoprintInputs"));
    assert.equal(federation.sharesOncoprint(sharing), true);
    assert.equal(federation.isPatientLevel(sharing), false, "sharing oncoprint columns makes it patient-level for nothing else");
  });

  test("a request that lists a peer study's patients any other way is refused by name", async () => {
    await withEnv(ENV, async () => {
      await assert.rejects(federation.patientLevelConn("s1", "a column's detail is one patient's data"), /held by .*a federation peer/);
    });
  });

  test("the view can be drawn over a peer that shares oncoprint columns, and says why not over one that does not", () => {
    const peer = (shares: string[]): StudyAccess => ({ instance: "GENIE (federated)", patientLevel: false, remote: true, shares });
    assert.equal(cantDraw("oncoprint", ["g"], () => peer(["oncoprint"])), null);
    assert.match(cantDraw("oncoprint", ["g"], () => peer(["timeline", "alterations", "plot"]))!, /does not share oncoprint columns with this instance/);
  });

  test("the peer serves the op only with disclosure rules, and only for studies they allow the kind for", async () => {
    const { answerFederation, federationOps } = await import("../lib/federation-api.ts");
    const ask = () => answerFederation("oncoprint-columns", { study: "rms_msk_2026", groups: null, genes: ["TP53"], clinical: [], heatmap: [], overlays: [], unit: "patient", lineGap: 90 });
    await withEnv({ FEDERATION_DISCLOSE_PATIENTS: undefined }, async () => {
      assert.equal(federationOps().has("oncoprint-columns"), false);
      assert.equal((await ask()).status, 404);
    });
    await withEnv({ FEDERATION_DISCLOSE_PATIENTS: "rms_msk_2026:timeline+alterations+plot" }, async () => {
      const r = await ask();
      assert.equal(r.status, 422);
      assert.match((r.body as { error: string }).error, /not a study this instance discloses oncoprint columns of/);
    });
    await withEnv({ FEDERATION_DISCLOSE_PATIENTS: "*:*" }, async () => {
      const r = await answerFederation("oncoprint-columns", { study: "rms_msk_2026", groups: [{ all: [{ kind: "patientList", ids: ["P1"] }] }], genes: ["TP53"],
        clinical: [], heatmap: [], overlays: [], unit: "patient", lineGap: 90 });
      assert.equal(r.status, 422);
      assert.match((r.body as { error: string }).error, /explicit sample or patient list/);
    });
  });
});
