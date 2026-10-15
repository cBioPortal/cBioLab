"use client";
// The Analysis tab's own sections: the cohort column, the views column (its header, the add-view
// buttons and the view cards), the document dialog, the genes dialog, and the notice when the
// document names custom data that is not here. The page holds the state; each section reads it
// and the page's actions from one AnalysisCtx.
import { useState } from "react";
import { Braces, LoaderCircle, Play, Plus, Save, X } from "lucide-react";
import { Button } from "../_ui/button";
import { CHIP } from "../_ui/toolbar.ts";
import { cn } from "../../lib/cn";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Textarea } from "../_ui/textarea";
import CohortPills from "./pills";
import { GeneListEditor } from "../_oncoprint/OncoprintCard.tsx";
import type { GeneTrackSpec } from "../../lib/gene-tracks.ts";
import type { AnalysisDoc, AnalysisResult, CohortDef, PartitionDef } from "../../lib/types.ts";
import type { CustomDataFocus } from "./custom-data-dialog.tsx";
import type { CustomDataTab } from "./custom-data-panel.tsx";
import { PartitionPanel, SplitForm, type SplitSpec } from "./partitions.tsx";
import type { DocUpgrade } from "../../lib/doc-version.ts";
import type { OnCustomData } from "./pills";
import { requestLogin, referencedDatasets, unresolvedUploads } from "./custom-data-client.ts";
import { CohortStudies, CohortEditMenu, SeriesSwatch, ViewHead } from "./view-chrome.tsx";
import { cohortHash, shortHash } from "../../lib/cohort-hash.ts";
import { sameJson } from "../../lib/same-json.ts";
import { viewIsEmpty } from "../../lib/partition-arms.ts";
import type { CohortSaveState, CohortSourceState } from "./use-cohort-edits.ts";
import { ViewCard, LoadingViewCard } from "./view-cards.tsx";
import type { DocStore } from "./doc-store.ts";
import type { SavedCohort, SavedWorkspace } from "./use-saved.ts";
import type { ExploreResult } from "../../lib/types.ts";
import type { ViewCtx } from "./view-cards.tsx";

/** A view kind already in the document: filled with the accent colour, so "on" cannot be mistaken
 *  for a chip still loading (a pale pulsing fill). */
const VIEW_ON = "aria-pressed:bg-primary aria-pressed:text-primary-foreground hover:aria-pressed:bg-primary/90 " +
  "hover:aria-pressed:text-primary-foreground dark:aria-pressed:bg-primary dark:hover:aria-pressed:bg-primary/90";

