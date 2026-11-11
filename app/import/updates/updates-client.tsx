"use client";
// The study-updates page: pick a study; make an example update to it or to its review copy (checked
// first: what it writes and what of it exists); run a review (compare, approve, reject, undo); and
// watch the study's partitions and query times as it changes. Every server call is listed in the
// log with its time.
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../_ui/button";
import { Input } from "../../_ui/input";
import { Checkbox } from "../../_ui/checkbox";
import { Choice } from "../../_ui/choice";
import { ErrorAlert } from "../../_ui/error-alert.tsx";
import { CHIP, FIELD, TB } from "../../_ui/toolbar.ts";
import { cn } from "../../../lib/cn";
import type { EditKind, EditParams, EditPlan, EditResult } from "@cbiolab/importer/lab-edits";
import type { Changes, ReviewDiff } from "@cbiolab/importer/lab-review";
import type { StudyCounts, StudyState } from "../../api/import/updates/route.ts";

interface Entry { at: string; what: string; detail: string; seconds: number; failed?: boolean }
type Post = <T>(action: string, extra?: Record<string, unknown>) => Promise<T | null>;

const KINDS: [EditKind, string][] = [["samples", "New samples"], ["profile", "New profile"], ["clinical", "Clinical data"], ["mutations", "Mutations"], ["expression", "Expression values"]];
const fmt = (n: number) => n.toLocaleString();
const card = "rounded-lg border border-border p-4";
const h2 = "mb-2 text-lg font-semibold";
const meta = "text-sm text-muted-foreground";
const table = "w-full border-collapse text-sm [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border-b [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th:not(.text-right)]:text-left [&_th]:font-semibold";
const num = "text-right tabular-nums";

