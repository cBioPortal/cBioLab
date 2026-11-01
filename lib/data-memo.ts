// Per-process memos of facts read from the studies — a study's profiles, which studies each
// instance holds — held to the result cache's rules (lib/next-cache.ts), so nothing read from the
// data outlives the data:
//   - new data: a memo is good only while `dataVersion()` is what it was when the memo was taken
//     (a study imported, a new OncoKB release; looked up at most once a minute)
//   - an administrator (/admin): a changed setting or a cleared cache changes `settingsFingerprint()`
//   - time: a memo is never older than a day
//   - RESULT_CACHE=off: nothing is kept, every reader reads the data
// A memo whose version cannot be read is not trusted: the reader reads the data.
import { dataVersion } from "./data-version.ts";
import { refreshSettings, settingsFingerprint } from "./settings.ts";

const MAX_AGE_MS = 24 * 3600_000;

/** Whether nothing read from the data may be kept (RESULT_CACHE=off). */
export const keepNothing = (): boolean => process.env.RESULT_CACHE === "off";

/** The data and settings a memo is taken under; null when they cannot be read. */
export async function memoVersion(): Promise<string | null> {
  try {
    await refreshSettings();
    return (await dataVersion()) + "|settings@" + settingsFingerprint();
  } catch {
    return null;
  }
}

/** Values read from the data, by key, each good while the data and settings it was read under are. */
export class DataMemo<V> {
  private readonly entries = new Map<string, { version: string; at: number; value: V }>();

  /** The value kept for `key`, if it was read under `version` and is less than a day old. */
  fresh(key: string, version: string | null): V | undefined {
    const e = version === null || keepNothing() ? undefined : this.entries.get(key);
    return e && e.version === version && Date.now() - e.at < MAX_AGE_MS ? e.value : undefined;
  }

  /** Keeps `value` for `key`, read under `version` (nothing is kept without one, or with RESULT_CACHE=off). */
  put(key: string, version: string | null, value: V): void {
    if (version === null || keepNothing()) return;
    this.entries.set(key, { version, at: Date.now(), value });
  }

  /** The value for `key`: kept, or read by `load` (and kept). */
  async get(key: string, load: () => Promise<V>): Promise<V> {
    const version = keepNothing() ? null : await memoVersion();
    const kept = this.fresh(key, version);
    if (kept !== undefined) return kept;
    const value = await load();
    this.put(key, version, value);
    return value;
  }
}
