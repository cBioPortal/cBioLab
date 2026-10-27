// The administrator's setting overrides (lib/settings.ts) on the in-process Postgres, as the app's
// role: an override wins over the environment and reverting returns to it, credentials and unusable
// values are refused, every change is logged, the fingerprint that keys the result cache moves with
// each change and with a cache clear, and the study routing is rebuilt under the new settings.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

process.env.PEER_LABEL = "from the environment";
process.env.CLICKHOUSE_PASSWORD = "env-secret";
process.env.CLICKHOUSE_URL = "https://user:env-secret@warehouse.invalid:8443";
process.env.LOOPBACK_PEER_TOKEN = "t".repeat(40);
for (const k of ["PEER_MCP", "STUDY_DENY", "MCP_DISCLOSE_PATIENTS", "VERCEL_ENV"]) delete process.env[k];

const { startPostgres } = await import("./support/postgres.ts");
const { userForEmail } = await import("../lib/users.ts");
const settings = await import("../lib/settings.ts");
const { isRestrictedStudy } = await import("../lib/federation.ts");
const { acceptedFromPeers } = await import("../lib/disclosure.ts");

const db = await startPostgres();
let admin: string;

before(async () => {
  admin = (await userForEmail("admin@example.org")).id;
});

describe("without the Next server, the environment is the whole answer", () => {
  test("setting() reads the variable and the store is never asked", async () => {
    await settings.refreshSettings(true);
    assert.equal(settings.setting("PEER_LABEL"), "from the environment");
    assert.equal(settings.settingsFingerprint(), "");
  });
});

describe("overrides", () => {
  before(() => settings.enableSettingOverrides());

  test("an override wins over the environment, and reverting returns to it", async () => {
    await settings.setSetting("PEER_LABEL", "  GENIE site  ", admin);
    assert.equal(settings.setting("PEER_LABEL"), "GENIE site");
    await settings.setSetting("PEER_LABEL", null, admin);
    assert.equal(settings.setting("PEER_LABEL"), "from the environment");
  });

  test("an empty override means the setting is empty, not the environment's", async () => {
    await settings.setSetting("PEER_LABEL", "", admin);
    assert.equal(settings.setting("PEER_LABEL"), "");
    await settings.setSetting("PEER_LABEL", null, admin);
  });

  test("credentials and unknown settings are refused", async () => {
    await assert.rejects(settings.setSetting("CLICKHOUSE_PASSWORD", "x", admin), /credentials/);
    await assert.rejects(settings.setSetting("CLICKHOUSE2_URL", "http://elsewhere.invalid", admin), /credentials/);
    await assert.rejects(settings.setSetting("LOOPBACK_PEER_URL", "http://elsewhere.invalid/api/mcp", admin), /cannot be changed here/);
    await assert.rejects(settings.setSetting("ANTHROPIC_API_KEY", "x", admin), /no setting/);
  });

  test("a value the app could not use is refused, naming what is wrong", async () => {
    await assert.rejects(settings.setSetting("MCP_DISCLOSE_PATIENTS", "genie_public:everything", admin), /unknown kind 'everything'/);
    await assert.rejects(settings.setSetting("PEER_MCP", "genie_public", admin), /not study=URL/);
    await assert.rejects(settings.setSetting("PEER_MCP", "genie_public=file:///etc/passwd", admin), /http\(s\)/);
    await assert.rejects(settings.setSetting("LOOPBACK_PEER", "c", admin), /a or b/);
    await assert.rejects(settings.setSetting("STUDY_ALLOW_RESTRICTED", "yes", admin), /1 or empty/);
    const n = (await db.query<{ n: number }>("select count(*)::int as n from app_setting where name in ('MCP_DISCLOSE_PATIENTS','PEER_MCP','LOOPBACK_PEER')")).rows[0].n;
    assert.equal(n, 0);
  });

  test("the rules federation reads come from the override", async () => {
    await settings.setSetting("PEER_MCP_PATIENT_LEVEL", "genie_public:timeline", admin);
    assert.deepEqual([...acceptedFromPeers().get("genie_public")!], ["timeline"]);
    await settings.setSetting("STUDY_DENY", "brca_tcga", admin);
    assert.equal(isRestrictedStudy("brca_tcga", "Breast"), true);
    await settings.setSetting("STUDY_DENY", null, admin);
    assert.equal(isRestrictedStudy("brca_tcga", "Breast"), false);
    await settings.setSetting("PEER_MCP_PATIENT_LEVEL", null, admin);
  });

  test("the fingerprint moves with every change and with a cache clear", async () => {
    const seen = new Set([settings.settingsFingerprint()]);
    await settings.setSetting("PEER_LABEL", "one", admin);
    seen.add(settings.settingsFingerprint());
    await settings.markResultCacheCleared(admin);
    seen.add(settings.settingsFingerprint());
    await settings.setSetting("PEER_LABEL", null, admin);
    seen.add(settings.settingsFingerprint());
    assert.equal(seen.size, 4);
  });

  test("a change runs the listeners, so the study routing is rebuilt", async () => {
    let ran = 0;
    settings.onSettingsChange("test", () => { ran++; });
    await settings.setSetting("STUDY_DENY", "x_study", admin);
    await settings.setSetting("STUDY_DENY", null, admin);
    assert.equal(ran, 2);
  });

  test("every change is logged with who made it, and the report never holds a secret", async () => {
    const r = await settings.settingsReport();
    assert.equal(r.databases[0].passwordSet, true);
    assert.ok(!JSON.stringify(r).includes("env-secret"));
    const token = r.rows.find((x) => x.name === "LOOPBACK_PEER_TOKEN")!;
    assert.equal(token.env, null);
    assert.equal(token.editable, false);
    assert.ok(r.log.length >= 10);
    assert.ok(r.log.every((l) => l.by === "admin@example.org"));
    assert.ok(r.cacheCleared);
  });

  test("the app's role cannot rewrite the log", async () => {
    const asApp = (sql: string) => db.transaction(async (tx) => { await tx.exec("set local role cohort_lab_app"); return tx.query(sql); });
    await assert.rejects(asApp("delete from app_setting_log"), /permission denied/);
    await assert.rejects(asApp("update app_setting_log set new_value = 'forged'"), /permission denied/);
  });
});
