"use client";
// Editing a stored upload adds and updates, never removes (lib/custom-data-edit.ts): its latest
// version as a table whose values can be changed and to which rows and columns can be added, or a
// file merged into it — an id already there updates that row, a new id is a new row, and every row
// the file does not name stays as it is. Every change from that version is then reviewed
// (app/lab/dataset-diff.tsx) before it is saved as the next version. The footer always says how much
// has changed and offers a way out at every step; the review is the confirmation, and the server
// refuses a save whose base is no longer the latest, or that leaves anything out (lib/custom-store.ts).
// The dataset's note is edited here too; a change to it alone is saved without a new version.
import { useEffect, useId, useMemo, useState } from "react";
import { ArrowLeft, FileUp, LoaderCircle, ListChecks, Plus, RotateCcw, Search, Table2, Trash2 } from "lucide-react";
import {
  buildDataset, fetchServerVersion, parseUpload, resolveIds, saveToServer, setServerNote, type StoredDataset
} from "../lab/custom-data-client.ts";
import { DatasetDiffView, diffLine } from "../lab/dataset-diff.tsx";
import { caseKey, diffDatasets } from "../../lib/custom-data-diff.ts";
import {
  addColumn, addedRowProblems, addRow, dropRow, mergeRows, setCell, setNewId, toDataset, working,
  type EditRow, type Matches, type Working
} from "../../lib/custom-data-edit.ts";
import { LIMITS } from "../../lib/custom-data-names.ts";
import type { DatasetMeta } from "../../lib/custom-store.ts";
import { Button } from "../_ui/button";
import { Dialog, DialogContent, DialogTitle } from "../_ui/dialog";
import { Input } from "../_ui/input";
import { Textarea } from "../_ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "../_ui/tabs";
import { SEG_TAB, SEG_TABS, TB } from "../_ui/toolbar.ts";
import { cn } from "../../lib/cn";

type Base = StoredDataset & { server: DatasetMeta; version: number };
type Step = "edit" | "file" | "review";
const PAGE = 100;
const fmt = (n: number) => n.toLocaleString("en-US");

/** A cell that keeps what is typed until it is left (Enter or Tab), so a keystroke never re-renders the table. */
function Cell({ value, was, onCommit, label, disabled }: { value: string; was?: string; onCommit: (v: string) => void; label: string; disabled?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const edited = was !== undefined && value !== was;
  return (
    <input value={draft} disabled={disabled} aria-label={label} spellCheck={false}
      data-tip={edited ? "was " + (was === "" ? "empty" : "“" + was + "”") : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { e.stopPropagation(); setDraft(value); }
      }}
      className={cn("h-7 w-full min-w-24 rounded-sm border border-transparent bg-transparent px-1.5 font-mono text-md outline-none",
        "hover:border-border focus:border-primary focus:bg-card disabled:cursor-default disabled:hover:border-transparent",
        edited && "bg-mark-soft text-foreground")} />
  );
}

