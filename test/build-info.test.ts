// What a deployment says it was built from (lib/build-info.ts): a short id linking to the commit,
// "+dirty" kept, "dev" for a dev server, and "unknown" — never blank — when the build could not tell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCommit } from "../lib/build-info.ts";

const SHA = "d536a24f0c1e2b3a4d5e6f708192a3b4c5d6e7f8";

test("a commit reads as its short id and links to it", () => {
  assert.deepEqual(describeCommit(SHA), { commit: SHA, label: "d536a24", url: "https://github.com/cBioPortal/cohort-lab/commit/" + SHA });
});
test("a tree that differed from its commit says so", () => {
  const d = describeCommit(SHA + "+dirty");
  assert.equal(d.label, "d536a24+dirty");
  assert.equal(d.url, "https://github.com/cBioPortal/cohort-lab/commit/" + SHA);
});
test("no commit reads as unknown", () => {
  for (const raw of [null, undefined, "", "  "]) assert.deepEqual(describeCommit(raw), { commit: null, label: "unknown", url: null });
});
test("a dev server reads as dev, with no link", () => {
  assert.deepEqual(describeCommit("dev"), { commit: "dev", label: "dev", url: null });
});
