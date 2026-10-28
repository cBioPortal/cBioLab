// Stored id sets in the engine (lib/id-sets.ts, lib/cohort2.ts): a list clause naming a set
// compiles to an external table instead of an inlined list, only for a request that read the set,
// and its ids go only to the connection entitled to them. The store itself is
// test/support/store-contracts.ts (idSetContract).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compileCohortDef, describeCohortDef, INLINE_ID_SQL_LIMIT } from "../lib/cohort2.ts";
import { withIdSets, idSetExternalsFor, idSetTableName, idSetRefsIn, hasIdSets, type LoadedIdSet } from "../lib/id-sets.ts";
import { carriesPatientIds } from "../lib/federation.ts";

const SET = "0b7f9c1e-2f4a-4c3b-9d8e-1a2b3c4d5e6f";
const set: LoadedIdSet = { id: SET, name: "responders", level: "sample", count: 3, perStudy: { s1: ["S-1", "S-2"], s2: ["T-9"] } };
const leaf = { kind: "sampleList" as const, set: SET };
const ctx = { study: "s1", db: "db" };
const conns = new Map([["s1", "a"], ["s2", "b"]]);
const inSets = <T>(fn: () => Promise<T>) => withIdSets([set], conns, fn);

describe("a list clause naming a stored set", () => {
  test("compiles to the set's table for that study, never to its ids", async () => {
    const sql = await inSets(async () => compileCohortDef({ all: [leaf] }, ctx));
    assert.match(sql, new RegExp("IN \\(SELECT id FROM " + idSetTableName(SET, "s1") + "\\)"));
    assert.doesNotMatch(sql, /S-1|S-2|T-9/);
  });
  test("names a different table per study, and nobody in a study the set has no ids for", async () => {
    assert.notEqual(idSetTableName(SET, "s1"), idSetTableName(SET, "s2"));
    const sql = await inSets(async () => compileCohortDef({ all: [leaf] }, { study: "s3", db: "db" }));
    assert.match(sql, /AND 1=0\)/);
  });
  test("is refused, saying why, in a request that did not read the set (MCP, a script, a signed-out link)", () => {
    assert.throws(() => compileCohortDef({ all: [leaf] }, ctx), /names stored id set .* which this request did not read/);
  });
  test("is refused when the set holds the other kind of id", async () => {
    await assert.rejects(inSets(async () => compileCohortDef({ all: [{ kind: "patientList", set: SET }] }, ctx)),
      /holds sample ids; name it in a sampleList clause/);
  });
  test("takes ids or a set, not both, and a set must be an id", async () => {
    await assert.rejects(inSets(async () => compileCohortDef({ all: [{ ...leaf, ids: ["s1:S-1"] }] }, ctx)), /ids or a stored set, not both/);
    assert.throws(() => idSetRefsIn({ all: [{ kind: "sampleList", set: "responders" }] }), /must be a stored id set's id/);
  });
  test("reads back by the set's name and size, and by its id when the set was not read", async () => {
    assert.equal(await inSets(async () => describeCohortDef({ all: [leaf] })), "in stored sample set “responders” (3 samples)");
    assert.equal(describeCohortDef({ all: [leaf] }), "in stored sample set " + SET);
  });
  test("is found wherever a body nests it, once", () => {
    assert.deepEqual(idSetRefsIn({ cohorts: { A: { all: [leaf] }, B: { all: [{ not: { any: [leaf] } }] } } }), [SET]);
    assert.deepEqual(idSetRefsIn({ cohorts: { A: { all: [{ kind: "sampleList", ids: ["s1:S-1"] }] } } }), []);
  });
  test("keeps the answer out of the shared cache", async () => {
    assert.equal(hasIdSets(), false);
    assert.equal(await inSets(async () => hasIdSets()), true);
  });
});

describe("a stored set's ids go only where they may", () => {
  test("a statement naming a study's table uploads that study's ids, and no other table", async () => {
    const t1 = idSetTableName(SET, "s1");
    const ext = await inSets(async () => idSetExternalsFor("SELECT 1 WHERE x IN (SELECT id FROM " + t1 + ")", "a"));
    assert.deepEqual(ext.map((e) => [e.name, e.data]), [[t1, "S-1\nS-2\n"]]);
    assert.deepEqual(await inSets(async () => idSetExternalsFor("SELECT 1", "a")), []);
  });
  test("is refused on a connection other than the patient-level one holding the study", async () => {
    const t2 = idSetTableName(SET, "s2");
    await assert.rejects(inSets(async () => idSetExternalsFor("SELECT id FROM " + t2, "a")), /cannot be sent to instance 'a'/);
    const noConn = withIdSets([set], new Map([["s1", "a"]]), async () => idSetExternalsFor("SELECT id FROM " + t2, "b"));
    await assert.rejects(noConn, /cannot be sent to instance 'b'/);
  });
  test("carriesPatientIds counts a set as ids, so it never reaches an aggregate-only or remote participant", () => {
    assert.equal(carriesPatientIds({ all: [leaf] }), true);
    assert.equal(carriesPatientIds({ all: [{ not: { any: [{ kind: "patientList", set: SET }] } } as any] }), true);
  });
});

describe("an inline list too long for one statement", () => {
  test("is refused by name, pointing at a stored set, rather than by ClickHouse's max_query_size", () => {
    const n = Math.ceil(INLINE_ID_SQL_LIMIT / 10);   // each id is 17 bytes of SQL quoted
    const ids = Array.from({ length: n }, (_, i) => "s1:P-" + String(i).padStart(12, "0"));
    assert.throws(() => compileCohortDef({ all: [{ kind: "sampleList", ids }] }, ctx), /too many to write into one query .* save it as a stored id set/);
  });
  test("a list under the limit still compiles inline, as before", () => {
    assert.match(compileCohortDef({ all: [{ kind: "sampleList", ids: ["s1:S-1"] }] }, ctx), /IN \('S-1'\)/);
  });
});
