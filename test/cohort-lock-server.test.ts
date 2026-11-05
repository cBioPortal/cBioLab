// Locking cohorts (lib/cohort-lock-server.ts; docs/dsl.md, "Locked cohorts"): what each definition
// selects now, kept as ONE sample-level stored set per cohort, with each split arm's samples as a
// named part, when it was taken and against which data and OncoKB release — every cohort asked for
// at one moment. Patient-level studies only: a lock lists samples.
//
// The stored sets are in the in-process Postgres (test/support/postgres.ts); the warehouse is a
// stand-in (setChTransport) holding two studies on two instances, "a" patient-level and "b"
// aggregate-only, answering a cohort's member queries by the SEX values its SQL names.
import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "cbio_a";
process.env.CLICKHOUSE2_URL = "http://secondary.invalid";
process.env.CLICKHOUSE2_DB = "cbio_b";
process.env.AGGREGATE_ONLY_INSTANCES = "b";
for (const k of ["AGGREGATE_ONLY_STUDIES", "FEDERATION_PEERS", "LOOPBACK_PEER", "VERCEL_ENV", "ONCOKB_PIN"]) delete process.env[k];

const { startPostgres } = await import("./support/postgres.ts");
const { setChTransport } = await import("../lib/ch.ts");
const { userForEmail } = await import("../lib/users.ts");
const { readIdSet } = await import("../lib/id-set-store.ts");
const { lockCohorts } = await import("../lib/cohort-lock-server.ts");

const db = await startPostgres();

/** each study's instance, patients, their SEX and samples */
const WAREHOUSE: Record<string, { conn: string; patients: Record<string, { sex: string; samples: string[] }> }> = {
  s_a: { conn: "a", patients: { P1: { sex: "Female", samples: ["P1-T"] }, P2: { sex: "Female", samples: ["P2-T", "P2-M"] }, P3: { sex: "Male", samples: ["P3-T"] } } },
  s_c: { conn: "a", patients: { C1: { sex: "Female", samples: ["C1-T"] } } },
  s_b: { conn: "b", patients: { Q1: { sex: "Female", samples: ["Q1-T"] } } },
};

let sent: { conn: string; query: string }[] = [];
const oncokbVersion: string | null = "v-from-warehouse";
const json = (data: unknown[]) => JSON.stringify({ data, meta: [], rows: data.length });
setChTransport(async (st) => {
  const q = st.query;
  sent.push({ conn: st.conn.id, query: q });
  const studies = Object.entries(WAREHOUSE).filter(([, s]) => s.conn === st.conn.id);
  if (/FROM \w+\.cancer_study\n/.test(q)) return json(studies.map(([id]) => ({ id, name: id })));
  if (/oncokb_version FROM/.test(q)) return json(oncokbVersion ? [{ oncokb_version: oncokbVersion }] : []);
  const study = studies.find(([id]) => q.includes("'" + id + "'"));
  const sex = /attribute_name = 'SEX' AND [^\n]*'(Female|Male)'/.exec(q)?.[1];
  const members = study ? Object.entries(study[1].patients).filter(([, x]) => !sex || x.sex === sex) : [];
  if (/^SELECT DISTINCT sid FROM/.test(q)) return json(members.flatMap(([, x]) => x.samples.map((sid) => ({ sid }))));
  if (/^SELECT DISTINCT pid FROM/.test(q)) return json(members.map(([pid]) => ({ pid })));
  return json([]);
});
after(() => setChTransport(null));

let alice: { id: string };
before(async () => { alice = await userForEmail("alice@lock.test"); });
beforeEach(() => { sent = []; process.env.ONCOKB_PIN = "v-test"; });

const female = { all: [{ kind: "clinical", attribute: "SEX", values: ["Female"] }] };
const male = { all: [{ kind: "clinical", attribute: "SEX", values: ["Male"] }] };
const doc = (cohorts: Record<string, unknown>, study = "s_a") => ({ study, cohorts, views: [] });
const dv = async () => "data-v1";
const setCount = async () => Number((await db.query<{ n: number }>("select count(*)::int as n from id_set")).rows[0].n);

describe("what can be locked", () => {
  test("a document with no cohorts is refused", async () => {
    for (const d of [null, "x", { study: "s_a" }, { study: "s_a", cohorts: "F" }])
      await assert.rejects(lockCohorts(alice.id, { doc: d }, dv), /doc must be an analysis document with cohorts/);
  });

  test("cohorts, when given, name at least one of the document's cohorts; an unknown one is named with those there are", async () => {
    await assert.rejects(lockCohorts(alice.id, { doc: doc({ F: female }), cohorts: [] }, dv), /cohorts must name at least one/);
    await assert.rejects(lockCohorts(alice.id, { doc: doc({ F: female }), cohorts: "F" }, dv), /cohorts must name at least one/);
    await assert.rejects(lockCohorts(alice.id, { doc: doc({ F: female, M: male }), cohorts: ["G", "H"] }, dv), /no cohort “G”, “H” to lock; have F, M/);
  });

  test("a cohort over an aggregate-only study is refused: a lock lists patients", async () => {
    const before = await setCount();
    await assert.rejects(lockCohorts(alice.id, { doc: doc({ F: female }, "s_b") }, dv), /is not entitled to patient-level data \(s_b\)/);
    assert.equal(await setCount(), before, "nothing saved");
    assert.ok(!sent.some((s) => s.conn === "b" && /^SELECT DISTINCT (pid|sid) FROM/.test(s.query)), "no member list was asked of instance b");
  });
});

