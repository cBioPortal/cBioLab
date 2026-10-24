"use client";
// The Custom data dialog: upload a table of curated annotations and check how it matched the
// explored studies. What is stored is seen, exported, shared and deleted in the saved-work manager
// (app/_saved/data-panel.tsx). Owns its own draft state, so typing into the paste box never
// re-renders the analysis page (see "Keystrokes stay in the field" in docs/UI.md). Which custom
// attributes are drawn as charts is chosen in Explore's Add chart dialog, like any other attribute.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  onCustomDataChange, loadCustomData, parseUpload, buildDataset, serverState, requestLogin, saveToServer, datasetToTsv, fetchServerVersion,
  serverBySlug, resolveIds, exampleUpload, type ParsedUpload, type ResolveResponse, type ServerState, type StoredDataset
} from "./custom-data-client.ts";
import { DatasetDiffView } from "./dataset-diff.tsx";
import { diffDatasets, type DatasetDiff } from "../../lib/custom-data-diff.ts";
import type { DatasetMeta } from "../../lib/custom-store.ts";
import { LIMITS } from "../../lib/custom-data-names.ts";
import { LoaderCircle } from "lucide-react";
import { Button } from "../_ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Input } from "../_ui/input";
import { Textarea } from "../_ui/textarea";
import { OptionSelect } from "../_ui/choice.tsx";
import { TB } from "../_ui/toolbar.ts";
import { cn } from "../../lib/cn";
import { useSaved } from "../_saved/saved-context.tsx";

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

/** where Custom data opens: adding an upload here, or the saved uploads in the saved-work manager */
export type CustomDataTab = "add" | "manage";

/**
 * Load, check and save an upload: a new dataset matched against the explored `studies`, or — with
 * `replacing` — the next version of a stored one, matched against that dataset's own studies and
 * starting from its current data to edit or replace. Saving over a stored dataset (`replacing`, or a
 * new upload whose name is one already stored) first shows what changes from its latest version, and
 * waits for a tick when anything is removed or overwritten.
 */
