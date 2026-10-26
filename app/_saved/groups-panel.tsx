"use client";
// The saved-work manager's Groups tab (lib/groups.ts): the reader's groups, making one, and — for
// the one chosen — its members. Admins add people, found by name or email among those who have
// signed in, or by any email (they join when they first sign in); make them admins, remove them,
// rename and delete the group; anyone may leave. Sharing with a group happens on the item (its
// "share…"), not here.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Waiting } from "../_oncoprint/OncoprintCard.tsx";
import { api } from "../lab/api.ts";
import { answer, useGroups, useGroup, type Group } from "../lab/use-groups.ts";
import type { User } from "../../lib/users.ts";
import { cn } from "../../lib/cn";
import { Button } from "../_ui/button";
import { Choice } from "../_ui/choice";
import { Input } from "../_ui/input";
import { FIELD, TB } from "../_ui/toolbar.ts";

const ROW = "flex flex-wrap items-center gap-1.5";
const META = "text-sm text-muted-foreground";

/** `me`: the signed-in reader's id */
export function GroupsPanel({ me }: { me: string }) {
  const groups = useGroups(me);
  const [chosen, setChosen] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();

  const create = async () => {
    setErr(null);
    try {
      const { group } = await answer<{ group: Group }>(await api.groups.create({ name: newName.trim() }));
      setNewName(""); await groups.changed(); setChosen(group.id);
    } catch (e) { setErr(String((e as Error)?.message || e)); }
  };
  const current = chosen ?? groups.groups?.[0]?.id ?? null;

  return (
    <div className="groups grid items-start gap-4 md:grid-cols-[minmax(14rem,1fr)_2fr]">
      <section className="card m-0 grid gap-2.5">
        <h2 className="m-0">Your groups</h2>
        {groups.pending ? <Waiting what="your groups" />
          : groups.error ? <p className="error m-0">could not load your groups: {groups.error}{" "}
              <Button variant="link" size="inline" onClick={groups.retry}>retry</Button></p>
          : !groups.groups!.length ? <p className="note m-0">You are in no groups yet.</p>
          : <ul className="grouplist m-0 grid list-none gap-1 p-0">{groups.groups!.map((g) => (
              <li key={g.id} className="text-md">
                <Button variant="link" size="inline" className={cn("text-md", g.id === current && "active font-semibold no-underline")}
                  aria-current={g.id === current || undefined} onClick={() => setChosen(g.id)}>{g.name}</Button>
                <span className={META}> {g.members} member{g.members === 1 ? "" : "s"}{g.role === "admin" ? " · you are an admin" : ""}</span></li>))}
            </ul>}
        <form className={ROW} onSubmit={(e) => { e.preventDefault(); if (newName.trim()) void create(); }}>
          <Input className={cn(FIELD, "w-auto flex-1")} value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="new group name…" aria-label="new group name" />
          <Button variant="outline" size="sm" className={TB} type="submit" disabled={!newName.trim()}>Make group</Button>
        </form>
        {err && <p className="error m-0">{err}</p>}
      </section>
      {current && <GroupCard key={current} me={me} id={current}
        onGone={async () => { setChosen(null); await groups.changed(); }}
        onChanged={() => void qc.invalidateQueries({ queryKey: ["groups"] })} />}
    </div>
  );
}