describe("a lock", () => {
  test("keeps the cohort's samples as one sample-level set of the principal's, with its patients, time, data version and pin", async () => {
    const t0 = Date.now();
    const r = await lockCohorts(alice.id, { doc: doc({ F: female }) }, dv);
    assert.deepEqual(Object.keys(r.locks), ["F"]);
    const lock = r.locks.F;
    assert.equal(lock.n, 3, "P1-T, P2-T, P2-M");
    assert.equal(lock.nPatients, 2);
    assert.equal(lock.dataVersion, "data-v1");
    assert.equal(lock.oncokbPin, "v-test");
    assert.equal(lock.at, r.at);
    assert.ok(Date.parse(r.at) >= t0 - 1000 && Date.parse(r.at) <= Date.now() + 1000);
    assert.equal(r.dataVersion, "data-v1");
    assert.equal(r.oncokbPin, "v-test");
    assert.equal(lock.children, undefined, "no split, no children");
    const stored = await readIdSet(alice.id, lock.set);
    assert.deepEqual(stored.perStudy, { s_a: ["P1-T", "P2-M", "P2-T"] });
    assert.equal(stored.meta.level, "sample");
    assert.equal(stored.meta.owner, alice.id);
    assert.match(stored.meta.name, /^F — locked /);
    assert.equal((stored.meta.source as { lockOf?: { cohort: string; dataVersion: string } }).lockOf?.cohort, "F");
    assert.equal((stored.meta.source as { lockOf?: { dataVersion: string } }).lockOf?.dataVersion, "data-v1");
  });

  test("every cohort when none are named, all at one moment and one data version", async () => {
    let asked = 0;
    const r = await lockCohorts(alice.id, { doc: doc({ F: female, M: male }) }, async () => { asked++; return "data-v2"; });
    assert.deepEqual(Object.keys(r.locks).sort(), ["F", "M"]);
    assert.equal(r.locks.F.at, r.locks.M.at);
    assert.equal(r.locks.F.dataVersion, "data-v2");
    assert.equal(r.locks.M.dataVersion, "data-v2");
    assert.equal(asked, 1, "the data version is read once for the whole lock");
    assert.notEqual(r.locks.F.set, r.locks.M.set, "one set per cohort");
    assert.deepEqual((await readIdSet(alice.id, r.locks.M.set)).perStudy, { s_a: ["P3-T"] });
  });

  test("only the cohorts named; the others are left as they are", async () => {
    const before = await setCount();
    const r = await lockCohorts(alice.id, { doc: doc({ F: female, M: male }), cohorts: ["M"] }, dv);
    assert.deepEqual(Object.keys(r.locks), ["M"]);
    assert.equal(await setCount(), before + 1);
  });

  test("a cohort already locked is locked again from its definition, not from its last lock", async () => {
    const first = await lockCohorts(alice.id, { doc: doc({ F: female }) }, dv);
    sent = [];
    const again = await lockCohorts(alice.id, { doc: doc({ F: { ...female, lock: first.locks.F } }) }, dv);
    assert.ok(!sent.some((s) => s.query.includes("_idset_")), "no statement read the earlier lock's set");
    assert.notEqual(again.locks.F.set, first.locks.F.set);
    assert.equal(again.locks.F.n, 3);
  });

  test("a cohort that selects nobody is still locked: an empty lock is a fact", async () => {
    const nobody = { all: [{ kind: "clinical", attribute: "SEX", values: ["Male"] }] };
    const r = await lockCohorts(alice.id, { doc: doc({ N: nobody }, "s_c") }, dv);
    assert.equal(r.locks.N.n, 0);
    assert.equal(r.locks.N.nPatients, 0);
  });

  test("with no ONCOKB_PIN, the pin is the warehouse's OncoKB release, or null when it has none", async () => {
    delete process.env.ONCOKB_PIN;
    const r = await lockCohorts(alice.id, { doc: doc({ F: female }) }, dv);
    assert.equal(r.oncokbPin, "v-from-warehouse");
    assert.equal(r.locks.F.oncokbPin, "v-from-warehouse");
  });

  test("a cohort over two studies keeps each study's samples", async () => {
    const both = { ...female, studies: ["s_a", "s_c"] };
    const r = await lockCohorts(alice.id, { doc: doc({ F: both }) }, dv);
    assert.equal(r.locks.F.n, 4);
    assert.equal(r.locks.F.nPatients, 3);
    assert.deepEqual((await readIdSet(alice.id, r.locks.F.set)).perStudy, { s_a: ["P1-T", "P2-M", "P2-T"], s_c: ["C1-T"] });
  });

  test("a split cohort's arms are kept as parts of the same set, and named under children", async () => {
    const all = { all: [], splits: { sex: { arms: [{ name: "Female", where: { kind: "clinical", attribute: "SEX", values: ["Female"] } }] } } };
    const r = await lockCohorts(alice.id, { doc: doc({ All: all }) }, dv);
    const lock = r.locks.All;
    assert.ok(lock.children, "the arms are named");
    assert.ok(lock.children!["sex / Female"], Object.keys(lock.children!).join(", "));
    const arm = lock.children!["sex / Female"];
    assert.equal(arm.set, lock.set, "an arm is a part of its cohort's one set");
    assert.equal(arm.part, "arm:sex / Female");
    const stored = await readIdSet(alice.id, lock.set);
    assert.ok(stored.parts?.["arm:sex / Female"], "the arm's samples are stored as its part");
    assert.equal(arm.n, Object.values(stored.parts!["arm:sex / Female"]).reduce((n, x) => n + x.length, 0));
    assert.equal(lock.n, 4, "the whole cohort is every sample");
  });
});
