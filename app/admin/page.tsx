"use client";
// /admin — for the users in ADMIN_EMAILS (lib/auth.ts), reached from the account menu: clear the
// result cache, and see and change the federation settings for the whole deployment
// (lib/settings.ts, app/api/admin/route.ts). A change applies to every server process within a few
// seconds and gives every cached result a new key, so nothing computed under the old settings is
// served under the new ones.
import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { SiteHeader } from "../_ui/site-header.tsx";
import { Button } from "../_ui/button";
import { Input } from "../_ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../_ui/select";
import { Checkbox } from "../_ui/checkbox";
import { ErrorAlert } from "../_ui/error-alert.tsx";
import { TB } from "../_ui/toolbar.ts";
import type { SettingGroup, SettingRow, SettingsReport } from "../../lib/settings.ts";

const GROUPS: { key: SettingGroup; title: string; about: string }[] = [
  { key: "databases", title: "Databases", about: "The warehouses this instance queries directly. Their addresses and credentials are read from the environment and cannot be changed here." },
  { key: "peers", title: "Federation peers", about: "Studies this instance reaches through another cbio-lab instance's federation API (/api/federation/v1), which answers with aggregates only." },
  { key: "patient-level", title: "Patient-level federation", about: "The opt-in exception to aggregate-only federation (docs/DATA-BOUNDARY.md): data crosses only where the peer discloses a kind and the coordinator accepts it." },
  { key: "access", title: "Access", about: "Which studies are routed at all, and which are treated as aggregate-only." },
];

async function call(init?: RequestInit): Promise<SettingsReport> {
  const r = await fetch("/api/admin", init && { ...init, headers: { "content-type": "application/json" } });
  const j = await r.json().catch(() => ({ error: "the server answered " + r.status }));
  if (!r.ok || j.error) throw new Error(j.error || "the server answered " + r.status);
  return j;
}
const post = (body: object) => call({ method: "POST", body: JSON.stringify(body) });

const when = (iso: string) => new Date(iso).toLocaleString();