/** `onSaved` is told what was saved, in a sentence for the page. */
export function DatasetEditor({ meta, onSaved, onClose }: { meta: DatasetMeta; onSaved: (what: string) => void; onClose: () => void }) {
  const [base, setBase] = useState<Base | null>(null);
  const [w, setW] = useState<Working | null>(null);
  const [name, setName] = useState(meta.name);
  const [note, setNote] = useState(meta.note ?? "");
  const noteId = useId();
  const [step, setStep] = useState<Step>("edit");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>("reading v" + meta.latestVersion + "…");
  const [search, setSearch] = useState("");
  const [onlyEdited, setOnlyEdited] = useState(false);
  const [page, setPage] = useState(0);
  const [newCol, setNewCol] = useState("");
  /** added rows' ids matched to cases, for the ids as they were when matched */
  const [matched, setMatched] = useState<{ ids: string; matches: Matches } | null>(null);
  /** the step review was opened from, which Back returns to */
  const [from, setFrom] = useState<Exclude<Step, "review">>("edit");
  /** a table pasted on the file step, merged when the changes are reviewed */
  const [pasted, setPasted] = useState("");
  /** what the last file merged in did */
  const [merged, setMerged] = useState<{ from: string; rowsIn: number; updated: number; added: number; dropped: string[] } | null>(null);
  const studies = meta.versions.find((v) => v.version === meta.latestVersion)?.studies ?? [];

  useEffect(() => {
    let live = true;
    fetchServerVersion(meta.id, meta.latestVersion)
      .then((b) => { if (live) { setBase(b); setW(working(b)); } })
      .catch((e) => { if (live) setErr("could not read v" + meta.latestVersion + ": " + String((e as Error).message || e)); })
      .finally(() => { if (live) setBusy(null); });
    return () => { live = false; };
  }, [meta]);

  /** every change to the table: what was reviewed no longer describes it */
  const change = (f: (w: Working) => Working) => setW((x) => x && f(x));
  const level = meta.level;
  const added = useMemo(() => w?.rows.filter((r) => r.newId !== undefined) ?? [], [w]);
  const addedIds = added.map((r) => r.key + "=" + r.newId).join("\n");
  const matches = matched && matched.ids === addedIds ? matched.matches : null;
  const problems = useMemo(() => w ? addedRowProblems(w, level, matches) : new Map<string, string>(), [w, level, matches]);
  const draft = useMemo(() => base && w ? toDataset(base, w, name, matches) : null, [base, w, name, matches]);
  const diff = useMemo(() => base && draft ? diffDatasets(base, draft) : null, [base, draft]);
  const pendingAdds = added.length - (matches ? added.filter((r) => matches.get(r.key)?.length).length : 0);

  const baseBy = useMemo(() => {
    if (!base) return new Map<string, Map<string, string>>();
    return new Map(base.rows.map((r) => [caseKey(base.level, r),
      new Map(base.columns.map((c, j) => [c.name, r.values[j] ?? ""]))]));
  }, [base]);
  const isEdited = (r: EditRow) => !baseBy.has(r.key)
    || w!.columns.some((c, j) => (baseBy.get(r.key)?.get(c.name) ?? "") !== r.values[j]);

  const visible = useMemo(() => {
    if (!w) return [];
    const q = search.trim().toLowerCase();
    return w.rows.filter((r) => (!q || (r.newId ?? r.key).toLowerCase().includes(q) || r.values.some((v) => v.toLowerCase().includes(q)))
      && (!onlyEdited || isEdited(r)));
  }, [w, search, onlyEdited, baseBy]); // eslint-disable-line react-hooks/exhaustive-deps -- isEdited reads w and baseBy
  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const pageRows = visible.slice(Math.min(page, pages - 1) * PAGE, Math.min(page, pages - 1) * PAGE + PAGE);

  const tryAddColumn = () => {
    try { change((x) => addColumn(x, newCol)); setNewCol(""); setErr(null); }
    catch (e) { setErr(String((e as Error).message || e)); }
  };

  /** match added rows' ids, then show the changes */
  const review = async () => {
    setErr(null);
    if (added.length && !matches) {
      const typed = added.filter((r) => r.newId);
      setBusy("matching " + fmt(typed.length) + " new id" + (typed.length === 1 ? "" : "s") + "…");
      try {
        const res = typed.length ? await resolveIds(studies, level, typed.map((r) => r.newId!)) : { matches: [] };
        const m: Matches = new Map(typed.map((r, i) => [r.key, res.matches[i] ?? []]));
        setMatched({ ids: addedIds, matches: m });
        const p = addedRowProblems(w!, level, m);
        if (p.size) { setErr(fmt(p.size) + " added row" + (p.size === 1 ? "" : "s") + " cannot be saved: fix or delete " + (p.size === 1 ? "it" : "them") + " (marked below)");
          setOnlyEdited(true); setStep("edit"); return; }
      } catch (e) { setErr(String((e as Error).message || e)); return; }
      finally { setBusy(null); }
    } else if (problems.size) { setErr("fix or delete the added rows marked below first"); setStep("edit"); return; }
    if (step !== "review") setFrom(step);
    setStep("review");
  };

  /** Review from the file step merges what is pasted first; from the table, the table as it stands. */
  const next = () => {
    if (step === "file" && pasted.trim()) void mergeFile(pasted, "the pasted table");
    else void review();
  };

  /** a file merged into the table: matched to the dataset's studies, its rows updating or adding, the rest untouched */
  const mergeFile = async (text: string, source: string) => {
    if (!base || !w) return;
    setErr(null);
    let p;
    try { p = parseUpload(text); } catch (e) { setErr(String((e as Error).message || e)); return; }
    if (p.level !== level) { setErr("this file has " + p.level + " ids (" + p.idColumn + "); “" + meta.name + "” is " + level + "-level"); return; }
    setBusy("matching " + fmt(p.rows.length) + " ids…");
    try {
      const res = await resolveIds(studies, level, p.rows.map((r) => r[0]));
      const was = new Map(base.columns.map((c) => [c.name, c.datatype]));
      const d = buildDataset(name, p, res, studies, Object.fromEntries(p.columns.map((c) => [c.name, was.get(c.name) === "STRING" ? "STRING" : c.datatype])));
      if (!d.rows.length) { setErr("no row of " + source + " matched a " + level + " of " + studies.join(", ") + ": nothing to add or update"); return; }
      const had = new Set(w.rows.map((r) => r.key));
      const updated = d.rows.filter((r) => had.has(caseKey(level, r))).length;
      setW(mergeRows(w, level, d)); setMatched(null); setPage(0); setSearch(""); setOnlyEdited(true); setPasted("");
      setMerged({ from: source, rowsIn: p.rows.length, updated, added: d.rows.length - updated, dropped: p.rows.filter((_, i) => !res.matches[i]?.length).map((r) => r[0]) });
      setFrom("file"); setStep("review");
    } catch (e) { setErr(String((e as Error).message || e)); }
    finally { setBusy(null); }
  };

  const startOver = () => {
    if (!base) return;
    setW(working(base)); setName(base.name); setNote(meta.note ?? ""); setMatched(null); setMerged(null); setPasted(""); setErr(null); setStep("edit");
  };

  const save = async () => {
    if (!base || !draft || !diff || (diff.same && !noteChanged)) return;
    if (diff.same) {
      setBusy("saving the note…"); setErr(null);
      try { await setServerNote(meta.id, note); onSaved("Saved the note of “" + meta.name + "”; its data is unchanged at v" + base.version + "."); }
      catch (e) { setErr(String((e as Error).message || e)); }
      finally { setBusy(null); }
      return;
    }
    if (draft.rows.length * draft.columns.length > LIMITS.cells) { setErr("this has " + fmt(draft.rows.length * draft.columns.length) + " values; the limit is " + fmt(LIMITS.cells)); return; }
    setBusy("saving v" + (base.version + 1) + "…"); setErr(null);
    try {
      await saveToServer({ ...draft, id: base.id, createdAt: new Date().toISOString(),
        source: { rowsIn: draft.rows.length, unmatched: merged ? merged.dropped.length : 0, duplicates: 0, multiStudy: 0, studies } },
        { id: meta.id, version: base.version }, noteChanged ? note : undefined);
      onSaved("Saved “" + draft.name + "” as v" + (base.version + 1) + ".");
    } catch (e) { setErr(String((e as Error).message || e)); }
    finally { setBusy(null); }
  };

  const noteChanged = note.trim() !== (meta.note ?? "");
  const summary = !diff ? "" : [diffLine(diff, level), noteChanged && "note changed"].filter(Boolean).join(" · ");
  const dataChanged = !!diff && (!diff.same || pendingAdds > 0);
  const changed = dataChanged || noteChanged;
  const canReview = (changed || (step === "file" && !!pasted.trim())) && !busy;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}
        className="cd-editdialog flex h-[92vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[96vw]">
        <div data-tw className="flex min-h-0 flex-1 flex-col">
          <div className="grid gap-2.5 border-b border-border px-6 pt-5 pb-3">
            <DialogTitle className="flex flex-wrap items-baseline gap-2.5 pr-8 text-base">
              <span>Edit custom data</span>
              <span className="text-sm font-normal text-muted-foreground">custom:{meta.slug} · {level} level · {studies.join(", ")}</span>
            </DialogTitle>
            <div className="flex flex-wrap items-center gap-2.5">
              <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="dataset name"
                className="h-8 w-80 text-md font-semibold md:text-md" />
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-sm text-muted-foreground"
                data-tip={dataChanged ? "saving makes a new version" : "a note alone is saved without a new version"}>
                v{meta.latestVersion}{dataChanged && <> → <b className="text-foreground">v{meta.latestVersion + 1}</b></>}</span>
              <Tabs className="ml-auto" value={step} onValueChange={(v) => { if (v === "review") next(); else { setErr(null); setStep(v as Step); } }}>
                <TabsList className={SEG_TABS} aria-label="how to change it">
                  <TabsTrigger value="edit" className={SEG_TAB} disabled={!w}><Table2 />Edit in table</TabsTrigger>
                  <TabsTrigger value="file" className={SEG_TAB} disabled={!w}><FileUp />Add or update from file</TabsTrigger>
                  <TabsTrigger value="review" className={SEG_TAB} disabled={!canReview}><ListChecks />Review changes</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <label className="m-0 grid gap-1" htmlFor={noteId}>
              <span className="text-md font-semibold">Note</span>
              <Textarea id={noteId} value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                placeholder="what this data is, where it came from, how it was coded" className="cd-note min-h-0 resize-y bg-card text-md md:text-md" />
            </label>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden px-6 py-4">
            {!w ? <p className="text-muted-foreground"><LoaderCircle className="inline size-4 animate-spin" /> {busy}</p> : <>
              {step === "edit" && <>
                <div className="viewtb">
                  <div className="tbz">
                    <label className="relative flex items-center">
                      <Search className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
                      <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={"find a " + level + " or value"}
                        aria-label="find a row" className="h-ctl w-60 pl-7 text-md md:text-md" />
                    </label>
                    <Button variant="outline" size="sm" className={cn(TB, onlyEdited && "border-primary bg-accent")} aria-pressed={onlyEdited} onClick={() => { setOnlyEdited((x) => !x); setPage(0); }}>
                      Only edited rows</Button>
                  </div>
                  <div className="tbz">
                    <Button variant="outline" size="sm" className={cn(TB, "cd-addrow")} onClick={() => { change((x) => addRow(x, studies[0])); setSearch(""); setOnlyEdited(false); setPage(0); }}
                      data-tip={"a row for a " + level + " the data does not have yet: type its id, matched to " + studies.join(", ") + " on review"}><Plus />Row</Button>
                    <Input value={newCol} onChange={(e) => setNewCol(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") tryAddColumn(); }}
                      placeholder="new column" aria-label="new column name" className="h-ctl w-36 text-md md:text-md" />
                    <Button variant="outline" size="sm" className={cn(TB, "cd-addcol")} disabled={!newCol.trim()} onClick={tryAddColumn}><Plus />Column</Button>
                  </div>
                </div>
                <div className="cd-grid min-h-0 flex-1 overflow-auto rounded-md border border-border">
                  <table className="w-full border-collapse text-md">
                    <thead className="sticky top-0 z-10 bg-muted">
                      <tr>
                        <th className="border-b border-border px-2 py-1.5 text-left font-semibold whitespace-nowrap">{level === "sample" ? "SAMPLE_ID" : "PATIENT_ID"}</th>
                        {w.columns.map((c) => <th key={c.name} className={cn("border-b border-border px-2 py-1.5 text-left font-semibold whitespace-nowrap",
                          !base!.columns.some((x) => x.name === c.name) && "text-ok")}>
                          {!base!.columns.some((x) => x.name === c.name) && "+ "}{c.name}</th>)}
                        <th className="w-10 border-b border-border" aria-label="take out an added row" />
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((r) => {
                        const was = baseBy.get(r.key);
                        const problem = problems.get(r.key);
                        return (
                          <tr key={r.key} data-key={r.key} className={cn("border-b border-border/60",
                            !was && "bg-ok-soft/60")}>
                            <td className="px-2 py-0.5 font-mono whitespace-nowrap">
                              {r.newId !== undefined
                                ? <div className="grid gap-0.5"><Cell value={r.newId} onCommit={(v) => change((x) => setNewId(x, r.key, v))} label="new row id" />
                                    {problem && <span className="text-sm text-destructive">{problem}</span>}</div>
                                : <span className={cn(!was && "text-ok")}>{r.key}</span>}
                            </td>
                            {w.columns.map((c, j) => <td key={c.name} className="px-1 py-0.5">
                              <Cell value={r.values[j]} was={was ? was.get(c.name) ?? "" : undefined}
                                onCommit={(v) => change((x) => setCell(x, r.key, c.name, v))} label={c.name + " of " + (r.newId ?? r.key)} />
                            </td>)}
                            <td className="px-1 text-center">
                              {!was && <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive"
                                aria-label={"take out " + (r.newId || r.key)} data-tip={"take out this added " + level + " (stored rows always stay)"}
                                onClick={() => change((x) => dropRow(x, r.key))}><Trash2 /></Button>}
                            </td>
                          </tr>
                        );
                      })}
                      {!pageRows.length && <tr><td colSpan={w.columns.length + 2} className="p-6 text-center text-muted-foreground">
                        {onlyEdited ? "No row is edited yet." : "No row matches “" + search + "”."}</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <span>{fmt(visible.length)} of {fmt(w.rows.length)} rows{search && " match “" + search + "”"}</span>
                  {pages > 1 && <span className="ml-auto flex items-center gap-1.5">
                    <Button variant="outline" size="sm" className={TB} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹</Button>
                    page {Math.min(page, pages - 1) + 1} of {fmt(pages)}
                    <Button variant="outline" size="sm" className={TB} disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>›</Button>
                  </span>}
                </div>
              </>}

              {step === "file" && <MergeFromFile level={level} studies={studies} text={pasted} onText={setPasted} onLoad={(t, source) => void mergeFile(t, source)} />}

              {step === "review" && diff && base && draft && <div className="min-h-0 flex-1 overflow-auto">
                {merged && <p className={cn("mt-0 text-md", merged.dropped.length ? "text-mark" : "text-muted-foreground")}>
                  From {merged.from}: {fmt(merged.updated)} {level}{merged.updated === 1 ? "" : "s"} already in the data, {fmt(merged.added)} new
                  {merged.dropped.length > 0 && <>; {fmt(merged.dropped.length)} row{merged.dropped.length === 1 ? "" : "s"} matched no {level} of {studies.join(", ")} and {merged.dropped.length === 1 ? "was" : "were"} left out
                    (e.g. {merged.dropped.slice(0, 3).map((x) => <code key={x} className="mr-1">{x}</code>)})</>}.
                  {" "}Every other {level} stays as it is. The table can still be edited before saving.</p>}
                {noteChanged && <div className="cd-notechange mb-4 grid gap-1 rounded-md border border-border p-2.5 text-md">
                  <b>Note changed</b>
                  {meta.note ? <del className="whitespace-pre-wrap text-destructive decoration-destructive/60">{meta.note}</del> : <span className="italic text-muted-foreground">no note before</span>}
                  {note.trim() ? <ins className="whitespace-pre-wrap text-ok no-underline">{note.trim()}</ins> : <span className="italic text-muted-foreground">note removed</span>}
                  {diff.same && <span className="text-sm text-muted-foreground">The data is unchanged, so saving changes the note only: no new version is made.</span>}
                </div>}
                {diff.losesData && <p className="mt-0 text-md text-muted-foreground">Values struck through are the ones this overwrites.</p>}
                {!(diff.same && noteChanged) && <DatasetDiffView diff={diff} before={base} after={draft} version={base.version} />}
              </div>}
            </>}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 border-t border-border bg-muted/40 px-6 py-3">
            <div className="cd-summary min-w-0 flex-1 text-md">
              {err ? <span className="text-destructive">{err}</span>
                : busy && w ? <span className="text-muted-foreground"><LoaderCircle className="inline size-4 animate-spin" /> {busy}</span>
                : !changed ? <span className="text-muted-foreground">No changes from v{meta.latestVersion} yet.</span>
                : <span><b>Changes from v{meta.latestVersion}:</b> {[summary, pendingAdds > 0 && fmt(pendingAdds) + " new row" + (pendingAdds === 1 ? "" : "s") + " to match"].filter(Boolean).join(" · ")}</span>}
            </div>
            {changed && <Button variant="link" size="inline" className="text-md" onClick={startOver} data-tip={"discard every change and start again from v" + meta.latestVersion}>
              <RotateCcw className="size-3.5" />Start over</Button>}
            <Button variant="outline" className="cd-cancel" onClick={onClose}
              data-tip={changed ? "close without saving: v" + meta.latestVersion + " stays as it is and these changes are discarded" : "close"}>Cancel</Button>
            {step !== "review"
              ? <Button className="cd-review" disabled={!canReview} onClick={next}
                  data-tip={canReview ? undefined : step === "file" ? "paste a table or drop a file first" : "change a value, or add a row or column, first"}>Review changes →</Button>
              : <>
                <Button variant="outline" onClick={() => { setErr(null); setStep(from); }}><ArrowLeft />{from === "file" ? "Back to file" : "Back to table"}</Button>
                <Button className="cd-save" disabled={!changed || !!busy} onClick={() => void save()}
                  data-tip={!changed ? "nothing changed from v" + meta.latestVersion : !dataChanged ? "the note only: the data stays at v" + meta.latestVersion
                    : "earlier versions, and analyses pinned to them, stay as they are"}>
                  {dataChanged ? "Save as v" + (meta.latestVersion + 1) : "Save note"}</Button>
              </>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const TEXT_FILE = /\.(tsv|csv|txt|tab)$/i;

function MergeFromFile({ level, studies, text, onText, onLoad }: { level: string; studies: string[]; text: string; onText: (t: string) => void; onLoad: (text: string, from: string) => void }) {
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const file = async (f: File | undefined) => {
    if (!f) return;
    if (!TEXT_FILE.test(f.name) && f.type && !f.type.startsWith("text/")) { setErr(f.name + " is not a text table: save it as .tsv or .csv first"); return; }
    setErr(null); onLoad(await f.text(), f.name);
  };
  const idHead = level === "sample" ? "SAMPLE_ID" : "PATIENT_ID";
  return (
    <div className="grid min-h-0 flex-1 content-start gap-4 overflow-auto">
      <div className={cn("grid place-items-center gap-2.5 rounded-lg border-2 border-dashed p-9 text-center transition-colors", over ? "border-primary bg-accent" : "border-border")}
        onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); void file(e.dataTransfer.files?.[0]); }}>
        <FileUp className="size-8 text-muted-foreground" />
        <b>Drop a file to add or update rows</b>
        <span className="max-w-3xl text-sm text-muted-foreground">A .tsv or .csv with a <code>{idHead}</code> column, matched to {studies.join(", ")}.
          A {level} already in the data takes the file&apos;s values (a blank cell leaves its value as it is); a new {level} is added; every {level} the
          file does not name, and every column it lacks, stays as it is. The next step shows every change before anything is saved.</span>
        <label className="cursor-pointer text-md text-link underline">choose a file
          <input type="file" className="sr-only" accept=".tsv,.txt,.csv,.tab,text/plain,text/csv,text/tab-separated-values"
            onChange={(e) => { void file(e.target.files?.[0]); e.target.value = ""; }} /></label>
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm text-muted-foreground">or paste it, then review the changes</span>
        <Textarea value={text} onChange={(e) => onText(e.target.value)} rows={6} spellCheck={false} aria-label="the table to add or update from"
          placeholder={idHead + "\tCOLUMN\n…"} className="bg-card font-mono text-md md:text-md" />
      </div>
      {err && <p className="m-0 text-destructive">{err}</p>}
    </div>
  );
}