export function UpdatesClient() {
  const [studies, setStudies] = useState<{ id: string; name: string; samples: number }[] | null>(null);
  const [study, setStudy] = useState("");
  const [st, setSt] = useState<StudyState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<Entry[]>([]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/import/updates", { cache: "no-store" });
      const j = await res.json() as { studies?: { id: string; name: string; samples: number }[]; error?: string };
      if (!res.ok || !j.studies) { setError(j.error || "Could not read the studies"); setStudies([]); return; }
      setStudies(j.studies);
      const want = new URLSearchParams(window.location.search).get("study");
      setStudy(j.studies.find((s) => s.id === want)?.id ?? j.studies[0]?.id ?? "");
    })();
  }, []);

  const refresh = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch("/api/import/updates?study=" + encodeURIComponent(id), { cache: "no-store" });
      const j = await res.json() as StudyState & { error?: string };
      if (!res.ok) { setError(j.error || "Could not read " + id); setSt(null); return; }
      setSt(j);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    if (!study) return;
    window.history.replaceState(null, "", "?study=" + encodeURIComponent(study));
    setSt(null);
    void refresh(study);
  }, [study, refresh]);

  const post: Post = useCallback(async <T,>(action: string, extra: Record<string, unknown> = {}) => {
    setError(null);
    setBusy(action);
    const at = new Date().toLocaleTimeString();
    try {
      const res = await fetch("/api/import/updates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, study, ...extra }) });
      const j = await res.json() as { result?: T; seconds?: number; error?: string };
      if (!res.ok) {
        setError(j.error || action + " failed");
        setLog((l) => [{ at, what: action, detail: j.error || "failed", seconds: 0, failed: true }, ...l]);
        return null;
      }
      setLog((l) => [{ at, what: action + (extra.target === "review" ? " (review copy)" : ""), detail: describe(action, j.result), seconds: j.seconds ?? 0 }, ...l]);
      if (!["plan", "time", "review-diff"].includes(action)) await refresh(study);
      return j.result ?? null;
    } finally { setBusy(null); }
  }, [study, refresh]);

  const waitTip = busy ? "Waiting for " + busy + " to finish" : undefined;
  return (
    <div data-tw className="mt-6 flex flex-col gap-6">
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <section className={card} aria-label="study">
        <div className="viewtb mt-0">
          <div className="tbz">
            <label className="tbfield">Study
              {studies === null ? <span className={meta}><span className="spinner" /> loading studies…</span>
                : <Choice size="ctl" value={study} onChange={setStudy} title="study to change" disabled={!!busy}
                  options={studies.map((s) => [s.id, `${s.name} (${s.id})`] as const)} placeholder="no studies imported" />}
            </label>
          </div>
          {st && <div className="tbz"><a className="text-sm" href={"/lab?tab=explore&study=" + encodeURIComponent(st.id)}>Explore {st.id}</a></div>}
        </div>
        {studies?.length === 0 && !error && <p className={meta}>No studies yet: import one on <a href="/import">Import data</a> first.</p>}
        {loading && !st && <p className={meta}><span className="spinner" /> reading {study}…</p>}
        {st && <Counts live={st.counts} review={st.reviewCopy?.counts ?? null} />}
      </section>
      {st && (
        <>
          <EditPanel st={st} busy={busy} waitTip={waitTip} post={post} />
          <ReviewPanel st={st} busy={busy} waitTip={waitTip} post={post} />
          <StoragePanel st={st} busy={busy} waitTip={waitTip} post={post} />
        </>
      )}
      <section className={card} aria-label="what happened">
        <h2 className={h2}>What happened</h2>
        {log.length === 0 ? <p className={meta}>Nothing yet. Each change, check and timing appears here with how long it took.</p> : (
          <table className={table}>
            <thead><tr><th>At</th><th>Action</th><th>Result</th><th className={num}>Seconds</th></tr></thead>
            <tbody>{log.map((e, i) => (
              <tr key={i} className={e.failed ? "text-destructive" : undefined}><td className="whitespace-nowrap">{e.at}</td><td className="whitespace-nowrap">{e.what}</td><td>{e.detail}</td><td className={num}>{e.seconds.toFixed(2)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function describe(action: string, r: unknown): string {
  const o = (r ?? {}) as Record<string, unknown>;
  if (action === "plan") { const p = o as unknown as EditPlan; return p.summary + (p.conflicts.length ? " — " + p.conflicts.map((c) => `${c.count} ${c.what}`).join("; ") : ""); }
  if (action === "apply") { const a = o as unknown as EditResult; return "wrote " + (Object.entries(a.rows).filter(([, n]) => n).map(([t, n]) => `${fmt(n)} ${t}`).join(", ") || "nothing") + (a.merged.length ? "; merged " + a.merged.length + " tables" : "; not merged"); }
  if (action === "review-approve") return o.approved ? "approved" : "refused: the study changed during the review";
  if (action === "review-undo") return o.undone ? "undone" : "refused: the study changed after the approval";
  if (action === "merge") return (o.merged as string[]).length ? "merged " + (o.merged as string[]).join(", ") : "nothing to merge: one part per table already";
  if (action === "time") return (o.timings as { query: string; ms: number }[]).map((t) => `${t.query} ${t.ms} ms`).join("; ");
  if (action === "review-diff") { const d = o as unknown as ReviewDiff; return d.tables.length ? d.tables.map((t) => `${t.table} +${t.added} −${t.removed} ~${t.changed}`).join(", ") : "no differences"; }
  return "done";
}

function Counts({ live, review }: { live: StudyCounts; review: StudyCounts | null }) {
  const rows: [keyof StudyCounts, string][] = [["samples", "Samples"], ["patients", "Patients"], ["mutations", "Mutations"], ["cnaEvents", "CNA events"],
    ["profiles", "Profiles"], ["attributes", "Clinical attributes"], ["clinicalValues", "Clinical values"], ["profileValues", "Profile values"]];
  return (
    <table className={cn(table, "mt-3 max-w-xl")}>
      <thead><tr><th /><th className={num}>Live study</th>{review && <th className={num}>Review copy</th>}</tr></thead>
      <tbody>{rows.map(([k, label]) => (
        <tr key={k}><td>{label}</td><td className={num}>{fmt(live[k])}</td>
          {review && <td className={cn(num, review[k] !== live[k] && "font-semibold text-primary")}>{fmt(review[k])}</td>}</tr>
      ))}</tbody>
    </table>
  );
}

interface PanelProps { st: StudyState; busy: string | null; waitTip?: string; post: Post }

function Num({ label, value, onChange, min = 1, max = 1000, w = "w-20" }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; w?: string }) {
  return <label className="tbfield">{label} <Input type="number" min={min} max={max} className={cn(FIELD, w)} value={value} onChange={(e) => onChange(Number(e.target.value))} /></label>;
}

function EditPanel({ st, busy, waitTip, post }: PanelProps) {
  const [kind, setKind] = useState<EditKind>("samples");
  const [p, setP] = useState<EditParams>({ kind: "samples", count: 5, prefix: "DEMO", seed: 1, profileKind: "expression", genes: 20, attribute: "DEMO_RESPONSE", level: "sample", datatype: "STRING", perSample: 2 });
  const [target, setTarget] = useState<"live" | "review">("live");
  const [merge, setMerge] = useState(true);
  const [plan, setPlan] = useState<{ key: string; plan: EditPlan } | null>(null);
  const set = (x: Partial<EditParams>) => setP((cur) => ({ ...cur, ...x }));
  const edit: EditParams = { ...p, kind, profile: kind === "expression" ? (p.profile && st.continuous.includes(p.profile) ? p.profile : st.continuous[0]) : p.profile,
    genes: kind === "expression" ? Math.min(p.genes ?? 5, 20) : p.genes };
  const key = JSON.stringify([st.id, target, edit]);
  const current = plan?.key === key ? plan.plan : null;
  const hasCopy = !!st.reviewCopy;
  const noProfile = kind === "expression" && st.continuous.length === 0;
  const check = async () => { const r = await post<EditPlan>("plan", { target, edit }); if (r) setPlan({ key, plan: r }); };
  const apply = async (onConflict: "skip" | "update") => { if (await post("apply", { target, edit, onConflict, merge })) setPlan(null); };
  const why = busy ? waitTip : noProfile ? st.id + " has no continuous profile; make one with New profile first" : undefined;

  return (
    <section className={card} aria-label="make an update">
      <h2 className={h2}>Make an update</h2>
      <p className={meta}>Generated rows, written as new versions: visible to the next query. Check first to see what an update writes and what of it is already there.</p>
      <div className="viewtb">
        <div className="tbz">
          {KINDS.map(([k, label]) => <Button key={k} variant="outline" size="xs" className={CHIP} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</Button>)}
        </div>
      </div>
      <div className="viewtb">
        <div className="tbz">
          {kind === "samples" && <><Num label="how many" value={p.count ?? 5} onChange={(n) => set({ count: n })} /><label className="tbfield">ids <Input className={cn(FIELD, "w-24")} value={p.prefix} onChange={(e) => set({ prefix: e.target.value })} /></label></>}
          {kind === "profile" && <><label className="tbfield">holding <Choice size="ctl" value={p.profileKind ?? "expression"} onChange={(v) => set({ profileKind: v as EditParams["profileKind"] })} title="what the profile holds"
            options={[["expression", "mRNA expression z-scores"], ["methylation", "methylation"], ["protein", "protein z-scores"]]} /></label><Num label="genes" value={p.genes ?? 20} max={20000} onChange={(n) => set({ genes: n })} /></>}
          {kind === "clinical" && <><label className="tbfield">attribute <Input className={cn(FIELD, "w-40")} value={p.attribute} onChange={(e) => set({ attribute: e.target.value })} /></label>
            <label className="tbfield">for each <Choice size="ctl" value={p.level ?? "sample"} onChange={(v) => set({ level: v as "sample" | "patient" })} title="sample or patient attribute" options={[["sample", "sample"], ["patient", "patient"]]} /></label>
            <label className="tbfield">type <Choice size="ctl" value={p.datatype ?? "STRING"} onChange={(v) => set({ datatype: v as "STRING" | "NUMBER" })} title="attribute type" options={[["STRING", "categories"], ["NUMBER", "numbers"]]} /></label></>}
          {kind === "mutations" && <><Num label="samples" value={p.count ?? 5} onChange={(n) => set({ count: n })} /><Num label="per sample" value={p.perSample ?? 2} max={20} onChange={(n) => set({ perSample: n })} /></>}
          {kind === "expression" && (noProfile ? <span className={meta}>{st.id} has no continuous profile to set values in; make one with New profile.</span> : <>
            <label className="tbfield">profile <Choice size="ctl" value={edit.profile ?? ""} onChange={(v) => set({ profile: v })} title="profile to set values in" options={st.continuous.map((x) => [x, x] as const)} /></label>
            <Num label="samples" value={p.count ?? 5} onChange={(n) => set({ count: n })} /><Num label="genes" value={Math.min(p.genes ?? 5, 20)} max={20} onChange={(n) => set({ genes: n })} /></>)}
          <Num label="seed" value={p.seed ?? 1} min={1} max={1_000_000} onChange={(n) => set({ seed: n })} />
        </div>
      </div>
      <div className="viewtb">
        <div className="tbz">
          <label className="tbfield">apply to <Choice size="ctl" value={target} onChange={(v) => setTarget(v as "live" | "review")} title="the live study or its review copy"
            options={[["live", "the live study"], ...(hasCopy ? [["review", "its review copy"] as const] : [])]} /></label>
          {!hasCopy && <span className={meta}>(start a review below to change a copy instead)</span>}
        </div>
        <div className="tbz">
          <label className="chk"><Checkbox checked={merge} onCheckedChange={(on) => setMerge(on === true)} /> merge the study&apos;s partitions afterwards</label>
        </div>
        <div className="tbz">
          <Button variant="outline" size="sm" className={TB} disabled={!!why} data-tip={why} onClick={() => void check()}>{busy === "plan" ? <><span className="spinner" /> checking…</> : "Check"}</Button>
        </div>
      </div>
      {current && (
        <div className="mt-3 rounded-md bg-accent/40 p-3 text-sm">
          <p><b>Would write</b> {current.summary}: {Object.entries(current.rows).filter(([, n]) => n).map(([t, n]) => `${fmt(n)} ${t}`).join(", ")}.</p>
          {current.conflicts.length === 0 ? <p className="mt-1">None of it exists yet.</p> : current.conflicts.map((c) => (
            <p key={c.what} className="mt-1 text-destructive"><b>{fmt(c.count)} {c.what}</b>: {c.examples.join(", ")}{c.count > c.examples.length ? ", …" : ""}</p>
          ))}
          <div className="viewtb">
            <div className="tbz">
              {current.conflicts.length === 0
                ? <Button size="sm" className={TB} disabled={!!busy} data-tip={waitTip} onClick={() => void apply("skip")}>{busy === "apply" ? <><span className="spinner" /> applying…</> : "Apply"}</Button>
                : <>
                  <Button variant="outline" size="sm" className={TB} disabled={!!busy} data-tip={waitTip} onClick={() => void apply("skip")}>Apply, skipping what exists</Button>
                  <Button size="sm" className={TB} disabled={!!busy} data-tip={waitTip} onClick={() => void apply("update")}>Apply, updating what exists</Button>
                  {busy === "apply" && <span className={meta}><span className="spinner" /> applying…</span>}
                </>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ChangesList({ changes }: { changes: Changes[] }) {
  return (
    <ul className="mt-1 list-disc pl-5">{changes.map((c) => <li key={c.table}>{c.table}: {fmt(c.rows)} rows{c.samples.length ? " (samples " + c.samples.join(", ") + ")" : ""}</li>)}</ul>
  );
}

function ReviewPanel({ st, busy, waitTip, post }: PanelProps) {
  const [diff, setDiff] = useState<ReviewDiff | null>(null);
  const [refused, setRefused] = useState<{ action: "review-approve" | "review-undo"; changes: Changes[] } | null>(null);
  const rv = st.review;
  const open = rv?.state === "open" && !!st.reviewCopy;
  useEffect(() => { setDiff(null); setRefused(null); }, [st.id, rv?.state, rv?.created]);
  const btn = (label: string, action: string, run: () => Promise<void>, variant: "default" | "outline" = "outline") => (
    <Button variant={variant} size="sm" className={TB} disabled={!!busy} data-tip={waitTip} onClick={() => void run()}>{busy === action ? <><span className="spinner" /> {label.toLowerCase()}…</> : label}</Button>
  );
  const approve = async (force: boolean) => {
    const r = await post<{ approved: boolean; changes?: Changes[] }>("review-approve", { force });
    setRefused(r && !r.approved ? { action: "review-approve", changes: r.changes ?? [] } : null);
  };
  const undo = async (force: boolean) => {
    const r = await post<{ undone: boolean; changes?: Changes[] }>("review-undo", { force });
    setRefused(r && !r.undone ? { action: "review-undo", changes: r.changes ?? [] } : null);
  };

  return (
    <section className={card} aria-label="review">
      <h2 className={h2}>Review</h2>
      {!open ? (
        <>
          <p className={meta}>A review copies {st.id} to <span className="font-mono">{st.id}__review</span>, a study of its own, on the server (no files are read again).
            Updates applied to the copy are seen only there; approving swaps the reviewed rows in, table by table, and keeps the study as it was so the approval can be undone.</p>
          {rv && rv.state !== "open" && <p className="mt-1 text-sm">Last review: {rv.state}, started {rv.created.slice(0, 19)}.</p>}
          <div className="viewtb">
            <div className="tbz">
              {btn("Start a review copy", "review-start", async () => { await post("review-start"); })}
              {rv?.state === "approved" && btn("Undo the last approval", "review-undo", () => undo(false))}
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm">Review copy <a className="font-mono" href={"/lab?tab=explore&study=" + encodeURIComponent(rv.reviewId)}>{rv.reviewId}</a>, started {rv.created.slice(0, 19)}.
            Apply updates to it above (apply to: its review copy), then compare and decide.</p>
          <p className={meta}>In this local instance everyone sees the copy; a shared deployment would show it to reviewers only (not built yet).</p>
          <div className="viewtb">
            <div className="tbz">
              {btn("Compare with the live study", "review-diff", async () => { setDiff(await post<ReviewDiff>("review-diff")); })}
              {btn("Approve", "review-approve", () => approve(false), "default")}
              {btn("Reject", "review-reject", async () => { await post("review-reject"); })}
            </div>
          </div>
          {diff && (
            <div className="mt-3 text-sm">
              {diff.tables.length === 0 ? <p>The copy is the same as the live study.</p> : (
                <table className={cn(table, "max-w-xl")}>
                  <thead><tr><th>Table</th><th className={num}>Added</th><th className={num}>Removed</th><th className={num}>Changed</th></tr></thead>
                  <tbody>{diff.tables.map((t) => <tr key={t.table}><td className="font-mono">{t.table}</td><td className={num}>{fmt(t.added)}</td><td className={num}>{fmt(t.removed)}</td><td className={num}>{fmt(t.changed)}</td></tr>)}</tbody>
                </table>
              )}
              {diff.samplesAddedCount > 0 && <p className="mt-1">Samples added ({fmt(diff.samplesAddedCount)}): {diff.samplesAdded.join(", ")}{diff.samplesAddedCount > diff.samplesAdded.length ? ", …" : ""}</p>}
              {diff.samplesRemovedCount > 0 && <p className="mt-1">Samples removed ({fmt(diff.samplesRemovedCount)}): {diff.samplesRemoved.join(", ")}</p>}
              {diff.attributesAdded.length > 0 && <p className="mt-1">Attributes added: {diff.attributesAdded.join(", ")}</p>}
              {diff.profilesAdded.length > 0 && <p className="mt-1">Profiles added: {diff.profilesAdded.join(", ")}</p>}
            </div>
          )}
        </>
      )}
      {refused && (
        <div className="mt-3 rounded-md border border-destructive p-3 text-sm">
          <p className="text-destructive"><b>{refused.action === "review-approve" ? "Not approved" : "Not undone"}:</b> {st.id} changed {refused.action === "review-approve" ? "after the review began" : "after the approval"}, and
            {refused.action === "review-approve" ? " approving" : " undoing"} would drop these changes:</p>
          <ChangesList changes={refused.changes} />
          <div className="viewtb">
            <div className="tbz">
              {refused.action === "review-approve" ? btn("Approve anyway", "review-approve", () => approve(true)) : btn("Undo anyway", "review-undo", () => undo(true))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function StoragePanel({ st, busy, waitTip, post }: PanelProps) {
  const [timings, setTimings] = useState<Record<string, { query: string; ms: number }[]>>({});
  useEffect(() => setTimings({}), [st.id]);
  const time = async (target: "live" | "review") => {
    const r = await post<{ timings: { query: string; ms: number }[] }>("time", { target });
    if (r) setTimings((t) => ({ ...t, [target]: r.timings }));
  };
  const btn = (label: string, action: string, run: () => Promise<void>) => (
    <Button variant="outline" size="sm" className={TB} disabled={!!busy} data-tip={waitTip} onClick={() => void run()}>{busy === action ? <><span className="spinner" /> working…</> : label}</Button>
  );
  const sides: ["live" | "review", string, StudyState["parts"]][] = [["live", st.id, st.parts], ...(st.reviewCopy ? [["review", st.id + "__review", st.reviewCopy.parts] as ["review", string, StudyState["parts"]]] : [])];
  const unmerged = (parts: StudyState["parts"]) => parts.filter((p) => p.parts > 1).length;

  return (
    <section className={card} aria-label="partitions and query times">
      <h2 className={h2}>Partitions and query times</h2>
      <p className={meta}>Each study is a partition of every lab_ table. An update adds parts; until they are merged, queries on the study merge them as they read
        (FINAL). Rows include old versions and deletion markers until a merge drops them.</p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {sides.map(([side, id, parts]) => (
          <div key={side}>
            <p className="text-sm font-semibold">{id}: {unmerged(parts) ? `${unmerged(parts)} tables with unmerged parts` : "every table merged"}</p>
            <table className={cn(table, "mt-1")}>
              <thead><tr><th>Table</th><th className={num}>Parts</th><th className={num}>Rows</th><th className={num}>MB</th></tr></thead>
              <tbody>{parts.map((p) => (
                <tr key={p.table} className={p.parts > 1 ? "font-semibold text-primary" : undefined}><td className="font-mono">{p.table}</td><td className={num}>{p.parts}</td>
                  <td className={num}>{fmt(p.rows)}</td><td className={num}>{(p.bytes / 1e6).toFixed(1)}</td></tr>
              ))}</tbody>
            </table>
            <div className="viewtb">
              <div className="tbz">
                {btn("Merge partitions", "merge", async () => { await post("merge", { target: side }); })}
                {btn("Time queries", "time", () => time(side))}
              </div>
            </div>
            {timings[side] && (
              <table className={cn(table, "mt-2")}>
                <thead><tr><th>Query (through the app&apos;s views)</th><th className={num}>ms</th></tr></thead>
                <tbody>{timings[side].map((t) => <tr key={t.query}><td>{t.query}</td><td className={num}>{t.ms}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