/** What the Analysis tab's sections read from the page and the actions they can take; the page builds one per render. */
export interface AnalysisCtx {
  VIEW_KINDS: { kind: string; label: string; why?: () => string | null; loading?: () => boolean; }[];
  addView: (kind: string) => void;
  applyText: () => void;
  busy: boolean;
  catalogAttrs: () => { attribute: string; kind: string; }[];
  clearAnalysis: () => void;
  doc: AnalysisDoc;
  docDialog: React.RefObject<HTMLDialogElement | null>;
  docText: string;
  docs: DocStore;
  explore: ExploreResult | null;
  fetchExplore: (draftOverride?: CohortDef | null, studiesOverride?: string[] | string, attrsOverride?: string[]) => void;
  genesFor: number | null;
  goTab: (t: "explore" | "cohorts" | "analysis" | "examples") => void;
  menuOpenRef: React.RefObject<Map<string, boolean>>;
  /** open "+ Add cohort" for the view at vi */
  openCohortChooser: (vi: number) => void;
  /** where a copied cohort stands against the saved cohort it came from (use-cohort-edits.ts) */
  cohortSource: (name: string) => CohortSourceState | null;
  updateFromSaved: (name: string) => void;
  /** whether a cohort has anything to save to the library, and the action that saves it */
  cohortSaveState: (name: string) => CohortSaveState | null;
  saveCohortToLibrary: (name: string) => Promise<void>;
  /** the single-cell dataset a cohort's patients can be opened in (lib/cell-explorer.ts), and opening it */
  cohortCells: (name: string) => import("../../lib/cell-explorer.ts").CellExplorerDataset | null;
  openCohortCells: (name: string) => Promise<void>;
  loggedIn: boolean;
  viewTitle: (kind: string) => string;
  emptyViewHint: (kind: string) => string;
  moveView: (i: number, dir: -1 | 1) => void;
  removeView: (i: number) => void;
  openCohortEdit: (name: string) => void;
  openCustomManager: (on?: CustomDataTab) => void;
  openWorkspaceSave: () => void;
  removeCohort: (name: string) => void;
  removePartitionNamed: (name: string) => void;
  removeViews: (drop: (v: any, i: number) => boolean) => void;
  renamePartitionRow: (name: string, from: string, to: string) => void;
  result: AnalysisResult | null;
  saved: Record<string, SavedCohort>;
  setCdFocus: React.Dispatch<React.SetStateAction<CustomDataFocus | null>>;
  setGenesFor: React.Dispatch<React.SetStateAction<number | null>>;
  setPartitionDef: (name: string, def: PartitionDef) => void;
  setUpgradeNote: React.Dispatch<React.SetStateAction<DocUpgrade | null>>;
  setViewGenes: (vi: number, genes: GeneTrackSpec[]) => void;
  showClauseData: (cohort?: string) => OnCustomData;
  spaces: Record<string, SavedWorkspace>;
  splitCohortBy: (cohort: string, spec: SplitSpec) => Promise<void>;
  splitsFlat: () => Record<string, PartitionDef>;
  studyNames: Map<string, string>;
  tab: "explore" | "cohorts" | "analysis" | "examples";
  upgradeNote: DocUpgrade | null;
  viewCtx: Omit<ViewCtx, "result">;
  viewIds: number[];
}


