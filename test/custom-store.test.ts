// Server-stored custom data (lib/custom-store.ts, lib/auth.ts), on the in-memory
// backend: versions are append-only, names do not collide, a deleted dataset says so, and the
// access code is the only way in.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

delete process.env.SUPABASE_DB_URL;
const { listDatasets, saveDataset, readVersion, deleteDataset, unpackRows } = await import("../lib/custom-store.ts");
const access = await import("../lib/auth.ts");

const ds = (id: string, value = "Brain") => ({
  id, name: id + " (test)", level: "patient", columns: [{ name: "MET_SITE", datatype: "STRING" }],
  rows: [{ study: "s1", patient: "P-1", values: [value] }, { study: "s1", patient: "P-2", values: ["Primary"] }]
});
const P = "shared";

describe("custom store", () => {
  test("a saved dataset lists without rows and reads back exactly", async () => {
    const meta = await saveDataset(P, ds("brain-mets"), { rowsIn: 3, unmatched: 1 });
    assert.equal(meta.slug, "brain-mets");
    assert.equal(meta.latestVersion, 1);
    assert.deepEqual(meta.versions.map((v) => [v.version, v.rowCount, v.source.unmatched]), [[1, 2, 1]]);
    const listed = await listDatasets(P);
    assert.ok(listed.some((d) => d.id === meta.id));
    assert.ok(!("rows" in listed[0]));
    const r = await readVersion(P, meta.id);
    assert.equal(r.version, 1);
    assert.deepEqual(unpackRows(r.rowsGz), ds("brain-mets").rows);
  });

  test("a re-upload is a new version; the old one still reads the same", async () => {
    const v1 = await saveDataset(P, ds("pinned"), {});
    const v2 = await saveDataset(P, ds("pinned", "Liver"), {}, v1.id);
    assert.equal(v2.id, v1.id);
    assert.equal(v2.latestVersion, 2);
    assert.equal(unpackRows((await readVersion(P, v1.id, 1)).rowsGz)[0].values[0], "Brain");
    assert.equal(unpackRows((await readVersion(P, v1.id)).rowsGz)[0].values[0], "Liver");
    await assert.rejects(readVersion(P, v1.id, 3), /has no version 3 \(latest is 2\)/);
  });

  test("a second dataset under the same name is refused, not merged", async () => {
    await saveDataset(P, ds("taken"), {});
    await assert.rejects(saveDataset(P, ds("taken"), {}), /already named taken: save as a new version of it, or rename/);
  });

  test("a new version must keep the level", async () => {
    const a = await saveDataset(P, ds("levels"), {});
    const sample = { ...ds("levels"), level: "sample", rows: [{ study: "s1", patient: "P-1", sample: "P-1-T1", values: ["x"] }] };
    await assert.rejects(saveDataset(P, sample, {}, a.id), /is patient-level; a new version must be too/);
  });

  test("what the engine would refuse is never stored", async () => {
    await assert.rejects(saveDataset(P, { ...ds("bad"), columns: [{ name: "a b", datatype: "STRING" }] }, {}), /letters, digits and underscores/);
  });

  test("a deleted dataset disappears from the list and says when it went", async () => {
    const d = await saveDataset(P, ds("gone"), {});
    await deleteDataset(P, d.id);
    assert.ok(!(await listDatasets(P)).some((x) => x.id === d.id));
    await assert.rejects(readVersion(P, d.id, 1), /was deleted on \d{4}-\d{2}-\d{2}/);
  });

  test("another principal can read nothing it was not granted", async () => {
    const d = await saveDataset(P, ds("private"), {});
    assert.ok(!(await listDatasets("someone-else")).some((x) => x.id === d.id));
    await assert.rejects(readVersion("someone-else", d.id), /no custom dataset .* that you may read/);
  });
});

describe("custom data access code", () => {
  const req = (cookie?: string) => new Request("https://x.test/api", { headers: cookie ? { cookie } : {} });
  test("disabled where no code is configured", () => {
    delete process.env.LOGIN_PASSWORD;
    assert.equal(access.loginEnabled(), false);
    assert.throws(() => access.requirePrincipal(req()), /has no login/);
  });
  test("only the right code unlocks, and only its cookie is accepted", () => {
    process.env.LOGIN_PASSWORD = "correct horse";
    assert.equal(access.unlockCookie("wrong", true), null);
    const set = access.unlockCookie("correct horse", true)!;
    assert.match(set, /HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
    assert.ok(!set.includes("correct horse"), "the cookie holds a hash, never the code");
    const cookie = set.split(";")[0];
    assert.equal(access.requirePrincipal(req(cookie)), "shared");
    assert.throws(() => access.requirePrincipal(req()), /log in to use saved cohorts, analyses and custom data/);
    assert.throws(() => access.requirePrincipal(req(access.ACCESS_COOKIE + "=deadbeef")), /log in/);
    process.env.LOGIN_PASSWORD = "rotated";
    assert.throws(() => access.requirePrincipal(req(cookie)), /log in/, "rotating the password logs every browser out");
    delete process.env.LOGIN_PASSWORD;
  });
});
