// Give the rows saved before there were accounts — saved cohorts and analyses, custom datasets,
// all without an owner since db/migrations/0004_users.sql — to one user, as their private rows
// (lib/users.ts claimLegacy). The user is found by email, or created to be claimed at their first
// sign-in. Until this runs nobody sees those rows. Run once per deployment, after db:migrate:
//   npm run db:claim-legacy -- someone@example.org
//   npm run db:claim-legacy -- someone@example.org --dry-run    counts, changes nothing
import { claimLegacy } from "../lib/users.ts";

const email = process.argv.slice(2).find((a) => !a.startsWith("--"));
const dry = process.argv.includes("--dry-run");
try {
  const r = await claimLegacy(email, dry);
  console.log((dry ? "would give " + email : "gave " + r.user!.email + " (" + r.user!.id + ")") +
    ": " + r.artifacts + " saved cohorts/analyses, " + r.datasets + " custom datasets");
  process.exit(0);
} catch (e) {
  console.error(String((e as Error)?.message || e));
  process.exit(1);
}
