// What the data looks like right now, as one string: what the result cache (lib/next-cache.ts)
// and the per-process memos (lib/data-memo.ts) are keyed by, so new data means new keys. Kept apart
// from lib/next-cache.ts, which only the Next runtime can load, so the CLI and MCP server read it too.
import { chQuery, directConnections, loopbackOnlyConn } from "./ch.ts";
import { oncokbPin } from "./annotation.ts";
import { onSettingsChange } from "./settings.ts";

let versionMemo: { at: number; value: Promise<string> } | null = null;
/**
 * What the data looks like right now: the latest study import in every cBioPortal database on
 * every instance, plus the OncoKB release. Asked at most once a minute per instance.
 */
export function dataVersion(): Promise<string> {
  if (versionMemo && Date.now() - versionMemo.at < 60_000) return versionMemo.value;
  const value = (async () => {
    const parts: string[] = [];
    // not the simulated peer's database, which is read only through the federation API: like a real peer's, its
    // reloads reach this cache when entries expire
    const peerDb = loopbackOnlyConn()?.db;
    for (const conn of directConnections()) {
      const dbs = await chQuery<{ name: string }>("SELECT name FROM system.databases WHERE name LIKE 'cbioportal%' ORDER BY name", conn);
      for (const { name } of dbs.data.filter((d) => d.name !== peerDb)) {
        const r = await chQuery<{ m: string }>("SELECT toString(max(import_date)) AS m FROM " + name + ".cancer_study", conn);
        parts.push(conn.id + ":" + name + "@" + (r.data[0]?.m ?? ""));
      }
    }
    parts.push("oncokb@" + ((await oncokbPin()) ?? ""));
    return parts.join("|");
  })();
  versionMemo = { at: Date.now(), value };
  // a failed lookup must not stick for the next minute
  value.catch(() => { if (versionMemo?.value === value) versionMemo = null; });
  return value;
}
// a cleared cache or a changed setting asks the databases again
onSettingsChange("data-version", () => { versionMemo = null; });
