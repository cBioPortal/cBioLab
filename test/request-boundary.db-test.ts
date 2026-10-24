// The request-boundary modules for stored id sets, on the in-process Postgres and a stand-in
// warehouse: reading the sets a request names (lib/id-sets-server.ts), saving a pasted list as one
// (lib/id-set-import.ts) and locking cohorts into them (lib/cohort-lock-server.ts). The stand-in
// answers every statement in place of ClickHouse (setChTransport) and records which connection each
// went to, with which tables riding along — so the tests see where patient ids are sent, not only
// what comes back.
//
// Two instances: "a" (patient-level) holds s_a, "b" holds s_b and is aggregate-only.
import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "cbio_a";
process.env.CLICKHOUSE2_URL = "http://secondary.invalid";
process.env.CLICKHOUSE2_DB = "cbio_b";
process.env.AGGREGATE_ONLY_INSTANCES = "b";
process.env.AUTH_DEV_LOGIN = "1";
process.env.AUTH_SESSION_SECRET = "request-boundary-test-secret-0123456789";
process.env.ONCOKB_PIN = "v-test";
for (const k of ["AGGREGATE_ONLY_STUDIES", "PEER_MCP_URL", "PEER_MCP_STUDIES", "LOOPBACK_PEER", "VERCEL_ENV"]) delete process.env[k];

const { startPostgres } = await import("./support/postgres.ts");
const { setChTransport } = await import("../lib/ch.ts");
const { userForEmail } = await import("../lib/users.ts");
const { sessionCookie, AccessError } = await import("../lib/auth.ts");
const { saveIdSet, readIdSet, ID_SET_MAX } = await import("../lib/id-set-store.ts");
const { idSetExternalsFor, idSetTableName } = await import("../lib/id-sets.ts");
const { withRequestIdSets, MAX_SETS_PER_REQUEST } = await import("../lib/id-sets-server.ts");
const { createIdSet } = await import("../lib/id-set-import.ts");
const { lockCohorts } = await import("../lib/cohort-lock-server.ts");

const db = await startPostgres();

/** what the stand-in warehouse holds: each study's patients, each patient's samples, and their SEX */
const WAREHOUSE: Record<string, { conn: string; patients: Record<string, { sex: string; samples: string[] }> }> = {
  s_a: { conn: "a", patients: { P1: { sex: "Female", samples: ["P1-T"] }, P2: { sex: "Female", samples: ["P2-T", "P2-M"] }, P3: { sex: "Male", samples: ["P3-T"] } } },
  s_b: { conn: "b", patients: { Q1: { sex: "Female", samples: ["Q1-T"] } } },
};

/** every statement the stand-in answered: its connection, its text, the external tables sent with it */
let sent: { conn: string; query: string; externals: string[] }[] = [];

