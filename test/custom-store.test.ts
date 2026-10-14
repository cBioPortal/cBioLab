// Server-stored custom data and saved artifacts on the fallback a deployment without DATABASE_URL
// gets — lib/db.ts's own in-process Postgres, migrated on first use (the contracts in
// test/support/store-contracts.ts; test/postgres.db-test.ts runs the same ones on a Postgres the
// test hands the stores). The session itself is test/auth.test.ts.

delete process.env.SUPABASE_DB_URL;
delete process.env.DATABASE_URL;
const { customStoreContract, artifactContract, userContract, sharingContract } = await import("./support/store-contracts.ts");

customStoreContract("in-process fallback");
artifactContract("in-process fallback");
userContract("in-process fallback");
sharingContract("in-process fallback");
export {};
