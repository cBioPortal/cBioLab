/**
 * Can the access tests fail? Each entry is a realistic way to get sharing wrong, planted one at a
 * time into a copy of lib/access.ts; the store contracts (test/custom-store.test.ts: the access
 * matrix in test/support/store-contracts.ts) must fail against every one. A planted bug they do
 * not notice means they would miss that bug if it were real.
 *
 * The copy lives in a temporary directory (node_modules linked), so the working tree and its dev
 * server are never touched. A stage of scripts/gate.sh; about half a minute.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const FILE = "lib/access.ts";

const MUTANTS: { id: string; effect: string; find: string; replace: string }[] = [
  { id: "member-edits-without-edit-right", effect: "every member of an item's group can change it, not only where the group was given editing",
    find: "return r.owner_id === principal || (r.group_can_edit && !!r.group_id && groups.has(r.group_id));",
    replace: "return r.owner_id === principal || (!!r.group_id && groups.has(r.group_id));" },
  { id: "lists-ignore-groups", effect: "items shared with a group never appear in its members' lists",
    find: ".visibility = 'public' or \" +\n    t + \".group_id in (select group_id from group_member where user_id = $\" + n + \"::uuid))\";",
    replace: ".visibility = 'public')\";" },
  { id: "lists-show-everything", effect: "everyone's private items appear in everyone's lists",
    find: "return \"(\" + t + \".owner_id = $\" + n", replace: "return \"(true or \" + t + \".owner_id = $\" + n" },
  { id: "editor-reshares", effect: "someone allowed to edit can also delete the item or share it more widely",
    find: "return !!r.owner_id && r.owner_id === principal;", replace: "return !!r.owner_id && (r.owner_id === principal || r.group_can_edit);" },
  { id: "share-with-any-group", effect: "an owner can share with a group they do not belong to, reaching strangers",
    find: "if (groupId && !groups.has(groupId)) throw", replace: "if (false) throw" },
  { id: "public-not-public", effect: "an item shared with everyone is readable only by its group",
    find: "r.visibility === \"public\" ||", replace: "false ||" },
];

const dir = mkdtempSync(join(tmpdir(), "access-mutants-"));
let survived = 0;
try {
  for (const d of ["lib", "test", "db", "package.json", "tsconfig.json"]) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
  const original = readFileSync(join(ROOT, FILE), "utf8");
  const env = { ...process.env, DATABASE_URL: "", SUPABASE_DB_URL: "", PGLITE_DIR: "" };
  const run = () => spawnSync("node", ["--test", "test/custom-store.test.ts"], { cwd: dir, env, encoding: "utf8", timeout: 300_000 });
  if (run().status !== 0) throw new Error("the access tests fail on the unmodified code; fix that first");
  for (const m of MUTANTS) {
    if (!original.includes(m.find)) throw new Error(m.id + ": its code is no longer in " + FILE + "; update the mutant");
    writeFileSync(join(dir, FILE), original.replace(m.find, m.replace));
    const caught = run().status !== 0;
    if (!caught) survived++;
    console.log((caught ? "caught   " : "SURVIVED ") + m.id + " — " + m.effect);
  }
  writeFileSync(join(dir, FILE), original);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log((MUTANTS.length - survived) + " of " + MUTANTS.length + " planted access bugs caught");
process.exit(survived ? 1 : 0);