function GroupCard({ me, id, onGone, onChanged }: { me: string; id: string; onGone: () => Promise<void>; onChanged: () => void }) {
  const { group, pending, error } = useGroup(me, id);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [rename, setRename] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (f: () => Promise<Response>, after?: () => unknown) => {
    setBusy(true); setErr(null);
    try { await answer(await f()); await after?.(); onChanged(); }
    catch (e) { setErr(String((e as Error)?.message || e)); }
    finally { setBusy(false); }
  };
  if (pending) return <section className="card m-0"><Waiting what="the group" /></section>;
  if (error || !group) return <section className="card m-0"><p className="error m-0">{error || "no such group"}</p></section>;
  const admin = group.role === "admin";

  return (
    <section className="card groupcard m-0 grid gap-2.5">
      {rename === null
        ? <h2 className="m-0 flex items-baseline gap-2.5">{group.name}
            {admin && <Button variant="link" size="inline" className="font-normal" onClick={() => setRename(group.name)}>rename</Button>}</h2>
        : <form className={ROW} onSubmit={(e) => { e.preventDefault(); void act(() => api.groups.update(id, { name: rename }), () => setRename(null)); }}>
            <Input className={cn(FIELD, "w-auto flex-1")} value={rename} onChange={(e) => setRename(e.target.value)} aria-label="group name" autoFocus />
            <Button variant="outline" size="sm" className={TB} type="submit" disabled={!rename.trim() || busy}>Save</Button>
            <Button variant="ghost" size="sm" className={TB} type="button" onClick={() => setRename(null)}>Cancel</Button>
          </form>}
      <p className={cn(META, "m-0")}>{group.members} member{group.members === 1 ? "" : "s"}. Members see what is shared with the group; admins manage who is in it.</p>
      <table className="membertable w-full border-collapse text-sm">
        <thead><tr className="text-left">
          <th className="border-b px-2 py-1">member</th><th className="border-b px-2 py-1">role</th><th className="border-b px-2 py-1"><span className="sr-only">actions</span></th>
        </tr></thead>
        <tbody>{group.memberList.map((m) => (
          <tr key={m.id}>
            <td className="border-b px-2 py-1">{m.name ? <>{m.name} <span className={META}>{m.email}</span></> : m.email}
              {m.id === me && <span className={META}> (you)</span>}
              {!m.signedIn && <span className={META} title="added by email; they become a member when they first sign in"> · not signed in yet</span>}</td>
            <td className="border-b px-2 py-1">{m.role}</td>
            <td className="border-b px-2 py-1 text-right whitespace-nowrap">
              <span className="inline-flex gap-2.5">
                {admin && m.id !== me && <Button variant="link" size="inline" disabled={busy}
                  onClick={() => void act(() => api.groups.setRole(id, m.id, m.role === "admin" ? "member" : "admin"))}>
                  {m.role === "admin" ? "make member" : "make admin"}</Button>}
                {admin && m.id !== me && <Button variant="link" size="inline" disabled={busy}
                  onClick={() => void act(() => api.groups.removeMember(id, m.id))}>remove</Button>}
                {m.id === me && <Button variant="link" size="inline" disabled={busy}
                  onClick={() => { if (confirm("Leave “" + group.name + "”? You will stop seeing what is shared with it.")) void act(() => api.groups.removeMember(id, me), onGone); }}>leave</Button>}
              </span>
            </td>
          </tr>))}
        </tbody>
      </table>
      {admin && <form className={ROW} onSubmit={(e) => { e.preventDefault(); void act(() => api.groups.addMember(id, { email: email.trim(), role }), () => setEmail("")); }}>
        <PersonSearch value={email} onChange={setEmail} skip={group.memberList.map((m) => m.email)} />
        <Choice size="ctl" value={role} onChange={(v) => setRole(v as "member" | "admin")} title="role"
          options={[["member", "member"], ["admin", "admin"]]} />
        <Button variant="outline" size="sm" className={TB} type="submit" disabled={!email.trim() || busy}>Add</Button>
      </form>}
      {err && <p className="error m-0">{err}</p>}
      {admin && <p className="m-0"><Button variant="link" size="inline" className="text-destructive" disabled={busy}
        onClick={() => { if (confirm("Delete “" + group.name + "”? Everything shared with it becomes private to its owner again.")) void act(() => api.groups.remove(id), onGone); }}>delete this group</Button></p>}
    </section>
  );
}

/** People found as the text is typed: those who have signed in, by email prefix or a word of their name. */
function usePeople(text: string): { people: User[]; error: string | null } {
  const [found, setFound] = useState<{ q: string; people: User[]; error: string | null }>({ q: "", people: [], error: null });
  const q = text.trim();
  useEffect(() => {
    if (q.length < 2) return;
    const ctl = new AbortController();
    // a pause in the typing, not every keystroke, asks the server
    const t = setTimeout(() => {
      api.users.search(q, { signal: ctl.signal })
        .then((r) => answer<{ users: User[] }>(r))
        .then((j) => setFound({ q, people: j.users, error: null }))
        .catch((e) => { if (!ctl.signal.aborted) setFound({ q, people: [], error: String((e as Error)?.message || e) }); });
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);
  return found.q === q && q.length >= 2 ? found : { people: [], error: null };
}

/**
 * The email to add, with the people it matches listed under it as it is typed; choosing one fills
 * in their email. Anyone not listed can still be added by their full email, and joins the group
 * when they first sign in. `skip`: the group's members already, never offered.
 */
function PersonSearch({ value, onChange, skip }: { value: string; onChange: (email: string) => void; skip: string[] }) {
  const { people, error } = usePeople(value);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const offered = people.filter((p) => !skip.includes(p.email) && p.email !== value.trim().toLowerCase());
  const shown = open && offered.length > 0;
  const choose = (p: User) => { onChange(p.email); setOpen(false); };
  return (
    <div className="relative w-auto min-w-64 flex-1">
      <Input type="text" className={FIELD} value={value} autoComplete="off" role="combobox" aria-expanded={shown}
        aria-controls="person-search-list" aria-autocomplete="list" aria-label="person to add"
        placeholder="add someone: name or email…"
        onChange={(e) => { onChange(e.target.value); setOpen(true); setAt(0); }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!shown) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setAt((i) => (i + (e.key === "ArrowDown" ? 1 : offered.length - 1)) % offered.length); }
          else if (e.key === "Enter") { e.preventDefault(); choose(offered[Math.min(at, offered.length - 1)]); }
          else if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
        }} />
      {shown && <ul id="person-search-list" role="listbox" aria-label="people who have signed in"
        className="absolute top-full right-0 left-0 z-20 m-0 mt-1 max-h-64 list-none overflow-auto rounded-md border bg-popover p-1 shadow-md">
        {offered.map((p, i) => (
          <li key={p.id} role="option" aria-selected={i === at}
            className={cn("cursor-pointer rounded-sm px-2 py-1 text-md", i === at && "bg-accent text-accent-foreground")}
            onMouseEnter={() => setAt(i)} onMouseDown={(e) => { e.preventDefault(); choose(p); }}>
            {p.name ? <>{p.name} <span className={META}>{p.email}</span></> : p.email}
          </li>))}
      </ul>}
      {error && <p className="error m-0 text-sm">could not search: {error}</p>}
    </div>
  );
}
