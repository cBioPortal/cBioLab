// View snapshots, shard 4 of 4 (test/support/view-snapshots.ts).
import { test } from "node:test";
import { snapshotCases } from "./support/view-snapshots.ts";

for (const [name, run] of snapshotCases(4, 4)) test(name, run);
