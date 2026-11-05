// Saving a pasted list of sample or patient ids as a stored set (lib/id-set-import.ts): each id is
// "<study>:<id>" or bare (looked up in every study given), matched to the studies' own cases first
// so a set never names a case that is not there, and only cases of patient-level studies kept. What
// did not match, what was given twice, what matched in several studies and which studies were not
// matched against are all reported — never silently dropped from the count.
//
// The stored sets are in the in-process Postgres (test/support/postgres.ts); the warehouse is a
// stand-in (setChTransport): instance "a" (patient-level) holds s_a and s_c, "b" (aggregate-only) s_b.
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "cbio_a";
process.env.CLICKHOUSE2_URL = "http://secondary.invalid";
process.env.CLICKHOUSE2_DB = "cbio_b";
process.env.AGGREGATE_ONLY_INSTANCES = "b";
for (const k of ["AGGREGATE_ONLY_STUDIES", "FEDERATION_PEERS", "LOOPBACK_PEER", "VERCEL_ENV"]) delete process.env[k];

const { startPostgres } = await import("./support/postgres.ts");
const { setChTransport } = await import("../lib/ch.ts");
const { userForEmail } = await import("../lib/users.ts");
const { readIdSet, ID_SET_MAX } = await import("../lib/id-set-store.ts");
const { createIdSet } = await import("../lib/id-set-import.ts");

await startPostgres();

const WAREHOUSE: Record<string, { conn: string; patients: Record<string, string[]> }> = {
  s_a: { conn: "a", patients: { P1: ["P1-T"], P2: ["P2-T", "P2-M"], SHARED: ["SHARED-A"] } },
  s_c: { conn: "a", patients: { C1: ["C1-T"], SHARED: ["SHARED-C"] } },
  s_b: { conn: "b", patients: { Q1: ["Q1-T"] } },
};

let sent: { conn: string; query: string; externals: string[] }[] = [];
const json = (data: unknown[]) => JSON.stringify({ data, meta: [], rows: data.length });
setChTransport(async (st) => {
  const q = st.query;
  sent.push({ conn: st.conn.id, query: q, externals: st.externals.map((e) => e.name) });
  const studies = Object.entries(WAREHOUSE).filter(([, s]) => s.conn === st.conn.id);
  if (/FROM \w+\.cancer_study\n/.test(q)) return json(studies.map(([id]) => ({ id, name: id })));
  if (/FROM \w+\.sample_derived\n/.test(q) && q.includes("_upload_ids")) {
    const wanted = new Set((await st.externals.find((e) => e.name === "_upload_ids")!.blob.text()).split("\n").filter(Boolean));
    const named = new Set([...(/cancer_study_identifier IN \(([^)]*)\)/.exec(q)?.[1] ?? "").matchAll(/'([^']*)'/g)].map((m) => m[1]));
    const bySample = q.includes("sample_stable_id IN");
    const rows = studies.filter(([id]) => named.has(id)).flatMap(([id, s]) => Object.entries(s.patients).flatMap(([p, samples]) =>
      samples.filter((smp) => wanted.has(bySample ? smp : p)).map((smp) => [id, p, smp])));
    return JSON.stringify({ data: rows, meta: [], rows: rows.length });
  }
  return json([]);
});
after(() => setChTransport(null));

let alice: { id: string };
before(async () => { alice = await userForEmail("alice@id-set-import.test"); });
beforeEach(() => { sent = []; });

const input = (over: Record<string, unknown>) => ({ name: "pasted", level: "patient", studies: ["s_a"], ids: ["P1"], ...over });

test("a list it cannot read is refused before the warehouse is asked", async () => {
  for (const bad of [null, "P1", 3]) await assert.rejects(createIdSet(alice.id, bad), /level must be 'patient' or 'sample'/);
  await assert.rejects(createIdSet(alice.id, input({ level: "case" })), /level must be 'patient' or 'sample'/);
  await assert.rejects(createIdSet(alice.id, input({ studies: undefined })), /studies must name at least one study/);
  await assert.rejects(createIdSet(alice.id, input({ studies: [] })), /studies must name at least one study/);
  await assert.rejects(createIdSet(alice.id, input({ studies: ["s_a", 3] })), /studies must name at least one study/);
  await assert.rejects(createIdSet(alice.id, input({ ids: "P1" })), /ids must list at least one id/);
  await assert.rejects(createIdSet(alice.id, input({ ids: [] })), /ids must list at least one id/);
  assert.deepEqual(sent, []);
});