export function AddCustomData({ studies, onAdded, replacing }: { studies: string[]; onAdded: (name: string) => void; replacing?: DatasetMeta }) {
  const server = useCustomDataState();
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
  /** the stored version a save would replace, as read to compare against */
  const [base, setBase] = useState<(StoredDataset & { server: DatasetMeta; version: number }) | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [baseLoading, setBaseLoading] = useState(!!replacing);

  // editing a stored dataset starts from its current data, as the text it could be re-uploaded from
  useEffect(() => {
    if (!replacing) return;
    let live = true;
    fetchServerVersion(replacing.id, replacing.latestVersion)
      .then((b) => { if (!live) return; setBase(b); setText(datasetToTsv(b)); setName(b.name); })
      .catch((e) => { if (live) setErr("could not read v" + replacing.latestVersion + ": " + String((e as Error).message || e)); })
      .finally(() => { if (live) setBaseLoading(false); });
    return () => { live = false; };
  }, [replacing]);

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

  const reset = () => {
    setText(replacing && base ? datasetToTsv(base) : ""); setName(replacing && base ? base.name : "");
    setParsed(null); setResolved(null); setTypes({}); setErr(null); setConfirmLow(false); setConfirmed(false); setMatchedStudies([]);
  };
  /** the text was edited: what was checked no longer describes it */
  const edited = (t: string) => { setText(t); setParsed(null); setResolved(null); setConfirmed(false); };

  /** parse the table, match its ids against the studies, and read the stored version it would replace */
  const preview = async (t = text) => {
    setErr(null); setResolved(null); setConfirmLow(false); setConfirmed(false);
    let p: ParsedUpload;
    try { p = parseUpload(t); } catch (e) { setParsed(null); setErr(String((e as Error).message || e)); return; }
    setParsed(p);
    if (!studies.length) { setTypes(Object.fromEntries(p.columns.map((c) => [c.name, c.datatype]))); setErr("select a study above first: ids are matched against the studies being explored"); return; }
    setBusy(true);
    try {
      const into = target && (!base || base.server.id !== target.id || base.version !== target.latestVersion)
        ? await fetchServerVersion(target.id, target.latestVersion) : base;
      if (target) setBase(into);
      // a column kept from the stored version keeps its type unless its values no longer allow it
      const was = new Map((target && into ? into.columns : []).map((c) => [c.name, c.datatype]));
      setTypes(Object.fromEntries(p.columns.map((c) => [c.name, was.get(c.name) === "STRING" ? "STRING" : c.datatype])));
      setResolved(await resolveIds(studies, p.level, p.rows.map((r) => r[0])));
      setMatchedStudies([...studies]);
    } catch (e) { setErr(String((e as Error).message || e)); }
    finally { setBusy(false); }
  };

  /** a new dataset, or the next version of the stored one being replaced, as reviewed */
  const save = async () => {
    if (!parsed || !resolved) return;
    if (stale) { setErr("the studies being explored changed since the preview: preview again"); return; }
    if (target && !change) { setErr("check the changes from the saved version first"); return; }
    if (change?.diff?.same) { setErr("nothing changed from v" + change.version + ": nothing to save"); return; }
    if (change?.diff?.losesData && !confirmed) { setErr("tick the box to confirm the changes, including what they remove or overwrite"); return; }
    const d = draft!;
    if (!d.rows.length) { setErr("no row matched a " + parsed.level + " of " + matchedStudies.join(", ") + ": nothing to save"); return; }
    if (d.rows.length * d.columns.length > LIMITS.cells) {
      setErr("this upload has " + (d.rows.length * d.columns.length).toLocaleString() + " values; the limit is " + LIMITS.cells.toLocaleString()); return;
    }
    setBusy(true);
    try { await saveToServer(d, target && change ? { id: target.id, version: change.version } : undefined); }
    catch (e) { setErr(String((e as Error).message || e)); setBusy(false); return; }
    setBusy(false);
    reset();
    onAdded(d.name);
  };

  const matchedRows = resolved ? resolved.matches.filter((m) => m.length).length : 0;
  // the name a save would use, so a clash with a server dataset reads as "a new version of it"
  const slugPreview = replacing ? replacing.slug : (name || "Custom data").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "custom";
  const clash = replacing ? undefined : serverBySlug(slugPreview);
  /** the stored dataset a save adds a version to, as the server lists it now */
  const target = replacing ? server.datasets.find((x) => x.id === replacing.id) ?? replacing : clash;
  const draft = useMemo(() => parsed && resolved ? buildDataset(name || "Custom data", parsed, resolved, matchedStudies, types) : null,
    [parsed, resolved, name, matchedStudies, types]);
  /** what the save changes, against the version read for it — none while that is not the latest */
  const change = useMemo((): { version: number; diff: DatasetDiff | null; error?: string } | null => {
    if (!target || !draft || !base || base.server.id !== target.id || base.version !== target.latestVersion) return null;
    try { return { version: base.version, diff: diffDatasets(base, draft) }; }
    catch (e) { return { version: base.version, diff: null, error: String((e as Error).message || e) }; }
  }, [target, draft, base]);
  const rate = parsed && parsed.rows.length ? matchedRows / parsed.rows.length : 0;
  const stale = !!resolved && matchedStudies.join(",") !== studies.join(",");
  const studyLabel = matchedStudies.length === 1 ? matchedStudies[0] : matchedStudies.length + " studies";
  /** a stored dataset of this name that the reader may only read: saving would be refused */
  const readOnlyClash = !!clash && !clash.rights.edit;
  const needsTick = !!change?.diff?.losesData && !confirmed;
  const blocked = !!target && (!change || !change.diff || change.diff.same || needsTick);
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
        <div className="cd-step"><span className="cd-num">1</span><h4>{replacing ? "Edit, or load a replacement" : "Load a table"}</h4>
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
                {replacing
                  ? <Button variant="outline" size="sm" className={TB} disabled={!base} onClick={reset}
                      title={"discard the edits and start again from the saved v" + replacing.latestVersion}>Back to v{replacing.latestVersion}</Button>
                  : <Button variant="outline" size="sm" className={TB} disabled={exampleBusy} onClick={loadExample}
                      title={"a few of " + studies[0] + "'s own patients with made-up values, so it can be added as it stands"}>
                      {exampleBusy ? <><LoaderCircle className="animate-spin" /> loading…</> : "Use example data for " + studies[0]}
                    </Button>}
              </div>
              {baseLoading
                ? <p className="meta"><span className="spinner" /> reading v{replacing!.latestVersion}…</p>
                : <Textarea className={cn("customdata-text bg-card font-mono text-md md:text-md", replacing && "max-h-[40vh] overflow-auto")} rows={text ? (replacing ? 14 : 8) : 4} spellCheck={false} value={text}
                    aria-label="the table, tab- or comma-separated" placeholder={PLACEHOLDER} onChange={(e) => edited(e.target.value)} />}
              {dragging && <div className="cd-dropover">Drop to load</div>}
            </div>}
        <details className="cd-format">
          <summary>File format</summary>
          A header row, then one row per case, tab- or comma-separated. The first column is the case id: name it{" "}
          <code>PATIENT_ID</code> or <code>SAMPLE_ID</code>{studies.length > 1 && <>; prefix one as <code>study:id</code> to pin it to one of the studies</>}.
          Every other column becomes an attribute. Rows whose id matches no {studies.length === 1 ? "patient or sample of the study" : "patient or sample of these studies"} are dropped, and the check below says which.
        </details>
        {text.trim() && !parsed && !busy && <div className="row center g5">
          <Button variant="outline" size="sm" className={TB} onClick={() => preview()}>{replacing ? "Check changes" : "Check ids"}</Button>
          <Button variant="link" size="inline" className="text-md" onClick={reset}>{replacing ? "discard edits" : "clear"}</Button>
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

          <div className="cd-step"><span className="cd-num">3</span><h4>{target ? "Review the changes and save" : "Name and add"}</h4></div>
          {target && !replacing && resolved && <p className="meta flush">
            “{target.name}” is already stored under this name, so saving adds v{target.latestVersion + 1} of it rather than a new dataset.
            Rename this upload to keep both.</p>}
          {readOnlyClash && <p className="error">“{clash!.name}” is {clash!.ownerEmail}&apos;s, and you may read it but not add versions to it: rename this upload.</p>}
          {target && resolved && !readOnlyClash && (change?.error ? <p className="error">{change.error}</p>
            : change?.diff ? <DatasetDiffView diff={change.diff} level={parsed.level} version={change.version} name={target.name}
                confirmed={confirmed} onConfirm={setConfirmed} />
            : <p className="meta"><span className="spinner" /> reading v{target.latestVersion} to compare… {base && base.version !== target.latestVersion &&
                <>v{target.latestVersion} was saved since this check: <Button variant="link" size="inline" className="text-md" onClick={() => preview()}>check again</Button></>}</p>)}
          <div className="row center g5">
            <Input type="text" placeholder="dataset name (e.g. Brain mets — curated)" value={name} aria-label="dataset name"
              onChange={(e) => { setName(e.target.value); setConfirmed(false); }} className="h-8 w-96 text-md md:text-md" />
            {rate < LOW_MATCH && !confirmLow
              ? <Button variant="outline" size="sm" className={TB} disabled={!resolved || !matchedRows || stale} onClick={() => setConfirmLow(true)}>Save anyway…</Button>
              : <Button size="sm" className="cd-save" disabled={!resolved || !matchedRows || busy || stale || readOnlyClash || blocked} onClick={save}
                  title={change?.diff?.same ? "nothing changed from v" + change.version
                    : needsTick ? "tick the box above to confirm the changes first"
                    : "stored on the server: anyone who logs in can read it, and analyses that use it can be shared"}>
                  {target ? "Save as v" + (target.latestVersion + 1) + " of “" + target.name + "”" : "Add data to " + studyLabel}</Button>}
            <Button variant="link" size="inline" className="text-md" onClick={reset}>{replacing ? "discard edits" : "start over"}</Button>
          </div>
          <p className="meta">Its columns {target ? "stay" : "become"} <code>custom:{slugPreview}/…</code> attributes{target && <>; v{target.latestVersion} and
            every earlier version stay as they are, and analyses pinned to them keep reading them</>}.</p>
        </>}
    </section>
  );
}

