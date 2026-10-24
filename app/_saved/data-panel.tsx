"use client";
// The saved-work manager's Custom data tab: the uploads stored on the server, the reader's and
// others' shared with them — analyse one, export it, edit or replace it (a new version, saved after
// its changes are reviewed), share or delete it. Adding one happens on the studies being explored
// (Explore → Custom data), where its ids are matched.
import { useState } from "react";
import { Download, Pencil, Plus, Share2, Trash2, Users } from "lucide-react";
import { ShareDialog, sharingLabel } from "../lab/share-dialog.tsx";
import { useGroups } from "../lab/use-groups.ts";
import { AddCustomData, useCustomDataState } from "../lab/custom-data-panel.tsx";
import { datasetToTsv, deleteServerDataset, fetchServerVersion, shareServerDataset, type StoredDataset } from "../lab/custom-data-client.ts";
import { Button } from "../_ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../_ui/dialog";
import { TB } from "../_ui/toolbar.ts";
import { cn } from "../../lib/cn";
import { DOC_VERSION } from "../../lib/doc-version.ts";
import type { DatasetMeta } from "../../lib/custom-store.ts";
import type { AnalysisDoc } from "../../lib/types.ts";
import { useSaved } from "./saved-context.tsx";

/** A new analysis of the patients with a row in this upload, pinned to its latest version */
function uploadDoc(d: DatasetMeta, studies: string[]): AnalysisDoc {
  const where = studies.length > 1 ? { studies } : { study: studies[0] };
  return { dsl: DOC_VERSION, study: studies[0], uploads: [{ as: d.slug, dataset: d.id, version: d.latestVersion }],
    cohorts: { [d.name]: { ...where, all: [{ kind: "upload", dataset: "custom:" + d.slug }] } }, views: [] };
}

export function DataPanel() {
  const server = useCustomDataState();
  const { actions, close } = useSaved();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const groups = useGroups(server.user?.id ?? null);
  const [sharing, setSharing] = useState<DatasetMeta | null>(null);
  const [editing, setEditing] = useState<DatasetMeta | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const act = async (label: string, f: () => Promise<unknown>) => {
    setBusy(label); setErr(null);
    try { await f(); actions.onDataChanged?.(); } catch (e) { setErr(String((e as Error).message || e)); }
    finally { setBusy(null); }
  };
  const remove = (d: DatasetMeta) => {
    if (!confirm("Delete “" + d.name + "” from the server? Analyses pinned to it will be refused, with the date it was deleted.")) return;
    void act("deleting…", () => deleteServerDataset(d.id));
  };
  const download = (d: StoredDataset) => {
    const url = URL.createObjectURL(new Blob([datasetToTsv(d)], { type: "text/tab-separated-values" }));
    const a = document.createElement("a"); a.href = url; a.download = d.id + ".tsv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const add = actions.addData && <Button variant="outline" size="sm" className={TB} onClick={() => { actions.addData!(); close(); }}
    title="upload a table of annotations, matched to the studies you are exploring"><Plus />Add data</Button>;

  return (
    <section className="card cd-saved m-0">
      <h2 className="flex items-center gap-2.5">
        <span>Uploads{server.datasets.length ? " (" + server.datasets.length + ")" : ""}
          <span className="plain"> — yours, and others' shared with you</span></span>
        <span className="ml-auto">{add}</span>
      </h2>
      <p className="meta flush">
        A saved version never changes; an analysis that uses one is pinned to it. Each holds patient-level
        values: share one only with people entitled to them.
      </p>
      {server.datasets.length ? (
        <div className="attrtablewrap">
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
                      {v && v.studies.length > 0 && <><Button variant="outline" size="sm" className={TB}
                        title={"start an analysis with one cohort: the " + v.rowCount.toLocaleString() + " " + d.level + "s' patients with a row in this upload"}
                        onClick={() => { actions.openDoc(uploadDoc(d, v.studies)); close(); }}><Users />Analyze</Button>{" "}</>}
                      <Button variant="outline" size="sm" className={TB} disabled={!!busy}
                        onClick={() => void act("exporting…", async () => download(await fetchServerVersion(d.id, d.latestVersion)))}><Download />Export</Button>{" "}
                      {d.rights.edit && v && <><Button variant="outline" size="sm" className={cn(TB, "cd-edit")} disabled={!!busy}
                        title={"edit v" + d.latestVersion + "'s values, or load a replacement, and save the result as v" + (d.latestVersion + 1) + " once its changes are reviewed"}
                        onClick={() => { setNote(null); setEditing(d); }}><Pencil />Edit / replace…</Button>{" "}</>}
                      {d.rights.share && <><Button variant="outline" size="sm" className={TB} disabled={!!busy} onClick={() => setSharing(d)}><Share2 />Share…</Button>{" "}
                        <Button variant="outline" size="sm" className={cn(TB, "text-destructive hover:text-destructive")} disabled={!!busy} onClick={() => remove(d)}><Trash2 />Delete</Button></>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="note">Nothing uploaded yet{add ? "." : " — add data from Explore → Custom data, on the studies it belongs to."}</p>}
      {note && <p className="cd-added">{note}</p>}
      {busy && <p className="meta"><span className="spinner" /> {busy}</p>}
      {err && <p className="error">{err}</p>}
      {editing && <Dialog open onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent aria-describedby={undefined}
          className="cd-editdialog flex h-[90vh] w-[94vw] max-w-[94vw] flex-col gap-3 overflow-auto p-6 sm:max-w-[94vw]">
          <DialogHeader><DialogTitle className="text-base">Edit “{editing.name}” <span className="meta font-normal">
            v{editing.latestVersion} · custom:{editing.slug}</span></DialogTitle></DialogHeader>
          <div className="customdata">
            <p className="note flush">Change values in the table, add or remove rows and columns, or drop in a replacement file. Nothing
              is overwritten: saving adds v{editing.latestVersion + 1}, after showing every change from v{editing.latestVersion}.</p>
            <AddCustomData replacing={editing} studies={editing.versions.find((x) => x.version === editing.latestVersion)?.studies ?? []}
              onAdded={(name) => { setEditing(null); actions.onDataChanged?.(); setNote("Saved “" + name + "” as v" + (editing.latestVersion + 1) + "."); }} />
          </div>
        </DialogContent>
      </Dialog>}
      {sharing && <ShareDialog kind="custom dataset" name={sharing.name} sharing={sharing.sharing}
        groups={groups.groups} groupsError={groups.error}
        onSave={async (s) => { await shareServerDataset(sharing.id, s); actions.onDataChanged?.(); }}
        onClose={() => setSharing(null)} />}
    </section>
  );
}
