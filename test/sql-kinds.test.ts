// What a statement's rows may hold is in its type (lib/sql-kinds.ts): an aggregate, rows naming
// patients, or a cohort's subquery. This runs the compiler over test/fixtures/sql-kinds/refused.ts,
// whose every mix of those kinds is marked as an expected error — so the test fails if one of them
// starts to compile, and with it the guarantee that an aggregate-only participant cannot be handed
// a statement returning patient ids.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("the compiler refuses every statement that mixes aggregates, patient rows and cohort subqueries", () => {
  const r = spawnSync(process.execPath, [root + "node_modules/typescript/bin/tsc", "--noEmit", "-p", "test/fixtures/sql-kinds/tsconfig.json"],
    { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, "tsc over test/fixtures/sql-kinds/refused.ts:\n" + r.stdout + r.stderr);
});
