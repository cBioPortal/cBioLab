"use client";
// The saved-work manager's Id lists tab: the stored id sets in the reader's saved work — lists they
// pasted, cohorts they locked, and others' shared with them. Anyone holding a link or document that
// names a set may read it (docs/LINKS.md); its owner alone withdraws it, with a note readers are
// shown and, optionally, the set to use instead, and may restore it. Withdrawing one set never
// touches another holding the same ids.
import { useCallback, useEffect, useState } from "react";
import { Download, RotateCcw, Ban } from "lucide-react";
import { api } from "../lab/api.ts";
import { Waiting } from "../_oncoprint/OncoprintCard.tsx";
import { Button } from "../_ui/button";
import { Choice } from "../_ui/choice";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Textarea } from "../_ui/textarea";
import { TB } from "../_ui/toolbar.ts";
import { cn } from "../../lib/cn";
import { WITHDRAWAL_NOTE_MAX } from "../../lib/id-set-withdrawal.ts";
import type { IdSetMeta } from "../../lib/id-set-store.ts";

const errorOf = async (res: Response): Promise<string> => (await res.json().catch(() => null))?.error || res.status + " " + res.statusText;
const day = (iso: string) => iso.slice(0, 10);
const plural = (n: number, one: string) => n.toLocaleString("en-US") + " " + one + (n === 1 ? "" : "s");