const json = (data: unknown[]) => JSON.stringify({ data, meta: [], rows: data.length });
setChTransport(async (st) => {
  sent.push({ conn: st.conn.id, query: st.query, externals: st.externals.map((e) => e.name) });
  const q = st.query;
  const studies = Object.entries(WAREHOUSE).filter(([, s]) => s.conn === st.conn.id);
  if (/FROM \w+\.cancer_study\n/.test(q)) return json(studies.map(([id]) => ({ id, name: id })));
  // a pasted list matched against sample_derived (lib/custom-data-server.ts resolveCaseIds)
  if (/FROM \w+\.sample_derived\n/.test(q) && q.includes("_upload_ids")) {
    const ext = st.externals.find((e) => e.name === "_upload_ids")!;
    const wanted = new Set((await ext.blob.text()).split("\n").filter(Boolean));
    const bySample = q.includes("sample_stable_id IN");
    const rows = studies.flatMap(([id, s]) => Object.entries(s.patients).flatMap(([p, x]) =>
      x.samples.filter((smp) => wanted.has(bySample ? smp : p)).map((smp) => [id, p, smp]).slice(0, bySample ? undefined : 1)));
    return JSON.stringify({ data: rows, meta: [], rows: rows.length });
  }
  // a cohort's members (a clinical SEX clause), and their samples
  const study = studies.find(([id]) => q.includes("'" + id + "'"));
  const sex = /attribute_name = 'SEX' AND [^\n]*'(Female|Male)'/.exec(q)?.[1];
  const members = study ? Object.entries(study[1].patients).filter(([, x]) => !sex || x.sex === sex) : [];
  if (/^SELECT DISTINCT replaceOne\(sample_unique_id/.test(q)) return json(members.flatMap(([, x]) => x.samples.map((sid) => ({ sid }))));
  if (/^SELECT pid FROM/.test(q)) return json(members.map(([pid]) => ({ pid })));
  return json([]);
});

/** a request from `user` (signed in) or from nobody */
function request(user: { id: string; email: string } | null): Request {
  const url = "http://lab.test/api/analysis";
  if (!user) return new Request(url);
  const cookie = sessionCookie(new Request(url), { id: user.id, email: user.email, name: null }).split(";")[0];
  return new Request(url, { headers: { cookie } });
}

let alice: { id: string; email: string }, bob: { id: string; email: string };
before(async () => {
  alice = await userForEmail("alice@boundary.test");
  bob = await userForEmail("bob@boundary.test");
});
beforeEach(() => { sent = []; });

const source = { idsIn: 0, unmatched: 0, duplicates: 0, multiStudy: 0 };
const setCount = async () => Number((await db.query<{ n: number }>("select count(*)::int as n from id_set")).rows[0].n);

describe("withRequestIdSets: the sets a request names, read as its reader", () => {
  test("a request naming no set runs as it is, signed in or not", async () => {
    assert.equal(await withRequestIdSets({ cohorts: { A: { all: [] } } }, request(null), async () => "ran"), "ran");
  });

  test("a request naming too many sets is refused by the limit, before anything is read", async () => {
    const ids = Array.from({ length: MAX_SETS_PER_REQUEST + 1 }, (_, i) => "00000000-0000-4000-8000-" + String(i).padStart(12, "0"));
    const body = { cohorts: Object.fromEntries(ids.map((set, i) => ["C" + i, { all: [{ kind: "patientList", set }] }])) };
    await assert.rejects(withRequestIdSets(body, request(null), async () => "ran"), new RegExp("at most " + MAX_SETS_PER_REQUEST + " stored id sets"));
  });

  test("a set is not read without a signed-in reader", async () => {
    const s = await saveIdSet(alice.id, { name: "mine", level: "patient", perStudy: { s_a: ["P1"] }, source });
    const body = { cohorts: { A: { all: [{ kind: "patientList", set: s.id }] } } };
    await assert.rejects(withRequestIdSets(body, request(null), async () => "ran"), AccessError);
  });

  test("nor by someone it is not shared with, whose request then never runs", async () => {
    const s = await saveIdSet(alice.id, { name: "alice only", level: "patient", perStudy: { s_a: ["P1"] }, source });
    let ran = false;
    await assert.rejects(withRequestIdSets({ cohorts: { A: { all: [{ kind: "patientList", set: s.id }] } } }, request(bob),
      async () => { ran = true; }));
    assert.equal(ran, false);
  });

  test("a set's ids may go only to the patient-level instance that holds each study", async () => {
    // saved directly: a pasted list is matched to patient-level studies only (below), but a set
    // naming an aggregate-only study must still never send it there
    const s = await saveIdSet(alice.id, { name: "both", level: "patient", perStudy: { s_a: ["P1", "P2"], s_b: ["Q1"] }, source });
    const ta = idSetTableName(s.id, "s_a"), tb = idSetTableName(s.id, "s_b");
    await withRequestIdSets({ cohorts: { A: { all: [{ kind: "patientList", set: s.id }] } } }, request(alice), async () => {
      assert.deepEqual(idSetExternalsFor("SELECT 1 FROM " + ta, "a").map((t) => t.name), [ta]);
      // a statement naming a table that may not go where it is headed is refused, not sent without it
      assert.throws(() => idSetExternalsFor("SELECT 1 FROM " + tb, "a"), /holds patient-level ids for s_b, which cannot be sent to instance 'a'/);
      assert.throws(() => idSetExternalsFor("SELECT 1 FROM " + tb, "b"), /cannot be sent to instance 'b'/);
      assert.throws(() => idSetExternalsFor("SELECT 1 FROM " + ta, "b"), /cannot be sent to instance 'b'/);
    });
  });
});

describe("createIdSet: a pasted list saved as a set", () => {
  const input = (over: Record<string, unknown>) => ({ name: "pasted", level: "patient", studies: ["s_a"], ids: ["P1"], ...over });

  test("refuses a list it cannot read, before asking the warehouse", async () => {
    await assert.rejects(createIdSet(alice.id, input({ level: "case" })), /level must be 'patient' or 'sample'/);
    await assert.rejects(createIdSet(alice.id, input({ studies: [] })), /studies must name at least one study/);
    await assert.rejects(createIdSet(alice.id, input({ studies: [3] })), /studies must name at least one study/);
    await assert.rejects(createIdSet(alice.id, input({ ids: [] })), /ids must list at least one id/);
    await assert.rejects(createIdSet(alice.id, input({ ids: Array(ID_SET_MAX + 1).fill("P1") })), /holds at most 250,000 ids/);
    assert.deepEqual(sent, []);
  });

  test("keeps what matched, reports the rest, and asks only the patient-level instance", async () => {
    const r = await createIdSet(alice.id, input({ studies: ["s_a", "s_b"], ids: ["s_a:P1", "P2", "P2", "NOPE", "Q1", " "] }));
    const stored = await readIdSet(alice.id, r.set.id);
    assert.deepEqual(Object.keys(stored.perStudy), ["s_a"]);
    assert.deepEqual([...new Set(stored.perStudy.s_a)].sort(), ["P1", "P2"]);
    assert.equal(r.unmatched, 2, "NOPE, and Q1 (its study is aggregate-only, so it was never looked for)");
    assert.deepEqual(r.unmatchedExamples, ["NOPE", "Q1"]);
    assert.equal(r.duplicates, 1);
    assert.deepEqual(r.refused.map((x) => x.study), ["s_b"]);
    assert.match(r.refused[0].reason, /not entitled to patient-level data/);
    const lookups = sent.filter((s) => s.externals.includes("_upload_ids"));
    assert.deepEqual(lookups.map((s) => s.conn), ["a"], "the list went to instance a alone");
  });

  test("names at most 20 of the ids that matched nothing", async () => {
    const ids = ["P1", ...Array.from({ length: 30 }, (_, i) => "X" + i)];
    const r = await createIdSet(alice.id, input({ ids }));
    assert.equal(r.unmatched, 30);
    assert.deepEqual(r.unmatchedExamples, ids.slice(1, 21));
  });

  test("matches samples by sample id", async () => {
    const r = await createIdSet(alice.id, input({ level: "sample", ids: ["P2-M", "P3-T"] }));
    assert.deepEqual((await readIdSet(alice.id, r.set.id)).perStudy, { s_a: ["P2-M", "P3-T"] });
  });
});

describe("lockCohorts: what each cohort selects now, kept as a stored set", () => {
  const female = { all: [{ kind: "clinical", attribute: "SEX", values: ["Female"] }] };
  const doc = (cohorts: Record<string, unknown>) => ({ study: "s_a", cohorts, views: [] });
  const dv = async () => "data-v1";

  test("refuses what it cannot lock, saying what there is", async () => {
    await assert.rejects(lockCohorts(alice.id, { doc: { study: "s_a" } }, dv), /doc must be an analysis document with cohorts/);
    await assert.rejects(lockCohorts(alice.id, { doc: doc({ F: female }), cohorts: [] }, dv), /cohorts must name at least one/);
    await assert.rejects(lockCohorts(alice.id, { doc: doc({ F: female }), cohorts: ["G"] }, dv), /no cohort “G” to lock; have F/);
  });

  test("keeps the cohort's patients and their samples, with when and against what data", async () => {
    const before = await setCount();
    const r = await lockCohorts(alice.id, { doc: doc({ F: female, M: { all: [{ kind: "clinical", attribute: "SEX", values: ["Male"] }] } }), cohorts: ["F"] }, dv);
    assert.deepEqual(Object.keys(r.locks), ["F"], "only the cohort asked for");
    assert.equal(await setCount(), before + 1, "one set per locked cohort");
    const lock = r.locks.F;
    assert.deepEqual({ n: lock.n, nSamples: lock.nSamples, dataVersion: lock.dataVersion, oncokbPin: lock.oncokbPin, at: lock.at },
      { n: 2, nSamples: 3, dataVersion: "data-v1", oncokbPin: "v-test", at: r.at });
    const stored = await readIdSet(alice.id, lock.set);
    assert.deepEqual(stored.perStudy, { s_a: ["P1", "P2"] });
    assert.deepEqual(stored.parts?.samples, { s_a: ["P1-T", "P2-M", "P2-T"] });
    assert.equal(stored.meta.owner, alice.id);
  });

  test("a locked cohort is locked again from its definition, not from its last lock", async () => {
    const first = await lockCohorts(alice.id, { doc: doc({ F: female }) }, dv);
    sent = [];
    const again = await lockCohorts(alice.id, { doc: doc({ F: { ...female, lock: first.locks.F } }) }, dv);
    assert.ok(!sent.some((s) => s.query.includes("_idset_")), "no statement read the earlier lock's set");
    assert.notEqual(again.locks.F.set, first.locks.F.set);
    assert.equal(again.locks.F.n, 2);
  });

  test("refuses a cohort over an aggregate-only study: a lock lists patients", async () => {
    await assert.rejects(lockCohorts(alice.id, { doc: { study: "s_b", cohorts: { F: female }, views: [] } }, dv),
      /not entitled to patient-level data \(s_b\)/);
    assert.ok(!sent.some((s) => s.conn === "b" && /^SELECT pid FROM/.test(s.query)), "no member list was asked of instance b");
  });
});
