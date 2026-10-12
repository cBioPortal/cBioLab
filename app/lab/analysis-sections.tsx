"use client";
// The Analysis tab's own sections: the cohort column, the views column (its header, the add-view
// buttons and the view cards), the document dialog, the genes dialog, and the notice when the
// document names custom data that is not here. The page holds the state; each section reads it
// and the page's actions from one AnalysisCtx.
import { useState } from "react";
import CohortPills from "./pills";
import { GeneListEditor } from "../_oncoprint/OncoprintCard.tsx";
import type { GeneTrackSpec } from "../../lib/gene-tracks.ts";
import type { AnalysisDoc, AnalysisResult, CohortDef, PartitionDef } from "../../lib/types.ts";
import type { CustomDataFocus } from "./custom-data-dialog.tsx";
import { PartitionPanel, SplitForm, type SplitSpec } from "./partitions.tsx";
import type { DocUpgrade } from "../../lib/doc-version.ts";
import type { OnCustomData } from "./pills";
import { requestLogin, referencedDatasets, unresolvedUploads } from "./custom-data-client.ts";
import { CohortStudies, CohortEditMenu, CAT_COLORS, ViewHead } from "./view-chrome.tsx";
import { cohortHash, shortHash } from "../../lib/cohort-hash.ts";
import { viewIsEmpty } from "../../lib/partition-arms.ts";
import type { CohortSaveState, CohortSourceState } from "./use-cohort-edits.ts";
import { ViewCard } from "./view-cards.tsx";
import type { DocStore } from "./doc-store.ts";
import type { SavedCohort, SavedWorkspace } from "./use-saved.ts";
import type { ExploreResult } from "../../lib/types.ts";
import type { ViewCtx } from "./view-cards.tsx";

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
  genesDialog: React.RefObject<HTMLDialogElement | null>;
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
  loggedIn: boolean;
  viewTitle: (kind: string) => string;
  emptyViewHint: (kind: string) => string;
  moveView: (i: number, dir: -1 | 1) => void;
  removeView: (i: number) => void;
  openCohortEdit: (name: string) => void;
  openCustomManager: () => void;
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
  const { busy, doc, genesDialog, genesFor, setGenesFor, setViewGenes } = ctx;
  return <>
    <dialog ref={genesDialog} className="genedialog"
      onClose={() => setGenesFor(null)}
      onClick={e => { if (e.target === genesDialog.current) genesDialog.current?.close(); }}>
      {genesFor != null && (
        <>
          <h3>Genes <span className="plain">— {String(((doc.views || [])[genesFor] as any)?.kind || "view")}</span></h3>
          {/* the DOCUMENT's view, never the result (a result's genes are {gene, driverPct, …}) */}
          <GeneListEditor view={(doc.views || [])[genesFor] || {}} busy={busy} onGenes={(g) => setViewGenes(genesFor, g)} />
          <div className="row mt-3 end">
            <button className="primary" onClick={() => genesDialog.current?.close()}>Done</button>
          </div>
        </>
      )}
    </dialog>
  </>;
}