export default function AdminPage() {
  const [report, setReport] = useState<SettingsReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setReport(await call()); setErr(null); }
    catch (e) { setErr(String((e as Error).message || e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  /** run one change; the answer is the report after it */
  const act = async (key: string, body: object): Promise<boolean> => {
    setBusy(key); setErr(null);
    try { setReport(await post(body)); return true; }
    catch (e) { setErr(String((e as Error).message || e)); return false; }
    finally { setBusy(null); }
  };

  const clearCache = () => {
    if (confirm("Clear the result cache for the whole deployment? Every analysis, Explore page and study list is computed again on its next request."))
      void act("cache", { action: "clearCache" });
  };

  return <>
    <SiteHeader page="administration — result cache and federation settings" />
    <main className="repro-page admin-page">
      <div className="repro-intro">
        <h1>Admin</h1>
        <p className="lede">
          Settings here apply to the whole deployment, for everyone, within a few seconds of saving. A changed setting
          gives every cached result a new key, so nothing computed under the old settings is served under the new ones.
        </p>
      </div>
      {err && <ErrorAlert>{err}</ErrorAlert>}
      {!report && !err && <p className="meta"><Loader2 className="inline size-4 animate-spin" /> loading…</p>}
      {report && <>
        <section className="admin-section" aria-labelledby="cache-h">
          <h2 id="cache-h">Result cache</h2>
          <p>
            Analyses, oncoprints, Explore, study catalogs and the study list are cached for a day and shared by every reader
            (Vercel&apos;s Runtime Cache in production, each server&apos;s own memory elsewhere). A data import, a new OncoKB
            release and a deploy already clear it; clear it by hand after anything else that changes answers.
          </p>
          <p className="meta">
            {report.cacheCleared ? <>Last cleared {when(report.cacheCleared.at)}{report.cacheCleared.by && <> by {report.cacheCleared.by}</>}.</> : "Not cleared from here yet."}
          </p>
          <Button variant="outline" size="sm" className={TB} onClick={clearCache} disabled={!!busy || !!report.unavailable}
            data-tip={report.unavailable ? "unavailable: " + report.unavailable : "clear every cached result, on every server"}>
            {busy === "cache" ? <Loader2 className="animate-spin" /> : <Trash2 />}Clear the cache
          </Button>
        </section>

        <section className="admin-section" aria-labelledby="fed-h">
          <h2 id="fed-h">Federation settings</h2>
          {report.unavailable
            ? <p className="error">Read-only: {report.unavailable}. The values below are the environment&apos;s.</p>
            : <p className="meta">A value saved here overrides the environment variable of the same name until it is reverted.
                Leave a field empty and save to override the variable with nothing.</p>}
          {GROUPS.map((gr) => (
            <div key={gr.key} className="admin-group">
              <h3>{gr.title}</h3>
              <p className="meta">{gr.about}</p>
              {gr.key === "databases" && (
                <table className="admin-table">
                  <thead><tr><th scope="col">connection</th><th scope="col">address</th><th scope="col">user · database · password</th></tr></thead>
                  <tbody>
                    {report.databases.map((d) => (
                      <tr key={d.id}>
                        <td><code>{d.id}</code> {d.label}</td>
                        <td><Value v={d.url || null} /></td>
                        <td><Value v={d.user || null} /> · <Value v={d.db || null} /> · <span className="meta">{d.passwordSet ? "password set (hidden)" : "no password"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <table className="admin-table">
                <thead><tr><th scope="col">setting</th><th scope="col">environment</th><th scope="col">in force</th></tr></thead>
                <tbody>
                  {report.rows.filter((r) => r.group === gr.key).map((r) => (
                    <SettingLine key={r.name} row={r} busy={busy === r.name}
                      onSave={(value) => {
                        if (r.group === "patient-level" && !confirm("Change " + r.name + " for the whole deployment? It decides which patient-level data crosses between instances."))
                          return Promise.resolve(false);
                        return act(r.name, { action: "set", name: r.name, value });
                      }}
                      onReset={() => act(r.name, { action: "reset", name: r.name })} />
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>

        {report.log.length > 0 && (
          <section className="admin-section" aria-labelledby="log-h">
            <h2 id="log-h">Recent changes</h2>
            <table className="admin-table">
              <thead><tr><th scope="col">when</th><th scope="col">who</th><th scope="col">setting</th><th scope="col">from</th><th scope="col">to</th></tr></thead>
              <tbody>
                {report.log.map((l, i) => (
                  <tr key={i}>
                    <td className="meta">{when(l.at)}</td><td>{l.by ?? "—"}</td><td><code>{l.name}</code></td>
                    <td><Value v={l.old} /></td><td>{l.new == null ? <span className="meta">reverted to environment</span> : <Value v={l.new} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </>}
    </main>
  </>;
}

function Value({ v }: { v: string | null | undefined }) {
  if (v == null) return <span className="meta">not set</span>;
  if (v === "") return <span className="meta">empty</span>;
  return <code className="admin-value">{v}</code>;
}

/** One setting: what the environment says, what is in force, and (when editable) a field that owns its draft. */
function SettingLine({ row, busy, onSave, onReset }: {
  row: SettingRow; busy: boolean; onSave: (value: string) => Promise<boolean>; onReset: () => void;
}) {
  const current = row.override ? row.override.value : row.env ?? "";
  const [draft, setDraft] = useState(current);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(current); }, [current, editing]);
  const env = row.secret ? <span className="meta">{row.envSet ? "set (hidden)" : "not set"}</span> : <Value v={row.env} />;

  return (
    <tr className={row.override ? "overridden" : undefined}>
      <td>
        <code>{row.name}</code>
        <div className="meta">{row.help}</div>
      </td>
      <td>{env}</td>
      <td>
        {!row.editable && (row.override ? <Value v={row.override.value} /> : <span className="meta">{row.secret ? "—" : "the environment's"}</span>)}
        {row.editable && !editing && <div className="flex flex-wrap items-center gap-2">
          {row.override ? <Value v={row.override.value} /> : <span className="meta">the environment&apos;s</span>}
          <Button variant="ghost" size="sm" className={TB} onClick={() => setEditing(true)} disabled={busy}
            aria-label={"edit " + row.name}>edit</Button>
          {row.override && <Button variant="ghost" size="sm" className={TB} onClick={onReset} disabled={busy}
            data-tip={"remove the override; " + row.name + " is the environment's again"}>
            {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />}revert</Button>}
        </div>}
        {row.editable && editing && <form className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); void onSave(draft).then((ok) => { if (ok) setEditing(false); }); }}>
          <Field row={row} draft={draft} setDraft={setDraft} />
          <Button type="submit" size="sm" className={TB} disabled={busy}>{busy && <Loader2 className="animate-spin" />}save</Button>
          <Button type="button" variant="ghost" size="sm" className={TB} onClick={() => { setDraft(current); setEditing(false); }}>cancel</Button>
        </form>}
        {row.override && <div className="meta">overridden {when(row.override.at)}</div>}
      </td>
    </tr>
  );
}

// a Select item's value may not be empty, and "off"/"none" is the empty value
const EMPTY = "\u0000empty";

/** The draft's editor: one of the setting's choices, any number of them, or free text. */
function Field({ row, draft, setDraft }: { row: SettingRow; draft: string; setDraft: (v: string) => void }) {
  if (row.choices && row.multi) {
    const picked = new Set(draft.split(/[,\s]+/).filter(Boolean));
    const toggle = (v: string, on: boolean) =>
      setDraft(row.choices!.filter((c) => (c.value === v ? on : picked.has(c.value))).map((c) => c.value).join(","));
    return <fieldset className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1" aria-label={row.name}>
      {row.choices.map((c) => (
        <label key={c.value} className="flex items-center gap-2 text-sm">
          <Checkbox checked={picked.has(c.value)} onCheckedChange={(on) => toggle(c.value, on === true)} />{c.label}
        </label>
      ))}
      {picked.size === 0 && <span className="meta">none</span>}
    </fieldset>;
  }
  if (row.choices) {
    const known = row.choices.some((c) => c.value === draft);
    return <Select value={known ? draft || EMPTY : undefined} onValueChange={(v) => setDraft(v === EMPTY ? "" : v)}>
      <SelectTrigger size="sm" className="min-w-60 flex-1" aria-label={row.name}>
        <SelectValue placeholder={draft ? "not a choice: " + draft : "choose"} />
      </SelectTrigger>
      <SelectContent>
        {row.choices.map((c) => <SelectItem key={c.value} value={c.value || EMPTY}>{c.label}</SelectItem>)}
      </SelectContent>
    </Select>;
  }
  return <Input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={row.name} autoFocus
    className="h-8 min-w-60 flex-1 font-mono text-sm" />;
}
