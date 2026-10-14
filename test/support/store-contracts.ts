// What a store promises, whichever database holds it: run on lib/db.ts's in-process fallback
// (test/custom-store.test.ts) and on a Postgres the test supplies (test/postgres.db-test.ts).
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { listDatasets, saveDataset, readVersion, deleteDataset, unpackRows } from "../../lib/custom-store.ts";
import { listArtifacts, getArtifact, createArtifact, updateArtifact, deleteArtifact } from "../../lib/artifacts.ts";
import { userForEmail, signIn, claimLegacy } from "../../lib/users.ts";
import { dbQuery } from "../../lib/db.ts";

const ds = (id: string, value = "Brain") => ({
  id, name: id + " (test)", level: "patient", columns: [{ name: "MET_SITE", datatype: "STRING" }],
  rows: [{ study: "s1", patient: "P-1", values: [value] }, { study: "s1", patient: "P-2", values: ["Primary"] }]
});
/** the owner, and another signed-in user: real users, since rows are owned by a user's id */
let P = "", OTHER = "";
const users = async () => {
  P = (await userForEmail("owner@contract.test")).id;
  OTHER = (await userForEmail("someone-else@contract.test")).id;
};

/** Server-stored custom data (lib/custom-store.ts): versions are append-only, names do not collide, a deleted dataset says so. */
export function customStoreContract(backend: string): void {
  describe("custom store (" + backend + ")", () => {
    before(users);
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
      assert.ok(!(await listDatasets(OTHER)).some((x) => x.id === d.id));
      await assert.rejects(readVersion(OTHER, d.id), /no custom dataset .* that you may read/);
    });
  });
}

/** Saved cohorts and analyses (lib/artifacts.ts): owner-scoped, read back as written, ISO timestamps. */
export function artifactContract(backend: string): void {
  describe("saved cohorts and analyses (" + backend + ")", () => {
    before(users);
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
      assert.equal(await getArtifact(OTHER, a.id), null);
      assert.ok(!(await listArtifacts(OTHER)).some((x) => x.id === a.id));
      assert.equal(await updateArtifact(OTHER, a.id, { name: "taken" }), null);
      assert.equal(await deleteArtifact(OTHER, a.id), false);
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

/** People (lib/users.ts): who a sign-in is, and when an identity may join an existing user. */
export function userContract(backend: string): void {
  describe("users (" + backend + ")", () => {
    const iss = "https://issuer.test";
    test("the same provider subject is the same user, whatever its email becomes", async () => {
      const a = await signIn({ provider: iss, subject: "s-1", email: "Ada@Example.org", emailVerified: true, name: "Ada" });
      assert.equal(a.email, "ada@example.org");
      const b = await signIn({ provider: iss, subject: "s-1", email: "ada.l@example.org", emailVerified: true, name: "Ada L" });
      assert.equal(b.id, a.id);
      assert.equal(b.email, "ada.l@example.org", "a verified new address replaces the old");
      assert.equal(b.name, "Ada L");
    });
    test("a verified email joins the user added before they ever signed in", async () => {
      const stub = await userForEmail("grace@example.org");
      const g = await signIn({ provider: iss, subject: "s-2", email: "grace@example.org", emailVerified: true });
      assert.equal(g.id, stub.id);
      assert.equal((await signIn({ provider: iss, subject: "s-2" })).id, stub.id, "and the identity is linked from then on");
    });
    test("an unverified email never takes over an existing user", async () => {
      await userForEmail("taken@example.org");
      await assert.rejects(signIn({ provider: iss, subject: "s-3", email: "taken@example.org", emailVerified: false }),
        /has not verified that address, so it cannot be linked/);
      const fresh = await signIn({ provider: iss, subject: "s-4", email: "new@example.org", emailVerified: false });
      assert.equal(fresh.email, "new@example.org", "a new address is fine unverified: it takes nothing from anyone");
    });
    test("a sign-in without an email is refused; another provider's same subject is someone else", async () => {
      await assert.rejects(signIn({ provider: iss, subject: "s-5" }), /did not include an email address/);
      const a = await signIn({ provider: iss, subject: "same", email: "one@example.org", emailVerified: true });
      const b = await signIn({ provider: "https://other.test", subject: "same", email: "two@example.org", emailVerified: true });
      assert.notEqual(a.id, b.id);
    });
    test("a disabled user cannot sign in", async () => {
      const u = await signIn({ provider: iss, subject: "s-6", email: "gone@example.org", emailVerified: true });
      await dbQuery("update app_user set disabled_at = now() where id = $1", [u.id]);
      await assert.rejects(signIn({ provider: iss, subject: "s-6" }), /has been disabled/);
    });
    test("rows from before accounts are nobody's until claimed, then the claimant's alone", async () => {
      await dbQuery("insert into saved_artifacts (kind, name, definition) values ('cohort', 'legacy', '{}'::jsonb)");
      const before = await claimLegacy("heir@example.org", true);
      assert.ok(before.artifacts >= 1);
      const heir = await userForEmail("heir@example.org");
      assert.ok(!(await listArtifacts(heir.id)).some((a) => a.name === "legacy"), "unclaimed: invisible even to its future owner");
      const r = await claimLegacy("heir@example.org");
      assert.equal(r.user!.id, heir.id);
      assert.ok((await listArtifacts(heir.id)).some((a) => a.name === "legacy"));
      assert.equal((await claimLegacy("heir@example.org", true)).artifacts, 0);
    });
  });
}