export function CustomDataWarning({ ctx }: { ctx: AnalysisCtx }) {
  const { doc, openCustomManager, tab } = ctx;
  return <>
    {tab === "analysis" && (() => {
      // a shared document can name server custom data that is locked here, deleted, or absent
      const unresolved = unresolvedUploads(doc);
      const of = (why: string) => unresolved.filter((u) => u.why === why).map((u) => u.as);
      const manage = <button className="linklike" onClick={openCustomManager}>Explore → Custom data</button>;
      const names = (ids: string[]) => ids.map((id, i) => <span key={id}>{i ? ", " : ""}<code>custom:{id}</code></span>);
      return unresolved.length > 0 && (
        <div className="card customwarn">
          {of("locked").length > 0 && <p className="flush">This analysis uses custom data ({names(of("locked"))}).{" "}
            <button className="linklike" onClick={requestLogin}>Log in</button> to run it.</p>}
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
        <button className="primary" disabled={busy} onClick={() => openCohortChooser(vi)}>+ Add cohort</button>
      </div>
    </div>
  );
}

export function CohortColumn({ ctx }: { ctx: AnalysisCtx }) {
  const { busy, catalogAttrs, cohortSaveState, cohortSource, doc, loggedIn, menuOpenRef, openCohortEdit, removeCohort, removePartitionNamed, renamePartitionRow, result, saveCohortToLibrary, setPartitionDef, setUpgradeNote, showClauseData, spaces, splitCohortBy, splitsFlat, studyNames, updateFromSaved, upgradeNote, viewTitle } = ctx;
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
          <button className="linklike" onClick={() => setUpgradeNote(null)}>dismiss</button>
        </p>
      )}
      {/* The analysis's cohorts are not its top level: each view names the ones it draws, and these
          cards summarise them — each with the views that draw it and the saved cohort it was copied
          from. Cohorts come in through a view's "+ Add cohort". */}
      {names.length > 0 && (
        <section className="cohortsum" aria-label="cohorts in this analysis">
          <h2 className="vtitle hflex items-center gap-3 mb-4">
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
                      menuId={"cohort:" + n} menuStore={menuOpenRef.current} />
                    <div className="cohortbox-head">
                      <span className="cohortbox-name"><span className="cohortswatch" aria-hidden="true" style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} />{n}</span>
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
                        {src.state === "unknown" && <span> {loggedIn ? "Checking the saved cohort…" : "Log in to compare it with the saved cohort."}</span>}
                        {src.state === "deleted" && <span> That saved cohort has since been deleted; this copy is unaffected.</span>}
                        {(src.state === "current" || src.state === "changed") && src.srcName !== src.from.name && <span> It is now named “{src.srcName}”.</span>}
                        {src.state === "current" && !src.edited && <span> The saved cohort is unchanged.</span>}
                        {src.edited && <span> This copy has been edited here since (now <code>#{shortHash(cohortHash(doc.cohorts![n]))}</code>).</span>}
                        {src.state === "changed" && <span className="cohortsrc-changed"> The saved cohort has changed since (now <code title={src.now}>#{shortHash(src.now!)}</code>, saved {src.src!.savedAt}).</span>}
                        {(src.state === "changed" || (src.state === "current" && src.edited)) && <>
                          {src.state === "changed" && <div className="cohortsrc-new"><span className="meta">The saved version:</span> <CohortPills def={src.src!.def} /></div>}
                          <button className="tbbtn" disabled={busy} onClick={() => updateFromSaved(n)}
                            title={"replace this copy's definition with the saved cohort's; every view drawing “" + n + "” re-runs"}>
                            {src.state === "changed" ? "Update to the saved version" : "Revert to the saved version"}</button>
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
    {/* The document's JSON, generated SQL and run/clear controls: a dialog
        rather than a permanent column, so the leftbar can just be cohorts. */}
    <dialog ref={docDialog} className="docdialog"
      onClick={e => { if (e.target === docDialog.current) docDialog.current?.close(); }}>
      <div className="row between baseline mb-2">
        <h3 className="flush">The document <span className="plain">— views</span></h3>
        <button className="linklike" onClick={() => docDialog.current?.close()}>close</button>
      </div>
      {/* id, because the notes textarea above it also matches "textarea" —
          anything reading the document from outside React needs to be
          able to say WHICH one. */}
      <textarea className="docjson" id="docjson" value={docText} onChange={e => docs.setText(e.target.value)} spellCheck={false}
        />
      <div className="row mt-3">
        <button className="primary" disabled={busy} onClick={applyText}>{busy && <span className="spinner onprimary" />}{busy ? "Running…" : "Run document"}</button>
        {doc.cohorts && Object.keys(doc.cohorts).length > 0 &&
          <button disabled={busy} title="empty the document — removes all cohorts and views" onClick={clearAnalysis}>Clear analysis</button>}
        {result && <span className="meta">{result.stats.ms}ms · OncoKB {result.oncokbPin}</span>}
      </div>
      <p className="note">Views: <code>{`{"kind":"compare","genes":[…]}`}</code> · <code>{`{"kind":"survival"}`}</code> · <code>{`{"kind":"oncoprint","genes":[…],"clinical":[attrs…]}`}</code></p>
      {result && (
        <details className="mt-2">
          <summary className="meta clickable">
            Generated SQL (provenance) — the exact query each cohort compiled to, per study · OncoKB pin {result.oncokbPin || "none"}
          </summary>
          {Object.entries(result.cohorts).map(([n, c]) => (
            <div className="mt-2" key={n}>
              <p className="meta flush mb-1"><strong>{n}</strong> — {c.count.toLocaleString()} patients{c.studies && c.studies.length > 1 ? " across " + c.studies.length + " studies" : ""}</p>
              <pre className="sqlpre">{c.sql}</pre>
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
            Analysis{busy && <span className="spinner ml-2" />}
          </h2>
          <div className="vmeta">
            {/* The workspace lives behind this one button + a dialog, not
                a permanent card at the top of the column — it is read
                when setting the workspace up and almost never while
                reading the figures. What it's called and whether it's
                saved is what the dialog it opens is for; this button's
                own label stays fixed. */}
            {((doc.views || []).length > 0 || doc.title || doc.params || doc.notes) && (
              <button className="iflex items-center gap-2" disabled={busy} onClick={openWorkspaceSave}
                title={doc.title
                  ? "“" + doc.title + "” — " + (spaces[doc.title] && JSON.stringify(spaces[doc.title].doc) === JSON.stringify(doc)
                      ? "saved " + spaces[doc.title].savedAt : "unsaved changes")
                  : "save this analysis as a named, reopenable workspace"}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
                  <path d="M17 21v-8H7v8" />
                  <path d="M7 3v5h8" />
                </svg>
                Save analysis
              </button>
            )}
            {(() => {
              const used = referencedDatasets(doc);
              return used.length > 0 && (
                <button className="linklike" onClick={() => setCdFocus({ datasets: used })}
                  title="the uploads this analysis names, as stored in this browser">
                  custom data ({used.length})
                </button>
              );
            })()}
            <button className="linklike" onClick={() => docDialog.current?.showModal()}
              title="open the document's raw JSON — edit it, run it, or view generated SQL">
              show document json
            </button>
          </div>
        </div>
      )}
      {busy && !result && <div className="skeleton skeleton-addview" />}
      {busy && !result && Array.from({ length: Math.max(1, (doc.views || []).length) }).map((_, i) => (
        <div key={i} className="skeleton skeleton-view" />
      ))}
      {!busy && !result && !(doc.views || []).length && (
        <div className="card">
          <p className="note t-md flush">
            Start with a view: choose below what you want to see — survival, an oncoprint, a gene comparison — and
            then add its cohorts, from your library, from this analysis, or built on the{" "}
            <button className="linklike" onClick={() => { goTab("explore"); if (!explore) fetchExplore(); }}>Explore page</button>.
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
                <button key={kind} className="facet on" disabled={busy}
                  title={"remove the " + label.toLowerCase() + " view" + (present > 1 ? "s (" + present + ")" : "")}
                  onClick={() => removeViews((v) => v.kind === kind)}>{label}{present > 1 && " ×" + present} <span aria-hidden="true">✕</span></button>
              );
              const full = (doc.views || []).length >= 6;
              // with no cohorts yet there is no study to ask about: the view's cohorts decide later
              const known = Object.keys(doc.cohorts || {}).length > 0;
              const waiting = !full && known && !!loading && loading();
              const blocked = full ? "this document already has the maximum of 6 views"
                : waiting ? "loading this study's catalog — a moment"
                : (known && why ? why() : null);
              return (
                <button key={kind} className="facet" disabled={!!blocked}
                  title={blocked || ("add a " + label.toLowerCase() + " view, then choose its cohorts")}
                  onClick={() => addView(kind)}>+ {label}{waiting && <span className="spinner" />}</button>
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
