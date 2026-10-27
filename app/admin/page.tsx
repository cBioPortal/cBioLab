"use client";
// /admin — for the users in ADMIN_EMAILS (lib/auth.ts), reached from the account menu: clear the
// result cache (app/api/admin/route.ts).
import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { SiteHeader } from "../_ui/site-header.tsx";
import { Button } from "../_ui/button";
import { ErrorAlert } from "../_ui/error-alert.tsx";
import { TB } from "../_ui/toolbar.ts";

async function call<T>(init?: RequestInit): Promise<T> {
  const r = await fetch("/api/admin", init && { ...init, headers: { "content-type": "application/json" } });
  const j = await r.json().catch(() => ({ error: "the server answered " + r.status }));
  if (!r.ok || j.error) throw new Error(j.error || "the server answered " + r.status);
  return j;
}

export default function AdminPage() {
  const [admin, setAdmin] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cleared, setCleared] = useState<string | null>(null);

  useEffect(() => {
    call<{ admin: string }>().then((j) => setAdmin(j.admin), (e) => setErr(String((e as Error).message || e)));
  }, []);

  const clearCache = async () => {
    if (!confirm("Clear the result cache for the whole deployment? Every analysis, Explore page and study list is computed again on its next request.")) return;
    setBusy(true); setErr(null);
    try { setCleared((await call<{ cleared: string }>({ method: "POST", body: JSON.stringify({ action: "clearCache" }) })).cleared); }
    catch (e) { setErr(String((e as Error).message || e)); }
    finally { setBusy(false); }
  };

  return <>
    <SiteHeader page="administration" />
    <main className="repro-page">
      <div className="repro-intro">
        <h1>Admin</h1>
        <p className="lede">What you do here applies to the whole deployment, for everyone.</p>
      </div>
      {err && <ErrorAlert>{err}</ErrorAlert>}
      {!admin && !err && <p className="meta"><Loader2 className="inline size-4 animate-spin" /> loading…</p>}
      {admin && (
        <section className="admin-section" aria-labelledby="cache-h">
          <h2 id="cache-h">Result cache</h2>
          <p>
            Analyses, oncoprints, Explore, study catalogs, the study list and the data sets page are cached for a day and
            shared by every reader: in Vercel&apos;s Runtime Cache in production, shared by every function instance; elsewhere
            in the memory of each server process, so clearing it here clears the process that answers. A data import, a new
            OncoKB release and a deploy already clear it; clear it by hand after anything else that changes answers.
          </p>
          <Button variant="outline" size="sm" className={TB} onClick={() => void clearCache()} disabled={busy}
            title="expire every cached result; each is computed again on its next request">
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}Clear the cache
          </Button>
          {cleared && <p className="meta" role="status">Cleared at {new Date(cleared).toLocaleString()}.</p>}
        </section>
      )}
    </main>
  </>;
}