/** The reader's sets, their own withdrawn ones included; reloaded after every change. */
function useIdSets() {
  const [sets, setSets] = useState<IdSetMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.idSets.list({ withdrawn: true });
      if (!res.ok) throw new Error(await errorOf(res));
      setSets((await res.json()).sets);
    } catch (e) { setError(String((e as Error)?.message || e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { sets, error, reload: load };
}

export function ListsPanel() {
  const { sets, error, reload } = useIdSets();
  const [withdrawing, setWithdrawing] = useState<IdSetMeta | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const restore = async (s: IdSetMeta) => {
    setBusy(s.id); setErr(null);
    try { const res = await api.idSets.restore(s.id); if (!res.ok) throw new Error(await errorOf(res)); await reload(); }
    catch (e) { setErr("Could not restore “" + s.name + "”: " + String((e as Error)?.message || e)); }
    finally { setBusy(null); }
  };
  return (
    <section className="card m-0" data-id-lists>
      <h2>Id lists{sets?.length ? " (" + sets.length + ")" : ""}<span className="plain"> — yours, and others&apos; shared with you</span></h2>
      <p className="meta flush">
        A stored list never changes. Anyone with a link or analysis that names it can read its ids; only the person who
        saved it can withdraw it. Withdrawing tells everyone who opens something using it who withdrew it, when and why —
        another list holding the same ids is not affected.
      </p>
      {error ? <p className="error">could not load your id lists: {error} <Button variant="link" size="inline" onClick={() => void reload()}>retry</Button></p>
        : !sets ? <p className="note"><Waiting what="your id lists" /></p>
        : !sets.length ? <p className="note">No stored id lists yet. Lists you paste (+ Add cohort → From a list of ids), cohorts you lock, and long
            selections you save while signed in are stored here.</p>
        : <div className="attrtablewrap">
            <table className="attrtable customlist">
              <thead><tr><th>List</th><th>Ids</th><th>Studies</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {sets.map((s) => (
                  <tr key={s.id} data-set={s.id} style={{ cursor: "default" }}>
                    <td><b>{s.name}</b> <span className="meta">{s.kind === "lock" ? "locked cohort" : "list"} · saved {day(s.createdAt)}
                      {s.rights.share ? "" : " · from " + s.ownerEmail}</span>
                      <span className="meta mono block">{s.id}</span></td>
                    <td className="meta">{plural(s.count, s.level)}</td>
                    <td className="meta">{s.studies.join(", ")}</td>
                    <td className="meta" data-status={s.withdrawal ? "withdrawn" : "in use"}>
                      {s.withdrawal
                        ? <><span className="text-destructive">withdrawn {day(s.withdrawal.at)}</span>
                            {s.withdrawal.note && <>: {s.withdrawal.note}</>}
                            {s.withdrawal.replacedBy && <> · use “{s.withdrawal.replacedBy.name}” instead</>}</>
                        : "in use"}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {!s.withdrawal && <><Button asChild variant="outline" size="sm" className={TB}>
                        <a href={"/api/id-sets/" + s.id + "?ids=1"} download={s.id + ".txt"} data-tip="its ids, one study:id per line"><Download />Export</a></Button>{" "}</>}
                      {s.rights.share && (s.withdrawal
                        ? <Button variant="outline" size="sm" className={TB} disabled={!!busy} onClick={() => void restore(s)}
                            data-tip="put it back in use: links and analyses naming it read it again"><RotateCcw />Restore</Button>
                        : <Button variant="outline" size="sm" className={cn(TB, "text-destructive hover:text-destructive")} disabled={!!busy}
                            onClick={() => setWithdrawing(s)}><Ban />Withdraw…</Button>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      {busy && <p className="meta"><span className="spinner" /> restoring…</p>}
      {err && <p className="error">{err}</p>}
      {withdrawing && <WithdrawDialog set={withdrawing} others={(sets || []).filter((x) => x.id !== withdrawing.id && !x.withdrawal && x.level === withdrawing.level)}
        onClose={() => setWithdrawing(null)} onDone={() => { setWithdrawing(null); void reload(); }} />}
    </section>
  );
}

/** Withdraw one set: what uses it, the note readers will see, and the set to point them to. */
function WithdrawDialog({ set, others, onClose, onDone }: { set: IdSetMeta; others: IdSetMeta[]; onClose: () => void; onDone: () => void }) {
  const [usage, setUsage] = useState<{ cohorts: number; analyses: number; links: number } | null>(null);
  const [usageErr, setUsageErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [replacedBy, setReplacedBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    api.idSets.usage(set.id, { signal: ctl.signal })
      .then(async (res) => { if (!res.ok) throw new Error(await errorOf(res)); setUsage((await res.json()).usage); })
      .catch((e) => { if (!ctl.signal.aborted) setUsageErr(String((e as Error)?.message || e)); });
    return () => ctl.abort();
  }, [set.id]);
  const tooLong = note.trim().length > WITHDRAWAL_NOTE_MAX;
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await api.idSets.withdraw(set.id, { note, replacedBy: replacedBy || null });
      if (!res.ok) throw new Error(await errorOf(res));
      onDone();
    } catch (e) { setErr(String((e as Error)?.message || e)); setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-tw aria-describedby={undefined} className="gap-3 sm:max-w-lg" data-withdraw-dialog>
        <DialogHeader><DialogTitle className="text-base">Withdraw “{set.name}”</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (!tooLong) void submit(); }}>
          <p className="m-0 text-md" data-usage>
            {usageErr ? <span className="error">could not count what uses it: {usageErr}</span>
              : !usage ? <Waiting what="what uses it" />
              : <>It is named by {usage.analyses === 1 ? "1 saved analysis" : usage.analyses.toLocaleString("en-US") + " saved analyses"}, {plural(usage.cohorts, "saved cohort")} and{" "}
                  {plural(usage.links, "stored link")}, counted across everyone&apos;s saved work. Each of them — and any ?doc= link naming it — will be
                  refused with your note until you restore it.</>}
          </p>
          <label className="grid gap-1 text-md">Why (shown to everyone who opens something that uses it)
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="e.g. pilot patients were included by mistake" />
            {tooLong && <span className="error text-sm">at most {WITHDRAWAL_NOTE_MAX} characters; this has {note.trim().length}</span>}
          </label>
          <div className="grid gap-1 text-md">
            <span>Use instead (optional)</span>
            {others.length
              ? <Choice value={replacedBy} onChange={setReplacedBy} placeholder="no replacement" title="replacement list" className="w-full"
                  options={[["", "no replacement"] as const, ...others.map((o) => [o.id, o.name + " (" + plural(o.count, o.level) + ")"] as const)]} />
              : <span className="meta">none of your other {set.level} lists is in use to point to</span>}
          </div>
          {err && <p className="error m-0">{err}</p>}
          <DialogFooter className="items-center">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={busy || tooLong} data-tip={tooLong ? "the note is too long" : undefined}>
              {busy ? "withdrawing…" : "Withdraw"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
