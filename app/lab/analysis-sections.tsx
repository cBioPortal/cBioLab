"use client";
// The Analysis tab's own sections: the cohort column, the views column (its header, the add-view
// buttons and the view cards), the document dialog, the genes dialog, and the notice when the
// document names custom data that is not here. The page holds the state; each section reads it
// and the page's actions from one AnalysisCtx.
import CohortPills from "./pills";
import { GeneListEditor } from "../_oncoprint/OncoprintCard.tsx";
import type { GeneTrackSpec } from "../../lib/gene-tracks.ts";
import type { AnalysisDoc, AnalysisResult, CohortDef, PartitionDef } from "../../lib/types.ts";
import type { CustomDataFocus } from "./custom-data-dialog.tsx";
import { PartitionPanel, SplitForm, type SplitSpec } from "./partitions.tsx";
import type { DocUpgrade } from "../../lib/doc-version.ts";
import type { OnCustomData } from "./pills";
import { requestLogin, referencedDatasets, unresolvedUploads } from "./custom-data-client.ts";
import { DEFAULT_VIEWS } from "./doc-store.ts";
import { CohortStudies, CohortEditMenu, CAT_COLORS } from "./view-chrome.tsx";
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
  openAddCohort: () => void;
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

export function CohortColumn({ ctx }: { ctx: AnalysisCtx }) {
  const { busy, catalogAttrs, doc, menuOpenRef, openAddCohort, openCohortEdit, removeCohort, removePartitionNamed, renamePartitionRow, result, saved, setPartitionDef, setUpgradeNote, showClauseData, spaces, splitCohortBy, splitsFlat, studyNames, upgradeNote } = ctx;
  return <>
    <div>
      {/* Cohorts, bare: each is its own labelled, bordered box, with no
          enclosing card — they ARE the leftbar, not a section within it.
          Each box's gear menu (CohortEditMenu) covers a note and
          removing the cohort. It deliberately does NOT cover the
          cohort's own filters yet: those are pills built from Explore's
          facets or hand-typed JSON, and editing them in place would mean
          either Explore or the JSON editor opening ON TOP of an
          analysis already in progress (a modal, most likely) — a bigger
          piece of work than this pass, and not yet scoped. */}
      {(busy || result) && (
        <h2 className="vtitle hflex items-center gap-3 mb-4">
          Cohorts{busy && <span className="spinner" />}
          <button className="tbbtn addcohortbtn" disabled={busy} onClick={openAddCohort}
            title="build another cohort in Explore and add it to this analysis">+ Add cohort</button>
        </h2>
      )}
      {upgradeNote && (
        <p className="note upgradenote">
          This analysis was written {upgradeNote.from === "unversioned" ? "before analyses carried a version" : "for DSL " + upgradeNote.from} and has been upgraded to {upgradeNote.to}
          {upgradeNote.changes.length ? ": " + upgradeNote.changes.join("; ") : ""}. Saving it, or sharing its link, uses the new version.{" "}
          <button className="linklike" onClick={() => setUpgradeNote(null)}>dismiss</button>
        </p>
      )}
      <div className="cohortlist">
        {busy && !result
          ? Array.from({ length: Math.max(1, Object.keys(doc.cohorts || {}).length) }).map((_, i) => (
              <div key={i} className="skeleton skeleton-cohort" />
            ))
          : result && Object.entries(result.cohorts).filter(([n]) => doc.cohorts?.[n]).map(([n, c], i) => {
            // a cohort's splits are drawn attached to it, so which cohort a split divides is
            // seen, not read; splits of a split's arms are nested inside that split's panel
            const flat = splitsFlat();
            const splits = Object.keys(flat).filter((k) => flat[k].of === n);
            return (
            <div key={n} className={"cohortgroup" + (splits.length ? " hassplit" : "")}>
              <div className="cohortbox">
                <CohortEditMenu busy={busy} canEdit={!!(doc.title && spaces[doc.title])}
                  onEdit={() => openCohortEdit(n)} onRemove={() => removeCohort(n)}
                  split={(done: () => void) => <SplitForm cohort={n} attrs={catalogAttrs()} busy={busy} onSplit={splitCohortBy} onDone={done} />}
                  splitCount={splits.length}
                  menuId={"cohort:" + n} menuStore={menuOpenRef.current} />
                <div className="cohortbox-head">
                  <span className="cohortbox-name"><span className="cohortswatch" aria-hidden="true" style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} />{n}</span>
                  <strong>{c.count.toLocaleString()}</strong> <span className="meta">patients</span>
                </div>
                <CohortStudies ids={c.studies && c.studies.length ? c.studies : [doc.cohorts?.[n]?.study || doc.study || result.study].filter(Boolean) as string[]}
                  names={studyNames} />
                {doc.cohorts && doc.cohorts[n] && <CohortPills def={doc.cohorts[n]} onCustomData={showClauseData(n)} />}
                {/* A note only shows here — passively, read-only — once the
                    cohort is actually saved as a reusable artifact AND
                    someone bothered to write one; an ad-hoc cohort that
                    might be gone in a minute doesn't need an invitation to
                    write prose about it. Writing or changing the note
                    itself always happens through the gear menu above. */}
                {saved[n] && doc.cohorts?.[n]?.notes && (
                  <p className="note">{doc.cohorts[n].notes}</p>
                )}
              </div>
              {splits.length > 0 && <div className="cohortgroup-splits">
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
  const { VIEW_KINDS, addView, busy, doc, docDialog, docs, explore, fetchExplore, goTab, openAddCohort, openWorkspaceSave, removeViews, result, setCdFocus, spaces, viewCtx, viewIds } = ctx;
  return <>
    <div>
      {(busy || result) && (
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
      {!busy && !result && (
        <div className="card">
          <p className="note t-md flush hflex items-center gap-3 wrap">
            <button className="primary" onClick={openAddCohort}>+ Add cohort</button>
            <span>to start an analysis here, or make one on the <button className="linklike" onClick={() => { goTab("explore"); if (!explore) fetchExplore(); }}>Explore page</button>
            {" "}or choose cohorts on the <button className="linklike" onClick={() => goTab("cohorts")}>Cohorts page</button>.</span>
          </p>
        </div>
      )}
      {result && !result.views.length && (
        <div className="card">
          <h2>Cohorts evaluated — no views defined</h2>
          <p className="note t-md">
            Add a views array to the document (e.g. <code>{`{"kind":"survival"}`}</code>),{" "}
            <button className="linklike" onClick={() => { const d = { ...doc, views: DEFAULT_VIEWS }; docs.set(d); }}>add the default views</button>, or ask your AI assistant in the browser sidebar.
          </p>
        </div>
      )}
      {!(busy && !result) && Object.keys(doc.cohorts || {}).length > 0 && (
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
              const waiting = !full && !!loading && loading();
              const blocked = full ? "this document already has the maximum of 6 views"
                : waiting ? "loading this study's catalog — a moment"
                : (why ? why() : null);
              return (
                <button key={kind} className="facet" disabled={!!blocked}
                  title={blocked || ("add a " + label.toLowerCase() + " view and run it")}
                  onClick={() => addView(kind)}>+ {label}{waiting && <span className="spinner" />}</button>
              );
            })}
          </div>
        </div>
      )}
      {result && result.views.map((v, vi) => (
        <ViewCard key={viewIds[vi] ?? vi} ctx={{ ...viewCtx, result }} v={v} vi={vi} />
      ))}
    </div>
  </>;
}
