// Where an analysis's data came from (lib/provenance.ts): one source per database here and per
// peer endpoint, each with the studies it answered for, and what a peer said about itself kept
// apart from what this deployment calls it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { describeSources, peerSource, sourceIndex } from "../lib/provenance.ts";
import type { Resolver } from "../lib/federation.ts";

const local = (id: string, label: string) => ({
  instance: { id, label, mode: "patient-level", conn: { id, label, db: "nodb", url: "", user: "", password: "" } }
}) as unknown as Resolver;
const remote = (url: string, label: string, study: string, reported: Record<string, unknown> | null) => ({
  instance: { id: "peer", label, mode: "aggregate-only" },
  provenance: () => ({ url, reported: reported && { ...reported, study }, answeredAt: reported ? "2026-10-18T00:00:00.000Z" : null })
}) as unknown as Resolver;

describe("an analysis's sources", () => {
  const resolvers = {
    s1: local("a", "primary"),
    s2: remote("http://peer/api/mcp", "GENIE (via MCP) (shares patient timelines)", "s2", { name: "GENIE", build: "abc1234", imported: "2026-07-27 21:21:00" }),
    s3: remote("http://peer/api/mcp", "GENIE (via MCP)", "s3", { name: "GENIE", build: "abc1234", imported: null }),
    s4: remote("http://other/api/mcp", "Other site", "s4", null),
  };
  const studies = ["s1", "s2", "s3", "s4"];

  test("one source per database and per peer endpoint, in the order the studies first appear", async () => {
    const src = await describeSources(studies, resolvers);
    assert.deepEqual(src.map((s) => s.label), ["primary", "GENIE (via MCP)", "Other site"]);
    assert.deepEqual(src.map((s) => s.studies.map((x) => x.study)), [["s1"], ["s2", "s3"], ["s4"]]);
    assert.equal(src[0].remote, false);
    assert.equal(src[0].studies[0].imported, null, "an import date that cannot be read is unknown, not invented");
  });

  test("a peer's own report is kept apart from this deployment's label for it", async () => {
    const [, genie, other] = await describeSources(studies, resolvers);
    assert.equal(genie.label, "GENIE (via MCP)", "the label, without what the peer shares (participation says that)");
    assert.equal(genie.reportedName, "GENIE");
    assert.equal(genie.url, "http://peer/api/mcp");
    assert.equal(genie.build, "abc1234");
    assert.equal(genie.answeredAt, "2026-10-18T00:00:00.000Z");
    assert.deepEqual(genie.studies, [{ study: "s2", imported: "2026-07-27 21:21:00" }, { study: "s3", imported: null }]);
    assert.equal(other.reportedName, undefined, "a peer that has not answered has not described itself");
    assert.equal(other.remote, true);
  });

  test("each view's participation points at its study's source", async () => {
    const src = await describeSources(studies, resolvers), idx = sourceIndex(studies, resolvers);
    for (const s of studies) assert.ok(src[idx.get(s)!].studies.some((x) => x.study === s), s);
    assert.deepEqual([...idx.values()], [0, 1, 1, 2]);
  });

  test("a peer describes itself: its name and its build", async () => {
    const me = await peerSource();
    assert.equal(typeof me.name, "string");
    assert.ok(me.name.length > 0);
    assert.equal(typeof me.build, "string");
  });
});