/**
 * The Custom data dialog: an upload matched against the explored studies (`studies`), open while
 * `tab` is "add". Once saved it is managed with the rest of the reader's saved work, which opens on
 * its Custom data tab; `onChanged` re-runs Explore so the new dataset's attributes appear.
 */
export default function CustomDataManager({ tab, setTab, studies, onChanged }: {
  tab: CustomDataTab | null; setTab: (t: CustomDataTab | null) => void; studies: string[]; onChanged: () => void;
}) {
  const server = useCustomDataState();
  const saved = useSaved();
  return (
    <Dialog open={tab === "add"} onOpenChange={(open) => { if (!open) setTab(null); }}>
    <DialogContent aria-describedby={undefined}
      className="customdatamanager flex h-[90vh] w-[94vw] max-w-[94vw] flex-col gap-3 overflow-auto p-6 sm:max-w-[94vw]">
      <DialogHeader><DialogTitle className="flex items-baseline gap-2.5 text-base">Add custom data
        {server.unlocked && <Button variant="link" size="inline" className="ml-auto text-sm font-normal" onClick={() => { setTab(null); saved.open("data"); }}>
          your uploads{server.datasets.length ? " (" + server.datasets.length + ")" : ""}</Button>}</DialogTitle></DialogHeader>
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
        {server.unlocked && <AddCustomData studies={studies}
          onAdded={(name) => { onChanged(); setTab(null);
            saved.open("data", "Added “" + name + "”. Its attributes are charted in Explore; choose which under + Add chart → Custom data."); }} />}
      </div>
      <DialogFooter className="mt-auto">
        <DialogClose asChild><Button>Done</Button></DialogClose>
      </DialogFooter>
    </DialogContent>
    </Dialog>
  );
}