export function GenesDialog({ ctx }: { ctx: AnalysisCtx }) {
  const { busy, doc, genesFor, setGenesFor, setViewGenes } = ctx;
  return (
    <Dialog open={genesFor != null} onOpenChange={(open) => { if (!open) setGenesFor(null); }}>
      {genesFor != null && (
        <DialogContent aria-describedby={undefined} className="genedialog gap-3 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Genes <span className="font-normal text-muted-foreground">— {String(((doc.views || [])[genesFor] as any)?.kind || "view")}</span></DialogTitle>
          </DialogHeader>
          {/* the DOCUMENT's view, never the result (a result's genes are {gene, driverPct, …}) */}
          <GeneListEditor view={(doc.views || [])[genesFor] || {}} busy={busy} onGenes={(g) => setViewGenes(genesFor, g)} />
          <DialogFooter>
            <DialogClose asChild><Button>Done</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

export function CustomDataWarning({ ctx }: { ctx: AnalysisCtx }) {
  const { doc, tab } = ctx;
  return <>
    {tab === "analysis" && (() => {
      // a shared document can name server custom data that is locked here, deleted, or absent
      const unresolved = unresolvedUploads(doc);
      const of = (why: string) => unresolved.filter((u) => u.why === why).map((u) => u.as);
      const names = (ids: string[]) => ids.map((id, i) => <span key={id}>{i ? ", " : ""}<code>custom:{id}</code></span>);
      return unresolved.length > 0 && (
        <div className="card customwarn">
          {of("locked").length > 0 && <p className="flush">This analysis uses custom data ({names(of("locked"))}).{" "}
            <Button variant="link" size="inline" onClick={requestLogin}>Sign in</Button> to run it.</p>}
          {of("deleted").length > 0 && <p className="flush">This analysis is pinned to custom data that has since been deleted: {names(of("deleted"))}.</p>}
          {of("missing").length > 0 && <p className="flush">This analysis uses custom data that is not on the server: {names(of("missing"))}.</p>}
          {of("unavailable").length > 0 && <p className="flush">This analysis uses custom data ({names(of("unavailable"))}), which this deployment does not store.</p>}
        </div>
      );
    })()}
  </>;
}

/** One view with no cohorts yet: its header (to move or remove it), what it will draw, and "+ Add cohort". */
function EmptyViewCard({ ctx, vi }: { ctx: AnalysisCtx; vi: number }) {
  const { busy, doc, emptyViewHint, menuOpenRef, moveView, openCohortChooser, removeView, viewTitle } = ctx;
  const dv: any = (doc.views || [])[vi] || {};
  const n = (doc.views || []).length;
  return (
    <div className="card viewcard emptyview">
      <ViewHead menuStore={menuOpenRef.current} v={{ kind: dv.kind, annotationNote: dv.note }} title={viewTitle(dv.kind)}
        onMoveUp={vi > 0 ? () => moveView(vi, -1) : undefined} onMoveDown={vi < n - 1 ? () => moveView(vi, 1) : undefined}
        onRemove={() => removeView(vi)} />
      <div className="emptyview-body">
        <p className="emptyview-lead">This view has no cohorts yet.</p>
        <p>{emptyViewHint(dv.kind)} Pick one from this analysis or your library, or build one in Explore.</p>
        <Button disabled={busy} onClick={() => openCohortChooser(vi)}><Plus />Add cohort</Button>
      </div>
    </div>
  );
}

export function CohortColumn({ ctx }: { ctx: AnalysisCtx }) {
  const { busy, catalogAttrs, cohortCells, cohortSaveState, cohortSource, doc, openCohortCells, loggedIn, menuOpenRef, openCohortEdit, removeCohort, removePartitionNamed, renamePartitionRow, result, saveCohortToLibrary, setPartitionDef, setUpgradeNote, showClauseData, spaces, splitCohortBy, splitsFlat, studyNames, updateFromSaved, upgradeNote, viewTitle } = ctx;
  const [cohortOpen, setCohortOpen] = useState<Set<string>>(() => new Set());
  const names = Object.keys(doc.cohorts || {});
  const flat = splitsFlat();
  const usedIn = (n: string) => (doc.views || [])
    .filter((v: any) => (Array.isArray(v.cohorts) ? v.cohorts : []).some((c: string) => c === n || c.startsWith(n + " / ")) || v.splitBy?.cohort === n)
    .map((v: any) => viewTitle(v.kind));
  return <>
    <div>
      {upgradeNote && (
        <p className="note upgradenote">
          This analysis was written {upgradeNote.from === "unversioned" ? "before analyses carried a version" : "for DSL " + upgradeNote.from} and has been upgraded to {upgradeNote.to}
          {upgradeNote.changes.length ? ": " + upgradeNote.changes.join("; ") : ""}. Saving it, or sharing its link, uses the new version.{" "}
          <Button variant="link" size="inline" onClick={() => setUpgradeNote(null)}>dismiss</Button>
        </p>
      )}
      {/* The analysis's cohorts are not its top level: each view names the ones it draws, and these
          cards summarise them — each with the views that draw it and the saved cohort it was copied
          from. Cohorts come in through a view's "+ Add cohort". */}
      {names.length > 0 && (
        <section className="cohortsum" aria-label="cohorts in this analysis">
          <h2 className="vtitle flex items-center gap-2.5 mb-4">
            Cohorts in this analysis <span className="plain meta">— add one from a view</span>{busy && <span className="spinner" />}
          </h2>
          <div className="cohortlist">
            {names.map((n, i) => {
              const c = result?.cohorts[n];
              const splits = Object.keys(flat).filter((k) => flat[k].of === n);
              const views = usedIn(n);
              const open = cohortOpen.has(n);
              const src = cohortSource(n);
              const toSave = cohortSaveState(n);
              const toggle = () => setCohortOpen((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; });
              return (
                <div key={n} className={"cohortgroup" + (splits.length ? " hassplit" : "")}>
                  <div className="cohortbox">
                    <CohortEditMenu busy={busy} canEdit={!!(doc.title && spaces[doc.title])}
                      onEdit={() => openCohortEdit(n)} onRemove={() => removeCohort(n)}
                      split={(done: () => void) => <SplitForm cohort={n} attrs={catalogAttrs()} busy={busy} onSplit={splitCohortBy} onDone={done} />}
                      splitCount={splits.length}
                      save={toSave && { onSave: () => saveCohortToLibrary(n), label: toSave.action === "create" ? "save to library" : "save changes to library",
                        title: toSave.action === "create" ? "save “" + toSave.as + "” to your library, to add it to other analyses"
                          : "write this cohort's definition and splits over “" + toSave.as + "” in your library" }}
                      cells={cohortCells(n)} onCells={() => openCohortCells(n)}
                      menuId={"cohort:" + n} menuStore={menuOpenRef.current} />
                    <div className="cohortbox-head">
                      <span className="cohortbox-name"><SeriesSwatch i={i} />{n}</span>
                      {c ? <><strong>{c.count.toLocaleString()}</strong> <span className="meta">patients</span></>
                        : busy ? <span className="skeleton cohortsum-skel" /> : null}
                    </div>
                    <CohortStudies ids={c?.studies && c.studies.length ? c.studies : [doc.cohorts?.[n]?.study || doc.study || result?.study].filter(Boolean) as string[]}
                      names={studyNames} />
                    {doc.cohorts?.[n] && <CohortPills def={doc.cohorts[n]} onCustomData={showClauseData(n)} />}
                    {doc.cohorts?.[n]?.notes && <p className="note">{doc.cohorts[n].notes}</p>}
                    <div className="cohortbox-foot">
                      <span className={"cohortsum-views" + (views.length ? "" : " unused")} title={views.join(", ")}>
                        {views.length ? "in " + views.join(", ") : "in no view"}
                      </span>
                      {src && <button className={"srcbadge" + (src.state === "changed" ? " changed" : "")} aria-expanded={open} onClick={toggle}
                        title={src.state === "changed" ? "the saved cohort “" + src.srcName + "” has changed since this copy was made — open to compare and update"
                          : src.state === "deleted" ? "copied from a saved cohort “" + src.from.name + "” that has since been deleted"
                          : "copied from the saved cohort “" + src.from.name + "”"}>
                        {src.state === "changed" ? "saved version changed" : src.state === "deleted" ? "source deleted" : "#" + shortHash(src.from.hash)}</button>}
                    </div>
                    {open && src && (
                      <div className="cohortsrc meta">
                        <span>Copied from saved cohort <strong>“{src.from.name}”</strong>{src.from.savedAt ? " (saved " + src.from.savedAt + ")" : ""}
                          {" "}· definition <code title={src.from.hash}>#{shortHash(src.from.hash)}</code>.</span>
                        {src.state === "unknown" && <span> {loggedIn ? "Checking the saved cohort…" : "Sign in to compare it with the saved cohort."}</span>}
                        {src.state === "deleted" && <span> That saved cohort has since been deleted; this copy is unaffected.</span>}
                        {(src.state === "current" || src.state === "changed") && src.srcName !== src.from.name && <span> It is now named “{src.srcName}”.</span>}
                        {src.state === "current" && !src.edited && <span> The saved cohort is unchanged.</span>}
                        {src.edited && <span> This copy has been edited here since (now <code>#{shortHash(cohortHash(doc.cohorts![n]))}</code>).</span>}
                        {src.state === "changed" && <span className="cohortsrc-changed"> The saved cohort has changed since (now <code title={src.now}>#{shortHash(src.now!)}</code>, saved {src.src!.savedAt}).</span>}
                        {(src.state === "changed" || (src.state === "current" && src.edited)) && <>
                          {src.state === "changed" && <div className="cohortsrc-new"><span className="meta">The saved version:</span> <CohortPills def={src.src!.def} /></div>}
                          <Button variant="outline" size="sm" className="h-ctl" disabled={busy} onClick={() => updateFromSaved(n)}
                            title={"replace this copy's definition with the saved cohort's; every view drawing “" + n + "” re-runs"}>
                            {src.state === "changed" ? "Update to the saved version" : "Revert to the saved version"}</Button>
                        </>}
                      </div>
                    )}
                  </div>
                  {result && splits.length > 0 && <div className="cohortgroup-splits">
                    {splits.map((k) => (
                      <PartitionPanel key={k} name={k} partitions={flat} results={result.splits}
                        cohortText={(x) => result.cohorts[x]?.text} attrs={catalogAttrs()} busy={busy}
                        onChange={setPartitionDef} onRename={renamePartitionRow} onRemove={removePartitionNamed} onSplit={splitCohortBy} />
                    ))}
                  </div>}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  </>;
}

export function DocDialog({ ctx }: { ctx: AnalysisCtx }) {
  const { applyText, busy, clearAnalysis, doc, docDialog, docText, docs, result } = ctx;
  return <>
    {/* The document's JSON, generated SQL and run/clear controls: a dialog rather than a
        permanent column, so the leftbar can just be cohorts. A native <dialog>, so the editor
        stays in the page while it is closed — anything reading the document from outside
        React finds #docjson. */}
    {/* eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-noninteractive-element-interactions -- a click on the backdrop closes the modal; Escape closes it from the keyboard */}
    <dialog ref={docDialog} data-tw aria-labelledby="doctitle"
      className="docdialog m-auto max-h-[85vh] w-[min(90vw,48rem)] max-w-3xl overflow-auto rounded-lg border bg-card p-6 text-foreground shadow-lg backdrop:bg-black/50"
      onClick={e => { if (e.target === docDialog.current) docDialog.current?.close(); }}>
      <div className="mb-3 flex items-baseline justify-between">
        <h3 id="doctitle" className="text-base font-semibold">The document <span className="font-normal text-muted-foreground">— views</span></h3>
        <Button variant="ghost" size="icon-sm" aria-label="close" onClick={() => docDialog.current?.close()}><X /></Button>
      </div>
      {/* id, because the notes textarea above it also matches "textarea" —
          anything reading the document from outside React needs to be
          able to say WHICH one. */}
      <Textarea id="docjson" value={docText} onChange={e => docs.setText(e.target.value)} spellCheck={false}
        className="h-80 resize-y bg-muted font-mono text-xs md:text-xs" />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={applyText}>{busy ? <LoaderCircle className="animate-spin" /> : <Play />}{busy ? "Running…" : "Run document"}</Button>
        {doc.cohorts && Object.keys(doc.cohorts).length > 0 &&
          <Button variant="outline" disabled={busy} title="empty the document — removes all cohorts and views" onClick={clearAnalysis}>Clear analysis</Button>}
        {result && <span className="text-sm text-muted-foreground">{result.stats.ms}ms · OncoKB {result.oncokbPin}</span>}
      </div>
      <p className="mt-3 text-md text-muted-foreground">Views: <code>{`{"kind":"compare","genes":[…]}`}</code> · <code>{`{"kind":"survival"}`}</code> · <code>{`{"kind":"oncoprint","genes":[…],"clinical":[attrs…]}`}</code></p>
      {result && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Generated SQL (provenance) — the exact query each cohort compiled to, per study · OncoKB pin {result.oncokbPin || "none"}
          </summary>
          {Object.entries(result.cohorts).map(([n, c]) => (
            <div className="mt-2.5" key={n}>
              <p className="mb-1 text-sm text-muted-foreground"><strong className="text-foreground">{n}</strong> — {c.count.toLocaleString()} patients{c.studies && c.studies.length > 1 ? " across " + c.studies.length + " studies" : ""}</p>
              <pre className="max-h-64 overflow-auto rounded-lg border bg-muted p-2.5 text-xs whitespace-pre">{c.sql}</pre>
            </div>
          ))}
        </details>
      )}
    </dialog>
  </>;
}

export function ViewColumn({ ctx }: { ctx: AnalysisCtx }) {
  const { VIEW_KINDS, addView, busy, doc, docDialog, explore, fetchExplore, goTab, openWorkspaceSave, removeViews, result, setCdFocus, spaces, viewCtx, viewIds } = ctx;
  return <>
    <div>
      {(busy || result || (doc.views || []).length > 0) && (
        <div className="row baseline mb-4">
          <h2 className="vtitle">
            Analysis{busy && <span className="spinner ml-1.5" />}
          </h2>
          <div className="vmeta">
            {/* The workspace lives behind this one button + a dialog, not
                a permanent card at the top of the column — it is read
                when setting the workspace up and almost never while
                reading the figures. What it's called and whether it's
                saved is what the dialog it opens is for; this button's
                own label stays fixed. */}
            {((doc.views || []).length > 0 || doc.title || doc.params || doc.notes) && (
              <Button variant="outline" size="sm" disabled={busy} onClick={openWorkspaceSave}
                title={doc.title
                  ? "“" + doc.title + "” — " + (spaces[doc.title] && sameJson(spaces[doc.title].doc, doc)
                      ? "saved " + spaces[doc.title].savedAt : "unsaved changes")
                  : "save this analysis as a named, reopenable workspace"}>
                <Save />
                Save analysis
              </Button>
            )}
            {(() => {
              const used = referencedDatasets(doc);
              return used.length > 0 && (
                <Button variant="link" size="inline" className="text-md" onClick={() => setCdFocus({ datasets: used })}
                  title="the uploads this analysis names, as stored in this browser">
                  custom data ({used.length})
                </Button>
              );
            })()}
            <Button variant="link" size="inline" className="text-md" onClick={() => docDialog.current?.showModal()}
              title="open the document's raw JSON — edit it, run it, or view generated SQL">
              <Braces />show document json
            </Button>
          </div>
        </div>
      )}
      {busy && !result && <div className="skeleton skeleton-addview" />}
      {busy && !result && (doc.views || []).map((dv: any, vi: number) => viewIsEmpty(dv)
        ? <EmptyViewCard key={viewIds[vi] ?? vi} ctx={ctx} vi={vi} />
        : <LoadingViewCard key={viewIds[vi] ?? vi} ctx={viewCtx} vi={vi} />)}
      {!busy && !result && !(doc.views || []).length && (
        <div className="card">
          <p className="note t-md flush">
            Start with a view: choose below what you want to see — survival, an oncoprint, a gene comparison — and
            then add its cohorts, from your library, from this analysis, or built on the{" "}
            <Button variant="link" size="inline" onClick={() => { goTab("explore"); if (!explore) fetchExplore(); }}>Explore page</Button>.
          </p>
        </div>
      )}
      {!(busy && !result) && (
        <div className="card addview">
          <div className="row center g2">
            <strong className="addview-title">Add a view</strong>
            <span className="meta">{(doc.views || []).length} of 6 in this document</span>
            <span className="spacer" />
            {VIEW_KINDS.map(({ kind, label, why, loading }) => {
              // a kind already in the document is selected; clicking it again removes it
              const present = (doc.views || []).filter((v: any) => v.kind === kind).length;
              if (present) return (
                <Button key={kind} variant="outline" size="xs" className={cn(CHIP, VIEW_ON)} aria-pressed disabled={busy}
                  title={"remove the " + label.toLowerCase() + " view" + (present > 1 ? "s (" + present + ")" : "")}
                  onClick={() => removeViews((v) => v.kind === kind)}>{label}{present > 1 && " ×" + present}<X /></Button>
              );
              const full = (doc.views || []).length >= 6;
              // with no cohorts yet there is no study to ask about: the view's cohorts decide later
              const known = Object.keys(doc.cohorts || {}).length > 0;
              const waiting = !full && known && !!loading && loading();
              const blocked = full ? "this document already has the maximum of 6 views"
                : waiting ? "loading this study's catalog — a moment"
                : (known && why ? why() : null);
              return (
                <Button key={kind} variant="outline" size="xs" className={cn(CHIP, waiting && "chip-wave disabled:opacity-100")} aria-pressed={false}
                  aria-busy={waiting || undefined} disabled={!!blocked}
                  title={blocked || ("add a " + label.toLowerCase() + " view, then choose its cohorts")}
                  onClick={() => addView(kind)}><Plus />{label}</Button>
              );
            })}
          </div>
        </div>
      )}
      {!result && !busy && (doc.views || []).map((dv: any, vi: number) => viewIsEmpty(dv) ? <EmptyViewCard key={viewIds[vi] ?? vi} ctx={ctx} vi={vi} /> : null)}
      {result && result.views.map((v, vi) => v.empty ? <EmptyViewCard key={viewIds[vi] ?? vi} ctx={ctx} vi={vi} /> : (
        <ViewCard key={viewIds[vi] ?? vi} ctx={{ ...viewCtx, result }} v={v} vi={vi} />
      ))}
    </div>
  </>;
}
