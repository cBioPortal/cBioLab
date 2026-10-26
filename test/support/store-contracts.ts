// What a store promises, whichever database holds it: run on lib/db.ts's in-process fallback
// (test/custom-store.test.ts) and on a Postgres the test supplies (test/postgres.db-test.ts).
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { listDatasets, saveDataset, readVersion, deleteDataset, unpackRows, shareDataset } from "../../lib/custom-store.ts";
import { listArtifacts, getArtifact, createArtifact, updateArtifact, deleteArtifact, shareArtifact } from "../../lib/artifacts.ts";
import { createGroup, addMember, getGroup, listGroups, removeMember, setRole, deleteGroup } from "../../lib/groups.ts";
import { userForEmail, signIn, claimLegacy, searchUsers } from "../../lib/users.ts";
import { dbQuery } from "../../lib/db.ts";
import { saveIdSet, listIdSets, getIdSet, readIdSet, deleteIdSet, shareIdSet, loadIdSetForRequest } from "../../lib/id-set-store.ts";

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

/** Stored id sets (lib/id-set-store.ts): read back exactly, never changed, owner-scoped, a deleted one says so. */
export function idSetContract(backend: string): void {
  describe("id set store (" + backend + ")", () => {
    before(users);
    const input = (name: string) => ({ name, level: "sample" as const, perStudy: { s2: ["T-1"], s1: ["S-2", "S-1", "S-1"] },
      source: { idsIn: 5, unmatched: 1, duplicates: 1, multiStudy: 0 } });

    test("a saved set lists without ids and reads back its distinct ids per study", async () => {
      const meta = await saveIdSet(P, input("responders"));
      assert.equal(meta.count, 3);
      assert.deepEqual(meta.studies, ["s1", "s2"]);
      assert.deepEqual(meta.perStudy, { s1: 2, s2: 1 });
      assert.equal(meta.source.unmatched, 1);
      const listed = await listIdSets(P);
      assert.ok(listed.some((x) => x.id === meta.id));
      assert.ok(!("ids" in listed[0]) && !("perStudy" in listed[0] && Array.isArray((listed[0].perStudy as any).s1)));
      assert.deepEqual((await readIdSet(P, meta.id)).perStudy, { s1: ["S-1", "S-2"], s2: ["T-1"] });
      const loaded = await loadIdSetForRequest(P, meta.id);
      assert.deepEqual([loaded.name, loaded.level, loaded.count], ["responders", "sample", 3]);
    });

    test("a set with no ids, or no name, is refused rather than stored", async () => {
      await assert.rejects(saveIdSet(P, { ...input("empty"), perStudy: { s1: [] } }), /none of the ids matched/);
      await assert.rejects(saveIdSet(P, input("  ")), /needs a name/);
    });

    test("another principal can read nothing it was not granted, until it is shared", async () => {
      const meta = await saveIdSet(P, input("private"));
      assert.ok(!(await listIdSets(OTHER)).some((x) => x.id === meta.id));
      await assert.rejects(readIdSet(OTHER, meta.id), /no stored id set .* that you may read/);
      await assert.rejects(loadIdSetForRequest(OTHER, meta.id), /no stored id set .* that you may read/);
      await assert.rejects(shareIdSet(OTHER, meta.id, { visibility: "public" }), /no stored id set/);
      await shareIdSet(P, meta.id, { visibility: "public" });
      assert.deepEqual((await readIdSet(OTHER, meta.id)).perStudy.s2, ["T-1"]);
      await assert.rejects(deleteIdSet(OTHER, meta.id), /only its owner can delete/);
      await loadIdSetForRequest(OTHER, meta.id);
      await shareIdSet(P, meta.id, { visibility: "private" });
      await assert.rejects(loadIdSetForRequest(OTHER, meta.id), /no stored id set/, "unsharing takes effect at once, not after the access check's minute");
    });

    test("a deleted set disappears from the list, and reading it says when it went", async () => {
      const meta = await saveIdSet(P, input("gone"));
      await loadIdSetForRequest(P, meta.id);   // read once, so it is remembered
      await deleteIdSet(P, meta.id);
      await assert.rejects(loadIdSetForRequest(P, meta.id), /was deleted on/, "a set read just before its deletion is not served after it");
      assert.ok(!(await listIdSets(P)).some((x) => x.id === meta.id));
      assert.ok((await getIdSet(P, meta.id)).deletedAt);
      await assert.rejects(readIdSet(P, meta.id), /was deleted on \d{4}-\d{2}-\d{2}/);
    });

    test("a lock is one row: its patients, and its samples and arms as parts, read back exactly", async () => {
      const meta = await saveIdSet(P, { ...input("locked"), parts: { samples: { s1: ["S-1-T", "S-2-T"] }, "arm:sex / Female": { s1: ["S-1"] }, "arm:sex / Male": {} } }, { allowEmpty: true });
      assert.equal(meta.kind, "lock");
      assert.deepEqual(meta.parts, { samples: 2, "arm:sex / Female": 1, "arm:sex / Male": 0 });
      const r = await readIdSet(P, meta.id);
      assert.deepEqual(r.parts?.samples, { s1: ["S-1-T", "S-2-T"] });
      assert.deepEqual(r.parts?.["arm:sex / Female"], { s1: ["S-1"] });
      assert.equal((await loadIdSetForRequest(P, meta.id)).parts?.["arm:sex / Female"]?.s1?.[0], "S-1");
      assert.equal((await saveIdSet(P, input("plain"))).kind, "list");
      await assert.rejects(dbQuery("update id_set set parts_gz = null where id = $1", [meta.id]), /members are immutable/);
      await assert.rejects(dbQuery("update id_set set parts = '{}'::jsonb where id = $1", [meta.id]), /members are immutable/);
    });

    test("its members cannot be changed or the row deleted, though its sharing can", async () => {
      const meta = await saveIdSet(P, input("frozen"));
      await assert.rejects(dbQuery("update id_set set id_count = 99 where id = $1", [meta.id]), /members are immutable/);
      await assert.rejects(dbQuery("update id_set set ids_gz = ''::bytea where id = $1", [meta.id]), /members are immutable/);
      await assert.rejects(dbQuery("delete from id_set where id = $1", [meta.id]), /never deleted/);
      await dbQuery("update id_set set name = 'renamed' where id = $1", [meta.id]);
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
    test("search finds people who have signed in, by email prefix or a word of their name", async () => {
      await signIn({ provider: iss, subject: "s-search-1", email: "barbara.mcclintock@example.org", emailVerified: true, name: "Barbara McClintock" });
      await signIn({ provider: iss, subject: "s-search-2", email: "rosalind@example.org", emailVerified: true, name: "Rosalind Franklin" });
      await userForEmail("barbara.never@example.org");
      const emails = async (q: string) => (await searchUsers(q)).map((u) => u.email);
      assert.deepEqual(await emails("barb"), ["barbara.mcclintock@example.org"], "an email prefix, and never someone who has not signed in");
      assert.deepEqual(await emails("frank"), ["rosalind@example.org"], "a word of the name");
      assert.deepEqual(await emails("ara"), [], "not the middle of a word");
      assert.deepEqual(await emails("b"), [], "two characters at least");
      assert.deepEqual(await emails("%a"), [], "LIKE's wildcards are only text");
      assert.deepEqual(await emails("rosalind_"), [], "an underscore too");
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

/**
 * Sharing (lib/access.ts) and groups (lib/groups.ts): the whole access matrix — owner, a member of
 * the item's group, someone outside it — for every sharing, on saved items and custom datasets.
 */
export function sharingContract(backend: string): void {
  describe("sharing and groups (" + backend + ")", () => {
    let O = "", M = "", X = "", G = "", G2 = "";
    const tag = Math.random().toString(36).slice(2, 8);
    before(async () => {
      O = (await userForEmail("owner-" + tag + "@share.test")).id;
      M = (await userForEmail("member-" + tag + "@share.test")).id;
      X = (await userForEmail("outsider-" + tag + "@share.test")).id;
      G = (await createGroup(O, "lab " + tag)).id;
      await addMember(O, G, "member-" + tag + "@share.test");
      G2 = (await createGroup(X, "other " + tag)).id;
    });

    type Can = { read: boolean; edit: boolean };
    const SHARINGS: [string, Record<string, unknown>, Can, Can][] = [
      // [name, sharing, what the group member may do, what the outsider may do]
      ["private", { visibility: "private" }, { read: false, edit: false }, { read: false, edit: false }],
      ["group", { visibility: "group", groupId: "G" }, { read: true, edit: false }, { read: false, edit: false }],
      ["group, group edits", { visibility: "group", groupId: "G", groupCanEdit: true }, { read: true, edit: true }, { read: false, edit: false }],
      ["everyone", { visibility: "public" }, { read: true, edit: false }, { read: true, edit: false }],
      ["everyone, group edits", { visibility: "public", groupId: "G", groupCanEdit: true }, { read: true, edit: true }, { read: true, edit: false }],
    ];
    const withGroup = (s: Record<string, unknown>) => ({ ...s, ...(s.groupId ? { groupId: G } : {}) });

    for (const [name, sharing, member, outsider] of SHARINGS) {
      test("a saved analysis shared " + name + ": owner, member and outsider each get exactly their rights", async () => {
        const a = await createArtifact(O, "workspace", "shared " + name + " " + tag, { views: [] });
        const r = await shareArtifact(O, a.id, withGroup(sharing));
        assert.equal(r!.artifact.sharing.visibility, sharing.visibility);
        for (const [who, can] of [[M, member], [X, outsider]] as [string, Can][]) {
          const seen = await getArtifact(who, a.id);
          assert.equal(!!seen, can.read, "read");
          assert.equal((await listArtifacts(who, "workspace")).some((x) => x.id === a.id), can.read, "listed");
          if (seen) assert.deepEqual(seen.rights, { edit: can.edit, share: false });
          if (can.edit) assert.equal((await updateArtifact(who, a.id, { name: "edited by " + who }))!.name, "edited by " + who);
          else if (can.read) await assert.rejects(updateArtifact(who, a.id, { name: "x" }), /shared with you to read, not to change/);
          else assert.equal(await updateArtifact(who, a.id, { name: "x" }), null);
          // only the owner deletes or reshares, whatever else the sharing allows
          if (can.read) {
            await assert.rejects(deleteArtifact(who, a.id), /only its owner can delete/);
            await assert.rejects(shareArtifact(who, a.id, { visibility: "public" }), /only its owner can change who/);
          } else {
            assert.equal(await deleteArtifact(who, a.id), false);
            assert.equal(await shareArtifact(who, a.id, { visibility: "public" }), null);
          }
        }
        assert.deepEqual((await getArtifact(O, a.id))!.rights, { edit: true, share: true });
        assert.equal(await deleteArtifact(O, a.id), true);
      });

      test("a custom dataset shared " + name + ": the same rights over its rows", async () => {
        const d = await saveDataset(O, { ...ds("sh-" + tag + "-" + name.replace(/[^a-z]/g, "")) }, {});
        await shareDataset(O, d.id, withGroup(sharing));
        for (const [who, can] of [[M, member], [X, outsider]] as [string, Can][]) {
          assert.equal((await listDatasets(who)).some((x) => x.id === d.id), can.read, "listed");
          if (can.read) assert.deepEqual(unpackRows((await readVersion(who, d.id, 1)).rowsGz), ds("x").rows);
          else await assert.rejects(readVersion(who, d.id, 1), /no custom dataset .* that you may read/);
          if (can.edit) assert.equal((await saveDataset(who, ds("ignored", "Lung"), {}, d.id)).latestVersion >= 2, true);
          else await assert.rejects(saveDataset(who, ds("ignored"), {}, d.id), can.read ? /but not add versions/ : /that you may read/);
          await assert.rejects(deleteDataset(who, d.id), can.read ? /only its owner can delete/ : /that you may read/);
          await assert.rejects(shareDataset(who, d.id, { visibility: "public" }), can.read ? /only its owner can change who/ : /that you may read/);
        }
      });
    }

    test("a sharing that does not make sense is refused, and one may share only with one's own group", async () => {
      const a = await createArtifact(O, "cohort", "rules " + tag, { all: [] });
      await assert.rejects(shareArtifact(O, a.id, { visibility: "private", groupId: G, groupCanEdit: true }), /can edit only what it can see/);
      await assert.rejects(shareArtifact(O, a.id, { visibility: "group" }), /name the group/);
      await assert.rejects(shareArtifact(O, a.id, { visibility: "friends" }), /visibility must be one of/);
      await assert.rejects(shareArtifact(O, a.id, { visibility: "group", groupId: G2 }), /only with a group you belong to/);
      // a group named where it does not matter is dropped, not kept
      assert.equal((await shareArtifact(O, a.id, { visibility: "public", groupId: G }))!.artifact.sharing.groupId, null);
    });

    test("an edit made from a stale copy is refused, not merged", async () => {
      const a = await createArtifact(O, "workspace", "stale " + tag, { views: [] });
      await shareArtifact(O, a.id, { visibility: "group", groupId: G, groupCanEdit: true });
      const mine = await updateArtifact(M, a.id, { definition: { views: [1] }, version: a.version });
      assert.equal(mine!.version, a.version + 1);
      await assert.rejects(updateArtifact(O, a.id, { definition: { views: [2] }, version: a.version }), /was changed .* since you opened it/);
      assert.deepEqual((await getArtifact(O, a.id))!.definition, { views: [1] });
    });

    test("an analysis shared wider than a dataset it uses names that dataset, and stops once it is shared too", async () => {
      const d = await saveDataset(O, ds("pinned-" + tag), {});
      const a = await createArtifact(O, "workspace", "uses data " + tag, { views: [], uploads: [{ as: d.slug, dataset: d.id, version: 1 }] });
      const r = await shareArtifact(O, a.id, { visibility: "group", groupId: G });
      assert.deepEqual(r!.warnings.map((w) => [w.slug, w.visibility, w.yours]), [[d.slug, "private", true]]);
      await shareDataset(O, d.id, { visibility: "group", groupId: G });
      assert.deepEqual((await shareArtifact(O, a.id, { visibility: "group", groupId: G }))!.warnings, []);
      assert.equal((await shareArtifact(O, a.id, { visibility: "public" }))!.warnings.length, 1, "everyone is wider than the group");
    });

    test("groups: admins manage them, members see them, and a group always keeps an admin", async () => {
      const g = await getGroup(O, G);
      assert.deepEqual(g.memberList.map((m) => m.role).sort(), ["admin", "member"]);
      await assert.rejects(getGroup(X, G), /no group .* that you belong to/);
      await assert.rejects(addMember(M, G, "intruder@share.test"), /only an admin/);
      await assert.rejects(removeMember(O, G, O), /needs an admin/);
      await assert.rejects(setRole(O, G, O, "member"), /needs an admin/);
      assert.ok((await listGroups(M)).some((x) => x.id === G && x.role === "member"));
      // someone added by email before they ever signed in is a member when they do
      const later = "later-" + tag + "@share.test";
      await addMember(O, G, later);
      const u = await signIn({ provider: "https://issuer.test", subject: "later-" + tag, email: later, emailVerified: true });
      assert.ok((await listGroups(u.id)).some((x) => x.id === G));
      await removeMember(u.id, G, u.id);   // leaving
      assert.ok(!(await listGroups(u.id)).some((x) => x.id === G));
    });

    test("leaving a group loses what it shared; deleting one makes what it shared private again", async () => {
      const g = (await createGroup(O, "temporary " + tag)).id;
      const leaver = "leaver-" + tag + "@share.test";
      await addMember(O, g, leaver);
      const L = (await userForEmail(leaver)).id;
      const a = await createArtifact(O, "cohort", "group only " + tag, { all: [] });
      const b = await createArtifact(O, "cohort", "public, group edits " + tag, { all: [] });
      await shareArtifact(O, a.id, { visibility: "group", groupId: g });
      await shareArtifact(O, b.id, { visibility: "public", groupId: g, groupCanEdit: true });
      assert.ok(await getArtifact(L, a.id));
      await removeMember(L, g, L);
      assert.equal(await getArtifact(L, a.id), null);
      await deleteGroup(O, g);
      assert.deepEqual((await getArtifact(O, a.id))!.sharing, { visibility: "private", groupId: null, groupCanEdit: false, groupName: null });
      assert.deepEqual((await getArtifact(O, b.id))!.sharing, { visibility: "public", groupId: null, groupCanEdit: false, groupName: null });
    });
  });
}