test("a list past the limit is refused with the limit and its length named", async () => {
  await assert.rejects(createIdSet(alice.id, input({ ids: Array(ID_SET_MAX + 1).fill("P1") })),
    new RegExp("at most " + ID_SET_MAX.toLocaleString("en-US") + " ids; this list has " + (ID_SET_MAX + 1).toLocaleString("en-US")));
  assert.deepEqual(sent, []);
});

test("patients: the matched ones saved under the name given, the rest counted and shown", async () => {
  const r = await createIdSet(alice.id, input({ name: "my list", ids: ["P1", " P2 ", "NOPE", "", null] }));
  assert.equal(r.set.name, "my list");
  assert.equal(r.set.level, "patient");
  assert.equal(r.set.count, 2);
  assert.equal(r.unmatched, 1, "blank entries are not ids");
  assert.deepEqual(r.unmatchedExamples, ["NOPE"]);
  assert.equal(r.duplicates, 0);
  assert.deepEqual(r.refused, []);
  const stored = await readIdSet(alice.id, r.set.id);
  assert.deepEqual(stored.perStudy, { s_a: ["P1", "P2"] });
  assert.equal(stored.meta.owner, alice.id);
  assert.deepEqual(stored.meta.source, { idsIn: 3, unmatched: 1, duplicates: 0, multiStudy: 0 }, "the set records how it was made");
});

test("samples are matched by sample id and saved as samples", async () => {
  const r = await createIdSet(alice.id, input({ level: "sample", ids: ["P2-M", "P3-T", "P1"] }));
  assert.equal(r.set.level, "sample");
  assert.deepEqual((await readIdSet(alice.id, r.set.id)).perStudy, { s_a: ["P2-M"] });
  assert.equal(r.unmatched, 2, "a patient id is not a sample id");
});

test("ids given more than once are counted as duplicates and kept once", async () => {
  const r = await createIdSet(alice.id, input({ ids: ["P1", "P1", "P2", "P1"] }));
  assert.equal(r.duplicates, 2);
  assert.equal(r.set.count, 2);
});

test("a study-qualified id is looked up in that study alone; a bare one in every study, kept in each it names", async () => {
  const q = await createIdSet(alice.id, input({ studies: ["s_a", "s_c"], ids: ["s_c:SHARED", "s_a:C1"] }));
  assert.deepEqual((await readIdSet(alice.id, q.set.id)).perStudy, { s_c: ["SHARED"] });
  assert.equal(q.unmatched, 1, "C1 is not a patient of s_a");
  assert.equal(q.multiStudy, 0);

  const b = await createIdSet(alice.id, input({ studies: ["s_a", "s_c"], ids: ["SHARED", "C1"] }));
  assert.deepEqual((await readIdSet(alice.id, b.set.id)).perStudy, { s_a: ["SHARED"], s_c: ["C1", "SHARED"] });
  assert.equal(b.multiStudy, 1);
});

test("an aggregate-only study is not matched against; it is named with the reason, and its ids are unmatched", async () => {
  const r = await createIdSet(alice.id, input({ studies: ["s_a", "s_b"], ids: ["P1", "Q1"] }));
  assert.deepEqual(r.refused.map((x) => x.study), ["s_b"]);
  assert.match(r.refused[0].reason, /not entitled to patient-level data/);
  assert.equal(r.unmatched, 1);
  assert.deepEqual(r.unmatchedExamples, ["Q1"]);
  assert.deepEqual(sent.filter((s) => s.externals.includes("_upload_ids")).map((s) => s.conn), ["a"], "the list went to instance a alone");
});

test("a study named twice is matched once", async () => {
  await createIdSet(alice.id, input({ studies: ["s_a", "s_a"], ids: ["P1"] }));
  const lookups = sent.filter((s) => s.externals.includes("_upload_ids"));
  assert.equal(lookups.length, 1);
  assert.equal((/cancer_study_identifier IN \(([^)]*)\)/.exec(lookups[0].query)?.[1] ?? "").split(",").length, 1);
});

test("at most 20 of the ids that matched nothing are named", async () => {
  const ids = ["P1", ...Array.from({ length: 30 }, (_, i) => "X" + i)];
  const r = await createIdSet(alice.id, input({ ids }));
  assert.equal(r.unmatched, 30);
  assert.deepEqual(r.unmatchedExamples, ids.slice(1, 21));
});

test("a list that matches nothing is not saved", async () => {
  await assert.rejects(createIdSet(alice.id, input({ ids: ["NOPE"] })), /none of the ids matched a patient of the studies given; nothing to save/);
});

test("a set needs a name", async () => {
  await assert.rejects(createIdSet(alice.id, input({ name: undefined })), /needs a name/);
});
