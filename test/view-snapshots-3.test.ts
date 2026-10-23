// View snapshots, shard 3 of 4 (test/support/view-snapshots.ts).
import { test } from "node:test";
import { snapshotCases } from "./support/view-snapshots.ts";

for (const [name, run] of snapshotCases(3, 4)) test(name, run);
