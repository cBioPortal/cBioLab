"use client";
// The Custom data dialog: upload a table of curated annotations and check how it matched the
// explored studies (Add data), and see, export or delete what is stored on the server, the only
// place uploads live (Manage). Owns its own draft state, so typing into the paste box never
// re-renders the analysis page (see "Keystrokes stay in the field" in CLAUDE.md). Which custom
// attributes are drawn as charts is chosen in Explore's Add chart dialog, like any other attribute.
import { useEffect, useState, useSyncExternalStore } from "react";
import { ShareDialog, sharingLabel } from "./share-dialog.tsx";
import { useGroups } from "./use-groups.ts";
import {
  onCustomDataChange, loadCustomData, parseUpload, buildDataset, datasetToTsv, serverState, requestLogin, saveToServer,
  deleteServerDataset, shareServerDataset, serverBySlug, fetchServerVersion, resolveIds, exampleUpload, type ParsedUpload, type ResolveResponse, type ServerState, type StoredDataset
} from "./custom-data-client.ts";
import type { DatasetMeta } from "../../lib/custom-store.ts";
import { LIMITS } from "../../lib/custom-data-names.ts";
import { Download, LoaderCircle, Share2, Trash2 } from "lucide-react";
import { Button } from "../_ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Input } from "../_ui/input";
import { Tabs, TabsList, TabsTrigger } from "../_ui/tabs";
import { Textarea } from "../_ui/textarea";
import { cn } from "../../lib/cn";
import { OptionSelect } from "../_ui/choice.tsx";
import { TB } from "../_ui/toolbar.ts";

/** a tab of the custom-data manager */
const TAB = "h-auto flex-none rounded-none px-3 pt-1.5 pb-1.5 text-md after:bottom-[-1px] data-[state=active]:text-accent-foreground data-[state=active]:after:bg-primary";

/** what an upload looks like, shown in the empty paste box */
const PLACEHOLDER = "PATIENT_ID\tMET_SITE\tKPS\nP-0001\tBrain\t80\nP-0002\tLiver\t90";
/** what the file picker and the drop zone take: delimited text */
const TEXT_FILE = /\.(tsv|csv|txt|tab)$/i;
/** a match rate under this needs a deliberate second click: the ids are probably the wrong kind */
const LOW_MATCH = 0.5;

/** The server's login and custom-data state, re-rendering whenever it changes. Loaded once per
 *  page by whichever component asks first — not left to the first engine request, which a page
 *  may never make (Explore with no study chosen, the Saved tab). */
export function useCustomDataState(): ServerState {
  useEffect(() => { void loadCustomData(); }, []);
  return useSyncExternalStore(onCustomDataChange, serverState, serverState);
}

/** the dialog's two tabs */
export type CustomDataTab = "add" | "manage";

