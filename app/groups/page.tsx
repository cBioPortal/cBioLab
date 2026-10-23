"use client";
// Groups, managed by their members (lib/groups.ts): the reader's groups, making one, and — for the
// one chosen — its members. Admins add people by email (signed in yet or not), make them admins,
// remove them, rename and delete the group; anyone may leave. Sharing with a group happens on the
// item (the Saved tab's "share…"), not here.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCustomDataState } from "../lab/custom-data-panel.tsx";
import { SiteHeader } from "../_ui/site-header.tsx";
import { requestLogin } from "../lab/custom-data-client.ts";
import { Waiting } from "../_oncoprint/OncoprintCard.tsx";
import { api } from "../lab/api.ts";
import { answer, useGroups, useGroup, type Group } from "../lab/use-groups.ts";
import { cn } from "../../lib/cn";
import { Button } from "../_ui/button";
import { Choice } from "../_ui/choice";
import { Input } from "../_ui/input";
import { FIELD, TB } from "../_ui/toolbar.ts";

const ROW = "flex flex-wrap items-center gap-1.5";
const META = "text-sm text-muted-foreground";

export default function GroupsPage() {
  const login = useCustomDataState();
  const me = login.user?.id ?? null;
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
    <>
      <SiteHeader page="groups — who you share saved cohorts, analyses and custom data with" />
      <main className="camp groups" data-tw>
        {!login.loaded ? <div className="card"><Waiting what="your sign-in" /></div>
          : !login.unlocked ? <div className="card"><p className="m-0 text-md">
              {login.enabled ? <><Button size="sm" onClick={requestLogin}>Sign in</Button> to see and manage your groups.</>
                : "This deployment has no sign-in, so it has no groups."}</p></div>
          : <div className="grid items-start gap-4 md:grid-cols-[minmax(14rem,1fr)_2fr]">
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
              {current && <GroupCard key={current} me={me!} id={current}
                onGone={async () => { setChosen(null); await groups.changed(); }}
                onChanged={() => void qc.invalidateQueries({ queryKey: ["groups"] })} />}
            </div>}
      </main>
    </>
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
        <Input type="email" className={cn(FIELD, "w-auto flex-1")} value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="add someone by email…" aria-label="email to add" />
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
