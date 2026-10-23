// View snapshots, shard 1 of 4, and the check that every view kind has a case; the harness and its
// documentation are in test/support/view-snapshots.ts.
import { test } from "node:test";
import { snapshotCases, everyKindHasACase } from "./support/view-snapshots.ts";

for (const [name, run] of snapshotCases(1, 4)) test(name, run);
test("every view kind has a snapshot case", everyKindHasACase);
