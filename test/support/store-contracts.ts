// What a store promises, whichever database holds it: run on lib/db.ts's in-process fallback
// (test/custom-store.test.ts) and on a Postgres the test supplies (test/postgres.db-test.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { listDatasets, saveDataset, readVersion, deleteDataset, unpackRows } from "../../lib/custom-store.ts";
import { listArtifacts, getArtifact, createArtifact, updateArtifact, deleteArtifact } from "../../lib/artifacts.ts";

const ds = (id: string, value = "Brain") => ({
  id, name: id + " (test)", level: "patient", columns: [{ name: "MET_SITE", datatype: "STRING" }],
  rows: [{ study: "s1", patient: "P-1", values: [value] }, { study: "s1", patient: "P-2", values: ["Primary"] }]
});
const P = "shared";

/** Server-stored custom data (lib/custom-store.ts): versions are append-only, names do not collide, a deleted dataset says so. */
export function customStoreContract(backend: string): void {
  describe("custom store (" + backend + ")", () => {
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
      // its name stays taken, so a link pinned to it cannot quietly read a newer upload
      await assert.rejects(saveDataset(P, ds("gone"), {}), /belonged to a dataset that was deleted, and is not reused: rename/);
    });

    test("another principal can read nothing it was not granted", async () => {
      const d = await saveDataset(P, ds("private"), {});
      assert.ok(!(await listDatasets("someone-else")).some((x) => x.id === d.id));
      await assert.rejects(readVersion("someone-else", d.id), /no custom dataset .* that you may read/);
    });
  });
}

/** Saved cohorts and analyses (lib/artifacts.ts): owner-scoped, read back as written, ISO timestamps. */
export function artifactContract(backend: string): void {
  describe("saved cohorts and analyses (" + backend + ")", () => {
    const def = { all: [{ kind: "oql", q: "TP53: MUT" }] };
    test("a saved cohort reads back as written, with ISO timestamps", async () => {
      const a = await createArtifact(P, "cohort", "TP53 mutant", def);
      assert.equal(a.kind, "cohort");
      assert.deepEqual(a.definition, def);
      for (const t of [a.createdAt, a.updatedAt]) assert.equal(typeof t, "string", "a timestamp is ISO text on every backend, not a " + typeof t);
      assert.match(a.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
      assert.deepEqual(await getArtifact(P, a.id), a);
      assert.ok((await listArtifacts(P, "cohort")).some((x) => x.id === a.id));
      assert.ok(!(await listArtifacts(P, "workspace")).some((x) => x.id === a.id));
    });
    test("an update renames and replaces, and moves updated_at forward", async () => {
      const a = await createArtifact(P, "workspace", "draft", { study: "s", cohorts: {}, views: [] });
      await new Promise((r) => setTimeout(r, 15));
      const b = await updateArtifact(P, a.id, { name: "final", definition: { study: "s", cohorts: { x: def }, views: [] } });
      assert.equal(b!.name, "final");
      assert.deepEqual((b!.definition as { cohorts: object }).cohorts, { x: def });
      assert.ok(b!.updatedAt > a.updatedAt, b!.updatedAt + " should be after " + a.updatedAt);
      assert.equal(b!.createdAt, a.createdAt);
    });
    test("someone else's artifact reads as absent, and cannot be changed or deleted", async () => {
      const a = await createArtifact(P, "cohort", "mine", def);
      assert.equal(await getArtifact("someone-else", a.id), null);
      assert.ok(!(await listArtifacts("someone-else")).some((x) => x.id === a.id));
      assert.equal(await updateArtifact("someone-else", a.id, { name: "taken" }), null);
      assert.equal(await deleteArtifact("someone-else", a.id), false);
      assert.equal((await getArtifact(P, a.id))!.name, "mine");
    });
    test("a deleted artifact is gone", async () => {
      const a = await createArtifact(P, "cohort", "temporary", def);
      assert.equal(await deleteArtifact(P, a.id), true);
      assert.equal(await getArtifact(P, a.id), null);
      assert.equal(await deleteArtifact(P, a.id), false);
    });
    test("what is not a cohort or an analysis is refused before it is stored", async () => {
      await assert.rejects(createArtifact(P, "cohort", "", def), /name is required/);
      await assert.rejects(createArtifact(P, "cohort", "x", null), /definition must be an object/);
      await assert.rejects(createArtifact(P, "notes" as never, "x", def), /kind must be 'cohort' or 'workspace'/);
    });
  });
}