function AddCustomData({ studies, onAdded }: { studies: string[]; onAdded: (name: string) => void }) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [parsed, setParsed] = useState<ParsedUpload | null>(null);
  const [types, setTypes] = useState<Record<string, "STRING" | "NUMBER">>({});
  const [resolved, setResolved] = useState<ResolveResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmLow, setConfirmLow] = useState(false);
  /** the studies the preview was matched against: what the dataset is added to */
  const [matchedStudies, setMatchedStudies] = useState<string[]>([]);

  const [dragging, setDragging] = useState(false);
  // a file dropped just outside the drop zone would otherwise open in place of the page
  useEffect(() => {
    const stop = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => { window.removeEventListener("dragover", stop); window.removeEventListener("drop", stop); };
  }, []);
  const [exampleBusy, setExampleBusy] = useState(false);
  /** new text from a file, a drop or the example: checked at once, since nothing about it is half-typed */
  const load = (t: string, defaultName: string) => {
    setText(t); setParsed(null); setResolved(null);
    if (!name) setName(defaultName);
    void preview(t);
  };
  const loadFile = async (f: File | undefined) => {
    if (!f) return;
    if (!TEXT_FILE.test(f.name) && f.type && !f.type.startsWith("text/")) {
      setErr(f.name + " is not a text table: save it as tab- or comma-separated text (.tsv, .csv) first"); return;
    }
    load(await f.text(), f.name.replace(/\.[^.]+$/, ""));
  };
  const loadExample = async () => {
    const study = studies[0];
    setExampleBusy(true); setErr(null);
    // stamped, so loading the example again never asks for a name already taken, or kept by a deleted example;
    // the stamp comes first because a dataset's id keeps only the name's first 40 characters
    const stamp = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "");
    try { load(await exampleUpload(study), "Example " + stamp + " (" + study + ")"); }
    catch (e) { setErr("could not build example data: " + String((e as Error).message || e)); }
    finally { setExampleBusy(false); }
  };

  const reset = () => { setText(""); setName(""); setParsed(null); setResolved(null); setTypes({}); setErr(null); setConfirmLow(false); setMatchedStudies([]); };

  /** parse the table and match its ids against the studies being explored */
  const preview = async (t = text) => {
    setErr(null); setResolved(null); setConfirmLow(false);
    let p: ParsedUpload;
    try { p = parseUpload(t); } catch (e) { setParsed(null); setErr(String((e as Error).message || e)); return; }
    setParsed(p);
    setTypes(Object.fromEntries(p.columns.map((c) => [c.name, c.datatype])));
    if (!studies.length) { setErr("select a study above first: ids are matched against the studies being explored"); return; }
    setBusy(true);
    try {
      setResolved(await resolveIds(studies, p.level, p.rows.map((r) => r[0])));
      setMatchedStudies([...studies]);
    } catch (e) { setErr(String((e as Error).message || e)); }
    finally { setBusy(false); }
  };

  /** a new dataset, or the next version of the server one of that name */
  const save = async () => {
    if (!parsed || !resolved) return;
    if (stale) { setErr("the studies being explored changed since the preview: preview again"); return; }
    const d = buildDataset(name || "Custom data", parsed, resolved, matchedStudies, types);
    if (!d.rows.length) { setErr("no row matched a " + parsed.level + " of " + matchedStudies.join(", ") + ": nothing to save"); return; }
    if (d.rows.length * d.columns.length > LIMITS.cells) {
      setErr("this upload has " + (d.rows.length * d.columns.length).toLocaleString() + " values; the limit is " + LIMITS.cells.toLocaleString()); return;
    }
    setBusy(true);
    try { await saveToServer(d, serverBySlug(d.id)?.id); }
    catch (e) { setErr(String((e as Error).message || e)); setBusy(false); return; }
    setBusy(false);
    reset();
    onAdded(d.name);
  };

  const matchedRows = resolved ? resolved.matches.filter((m) => m.length).length : 0;
  // the name a save would use, so a clash with a server dataset reads as "a new version of it"
  const slugPreview = (name || "Custom data").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "custom";
  const rate = parsed && parsed.rows.length ? matchedRows / parsed.rows.length : 0;
  const stale = !!resolved && matchedStudies.join(",") !== studies.join(",");
  const target = matchedStudies.length === 1 ? matchedStudies[0] : matchedStudies.length + " studies";
  const downloadDropped = () => {
    if (!parsed || !resolved) return;
    const lines = [[parsed.idColumn, ...parsed.columns.map((c) => c.header)].join("\t"),
      ...parsed.rows.filter((_, i) => !resolved.matches[i]?.length).map((r) => r.join("\t"))];
    const url = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/tab-separated-values" }));
    const a = document.createElement("a"); a.href = url; a.download = "dropped-rows.tsv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const unmatchedExamples = resolved && parsed
    ? parsed.rows.filter((_, i) => !resolved.matches[i]?.length).slice(0, 5).map((r) => r[0]) : [];

  return (
    <section className="cd-add">
        <div className="cd-step"><span className="cd-num">1</span><h4>Load a table</h4>
          {studies.length > 0 && <span className="cd-target">
            for {studies.map((st) => <span key={st} className="qchip">{st}</span>)}
          </span>}
        </div>
        {!studies.length
          ? <p className="error">Select the study this data belongs to (top of Explore) before uploading: ids are matched against it.</p>
          : <div className={"cd-drop" + (dragging ? " over" : "")}
              onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
              onDrop={(e) => { e.preventDefault(); setDragging(false); void loadFile(e.dataTransfer.files?.[0]); }}>
              <div className="cd-drophead">
                <svg viewBox="0 0 16 16" aria-hidden><path d="M8 1.5 4.5 5h2.25v5h2.5V5h2.25ZM2 11v3h12v-3h-1.5v1.5h-9V11Z" /></svg>
                <span><b>Drag a .tsv or .csv file here</b>, <label className="cd-pick">choose a file
                  <input type="file" accept=".tsv,.txt,.csv,.tab,text/plain,text/csv,text/tab-separated-values"
                    onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = ""; }} /></label>, or paste below</span>
                <span className="spacer" />
                <Button variant="outline" size="sm" className={TB} disabled={exampleBusy} onClick={loadExample}
                  title={"a few of " + studies[0] + "'s own patients with made-up values, so it can be added as it stands"}>
                  {exampleBusy ? <><LoaderCircle className="animate-spin" /> loading…</> : "Use example data for " + studies[0]}
                </Button>
              </div>
              <Textarea className="customdata-text bg-card font-mono text-md md:text-md" rows={text ? 8 : 4} spellCheck={false} value={text}
                placeholder={PLACEHOLDER} onChange={(e) => { setText(e.target.value); setParsed(null); setResolved(null); }} />
              {dragging && <div className="cd-dropover">Drop to load</div>}
            </div>}
        <details className="cd-format">
          <summary>File format</summary>
          A header row, then one row per case, tab- or comma-separated. The first column is the case id: name it{" "}
          <code>PATIENT_ID</code> or <code>SAMPLE_ID</code>{studies.length > 1 && <>; prefix one as <code>study:id</code> to pin it to one of the studies</>}.
          Every other column becomes an attribute. Rows whose id matches no {studies.length === 1 ? "patient or sample of the study" : "patient or sample of these studies"} are dropped, and the check below says which.
          {" "}Cell-level data on Cell Explorer is summarised per patient and sample on <a href="/singlecell">the single-cell page</a> first.
        </details>
        {text.trim() && !parsed && !busy && <div className="row center g5">
          <Button variant="outline" size="sm" className={TB} onClick={() => preview()}>Check ids</Button>
          <Button variant="link" size="inline" className="text-md" onClick={reset}>clear</Button>
        </div>}
        {busy && !parsed && <p className="meta"><span className="spinner" /> matching ids…</p>}
        {err && <p className="error">{err}</p>}

        {parsed && <>
          <div className="cd-step"><span className="cd-num">2</span><h4>Check</h4>
            <span className="meta">{parsed.rows.length.toLocaleString()} rows · id column <code>{parsed.idColumn}</code> → {parsed.level} level
              {parsed.warnings.length > 0 && <> · {parsed.warnings.join("; ")}</>}</span>
          </div>
          {busy && <p className="meta"><span className="spinner" /> matching ids…</p>}
          {resolved && <p className={"cd-match" + (resolved.unmatched ? "" : " ok")}>
            <b>{matchedRows.toLocaleString()} of {parsed.rows.length.toLocaleString()}</b> rows matched a {parsed.level} of {matchedStudies.join(", ")}
            {!resolved.unmatched && " ✓"}
            {resolved.multiStudy > 0 && <> · {resolved.multiStudy} ids exist in more than one study and apply to each</>}
            {resolved.refused.length > 0 && <> · not matched against {resolved.refused.map((r) => r.study + " (" + r.reason + ")").join(", ")}</>}
          </p>}
          {resolved && resolved.unmatched > 0 && <p className={rate < LOW_MATCH ? "error" : "customdrop"}>
            <b>{resolved.unmatched.toLocaleString()} row{resolved.unmatched === 1 ? "" : "s"} will be dropped</b>: {resolved.unmatched === 1 ? "its id matches" : "their ids match"} no {parsed.level} in {matchedStudies.join(", ")}
            {" "}(e.g. {unmatchedExamples.map((x) => <code key={x}>{x}</code>).reduce((a: React.ReactNode[], x, i) => i ? [...a, ", ", x] : [x], [])}).{" "}
            <Button variant="link" size="inline" className="text-md" onClick={downloadDropped}>download them</Button>
            {rate < LOW_MATCH && <> — are these {parsed.level === "patient" ? "sample" : "patient"} ids, or ids from another study?</>}
          </p>}
          {stale && <p className="error">The studies being explored changed since this check. <Button variant="link" size="inline" className="text-md" onClick={() => preview()}>Check again</Button> against {studies.join(", ") || "the new selection"}.</p>}
          <div className="attrtablewrap" style={{ maxHeight: "30vh" }}>
            <table className="attrtable">
              <thead><tr><th>Attribute</th><th>Type</th><th>Values</th><th>Distinct</th><th></th></tr></thead>
              <tbody>
                {parsed.columns.map((c) => (
                  <tr key={c.name} style={{ cursor: "default" }}>
                    <td><code>{c.name}</code></td>
                    <td>
                      <OptionSelect value={types[c.name] ?? c.datatype}
                        onValueChange={(v) => setTypes((t) => ({ ...t, [c.name]: v as "STRING" | "NUMBER" }))}>
                        <option value="STRING">categorical</option>
                        <option value="NUMBER" disabled={c.datatype !== "NUMBER"}>numeric</option>
                      </OptionSelect>
                    </td>
                    <td className="meta">{c.filled.toLocaleString()} of {parsed.rows.length.toLocaleString()}</td>
                    <td className="meta">{c.distinct.toLocaleString()}</td>
                    <td className="meta">
                      {c.datatype !== "NUMBER" && c.distinct > 50 && "many distinct values: free text charts poorly"}
                      {c.looksLikeDate && "dates are kept as text"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="cd-step"><span className="cd-num">3</span><h4>Name and add</h4></div>
          <div className="row center g5">
            <Input type="text" placeholder="dataset name (e.g. Brain mets — curated)" value={name}
              onChange={(e) => setName(e.target.value)} className="h-8 w-96 text-md md:text-md" />
            {rate < LOW_MATCH && !confirmLow
              ? <Button variant="outline" size="sm" className={TB} disabled={!resolved || !matchedRows || stale} onClick={() => setConfirmLow(true)}>Save anyway…</Button>
              : <Button size="sm" disabled={!resolved || !matchedRows || busy || stale} onClick={save}
                  title="stored on the server: anyone who logs in can read it, and analyses that use it can be shared">
                  Add data to {target}{serverBySlug(slugPreview) ? " (as v" + (serverBySlug(slugPreview)!.latestVersion + 1) + " of " + slugPreview + ")" : ""}</Button>}
            <Button variant="link" size="inline" className="text-md" onClick={reset}>start over</Button>
          </div>
          <p className="meta">Its columns become <code>custom:{slugPreview}/…</code> attributes.</p>
        </>}
    </section>
  );
}

function SavedCustomData({ onChanged, onAdd }: { onChanged: () => void; onAdd: () => void }) {
  const server = useCustomDataState();
  const [serverBusy, setServerBusy] = useState<string | null>(null);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const serverAct = async (label: string, f: () => Promise<unknown>) => {
    setServerBusy(label); setServerErr(null);
    try { await f(); onChanged(); } catch (e) { setServerErr(String((e as Error).message || e)); }
    finally { setServerBusy(null); }
  };
  const removeServer = (d: DatasetMeta) => {
    if (!confirm("Delete “" + d.name + "” from the server? Analyses pinned to it will be refused, with the date it was deleted.")) return;
    void serverAct("deleting…", () => deleteServerDataset(d.id));
  };
  const exportServer = (d: DatasetMeta) => serverAct("exporting…", async () => download(await fetchServerVersion(d.id, d.latestVersion)));
  const groups = useGroups(server.user?.id ?? null);
  const [sharing, setSharing] = useState<DatasetMeta | null>(null);

  const download = (d: StoredDataset) => {
    const url = URL.createObjectURL(new Blob([datasetToTsv(d)], { type: "text/tab-separated-values" }));
    const a = document.createElement("a"); a.href = url; a.download = d.id + ".tsv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="cd-saved">
      <h4>Saved datasets{server.datasets.length ? " (" + server.datasets.length + ")" : ""}</h4>
      <p className="meta flush">
        Yours, and others' shared with you. A saved version never changes; an analysis that uses one is
        pinned to it. Each holds patient-level values: share one only with people entitled to them.
      </p>
      {server.datasets.length ? (
        <div className="attrtablewrap" style={{ maxHeight: "30vh" }}>
          <table className="attrtable customlist">
            <thead><tr><th>Dataset</th><th>Columns</th><th>Rows</th><th>Studies</th><th></th></tr></thead>
            <tbody>
              {server.datasets.map((d) => {
                const v = d.versions.find((x) => x.version === d.latestVersion);
                return (
                  <tr key={d.id} style={{ cursor: "default" }}>
                    <td><b>{d.name}</b> <span className="meta">custom:{d.slug} · {d.level} level · v{d.latestVersion}
                      {d.versions.length > 1 ? " of " + d.versions.length : ""} · {new Date(d.updatedAt).toLocaleDateString()}
                      {" · "}{d.rights.share ? "shared with " + sharingLabel(d.sharing) : "from " + d.ownerEmail}</span></td>
                    <td className="meta">{v?.columns.map((c) => c.name).join(", ")}</td>
                    <td className="meta">{v?.rowCount.toLocaleString()} {d.level}s</td>
                    <td className="meta">{v?.studies.join(", ")}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Button variant="outline" size="sm" className={TB} disabled={!!serverBusy} onClick={() => exportServer(d)}><Download />Export</Button>{" "}
                      {d.rights.share && <><Button variant="outline" size="sm" className={TB} disabled={!!serverBusy} onClick={() => setSharing(d)}><Share2 />Share…</Button>{" "}
                        <Button variant="outline" size="sm" className={cn(TB, "text-destructive hover:text-destructive")} disabled={!!serverBusy} onClick={() => removeServer(d)}><Trash2 />Delete</Button></>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="meta">Nothing saved yet. <Button variant="link" size="inline" className="text-md" onClick={onAdd}>Add data</Button></p>}
      {serverBusy && <p className="meta"><span className="spinner" /> {serverBusy}</p>}
      {serverErr && <p className="error">{serverErr}</p>}
      {sharing && <ShareDialog kind="custom dataset" name={sharing.name} sharing={sharing.sharing}
        groups={groups.groups} groupsError={groups.error}
        onSave={async (s) => { await shareServerDataset(sharing.id, s); onChanged(); }}
        onClose={() => setSharing(null)} />}
    </section>
  );
}

/**
 * The Custom data dialog, opened on one of its tabs (`tab`), closed with null. Uploads match their
 * ids against the explored studies (`studies`); `onChanged` re-runs Explore so a new or deleted
 * dataset's attributes appear or go.
 */
export default function CustomDataManager({ tab, setTab, studies, onChanged }: {
  tab: CustomDataTab | null; setTab: (t: CustomDataTab | null) => void; studies: string[]; onChanged: () => void;
}) {
  const server = useCustomDataState();
  const [added, setAdded] = useState<string | null>(null);
  useEffect(() => { if (!tab) setAdded(null); }, [tab]);
  return (
    <Dialog open={!!tab} onOpenChange={(open) => { if (!open) setTab(null); }}>
    <DialogContent aria-describedby={undefined}
      className="customdatamanager flex h-[90vh] w-[94vw] max-w-[94vw] flex-col gap-3 overflow-auto p-6 sm:max-w-[94vw]">
      <DialogHeader><DialogTitle className="text-base">Custom data</DialogTitle></DialogHeader>
      <Tabs value={tab || "add"} onValueChange={(v) => setTab(v as CustomDataTab)}>
        <TabsList variant="line" className="w-full justify-start gap-1.5 border-b border-border p-0 group-data-[orientation=horizontal]/tabs:h-auto">
          <TabsTrigger value="add" className={TAB}>Add data</TabsTrigger>
          <TabsTrigger value="manage" className={TAB}>
            Manage{server.unlocked && server.datasets.length ? " (" + server.datasets.length + ")" : ""}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="customdata">
        <p className="note flush">
          Your own annotations (a curated metastasis site, a field extracted from the record), used like any clinical
          attribute: as a chart and filter in Explore, an oncoprint track or split, in comparisons and survival.
        </p>
        {!server.enabled && <p className="meta">
          This deployment does not store custom data: it has no sign-in.
          The gallery&apos;s custom-data example still runs, on demo data bundled with the app.</p>}
        {server.enabled && !server.unlocked && (
          <div className="cd-login">
            <span>Custom data is stored on the server. Sign in to add, see and use it.</span>
            <Button size="sm" onClick={requestLogin}>Sign in</Button>
          </div>
        )}
        {server.unlocked && tab === "add" && <AddCustomData studies={studies}
          onAdded={(name) => { setAdded(name); onChanged(); setTab("manage"); }} />}
        {server.unlocked && tab === "manage" && <>
          {added && <p className="cd-added">Added &ldquo;{added}&rdquo;. Its attributes are charted in Explore; choose which
            under <b>+ Add chart → Custom data</b>.</p>}
          <SavedCustomData onChanged={onChanged} onAdd={() => setTab("add")} />
        </>}
      </div>
      <DialogFooter className="mt-auto">
        <DialogClose asChild><Button>Done</Button></DialogClose>
      </DialogFooter>
    </DialogContent>
    </Dialog>
  );
}
