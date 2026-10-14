"use client";
// Who a saved cohort, analysis or custom dataset is shared with (lib/access.ts): only its owner,
// one of the owner's groups, or everyone signed in to this deployment — and whether that group may
// also edit it. Opened by the owner only. Sharing an analysis wider than a custom dataset it uses
// comes back with that dataset named; the dialog offers to share the reader's own such datasets the
// same way, and says to ask the owner of anyone else's. Nothing is shared but by a click here.
import { useState } from "react";
import { Waiting } from "../_oncoprint/OncoprintCard.tsx";
import type { Sharing, Visibility } from "../../lib/access.ts";
import type { DatasetWarning } from "../../lib/artifacts.ts";
import type { GroupSummary } from "./use-groups.ts";
import { cn } from "../../lib/cn";
import { Button } from "../_ui/button";
import { Checkbox } from "../_ui/checkbox";
import { Choice } from "../_ui/choice";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../_ui/dialog";
import { RadioGroup, RadioGroupItem } from "../_ui/radio-group";

export type ShareKind = "cohort" | "analysis" | "custom dataset";

/** How a sharing reads in a list: "only you", "lab: can edit", "everyone signed in". */
export function sharingLabel(s: Sharing & { groupName?: string | null }): string {
  const group = s.groupName ? "“" + s.groupName + "”" : "a group";
  if (s.visibility === "private") return "only you";
  if (s.visibility === "group") return group + (s.groupCanEdit ? ", who can edit" : "");
  return "everyone signed in" + (s.groupCanEdit ? "; " + group + " can edit" : "");
}

const META = "text-sm text-muted-foreground";
const OPTION = "flex items-center gap-2 text-md";

export function ShareDialog({ kind, name, sharing, groups, groupsError, onSave, onShareDatasets, onClose }: {
  kind: ShareKind;
  name: string;
  sharing: Sharing;
  /** the owner's groups; undefined while loading */
  groups: GroupSummary[] | undefined;
  groupsError: string | null;
  /** saves the sharing; for an analysis, answers the datasets its audience could not read */
  onSave: (s: Sharing) => Promise<DatasetWarning[] | void>;
  /** share the reader's own datasets in `warnings` the way this analysis now is */
  onShareDatasets?: (ids: string[], s: Sharing) => Promise<void>;
  onClose: () => void;
}) {
  const [visibility, setVisibility] = useState<Visibility>(sharing.visibility);
  const [groupId, setGroupId] = useState<string>(sharing.groupId ?? "");
  const [canEdit, setCanEdit] = useState(sharing.groupCanEdit);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<DatasetWarning[] | null>(null);
  const [savedAs, setSavedAs] = useState<Sharing | null>(null);

  const needsGroup = visibility === "group" || canEdit;
  const group = groups?.find((g) => g.id === groupId);
  const next: Sharing = { visibility, groupId: needsGroup ? groupId || null : null, groupCanEdit: visibility !== "private" && canEdit };
  const why = needsGroup && !groupId ? "choose the group" : null;

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const w = await onSave(next);
      if (w && w.length) { setWarnings(w); setSavedAs(next); }
      else onClose();
    } catch (e) { setErr(String((e as Error)?.message || e)); }
    finally { setBusy(false); }
  };
  const shareDatasets = async () => {
    if (!onShareDatasets || !warnings || !savedAs) return;
    setBusy(true); setErr(null);
    try { await onShareDatasets(warnings.filter((w) => w.yours).map((w) => w.id), { ...savedAs, groupCanEdit: false }); onClose(); }
    catch (e) { setErr(String((e as Error)?.message || e)); }
    finally { setBusy(false); }
  };

  const groupPicker = groups === undefined
    ? (groupsError ? <span className="error">could not load your groups: {groupsError}</span> : <Waiting what="your groups" />)
    : groups.length === 0
      ? <span className={META}>You are in no groups yet — make one on the <a href="/groups" target="_blank" rel="noreferrer">Groups</a> page.</span>
      : <Choice value={groupId} onChange={setGroupId} placeholder="choose a group…" title="group" className="w-full"
          options={groups.map((g) => [g.id, g.name + " (" + g.members + " member" + (g.members === 1 ? "" : "s") + ")"] as const)} />;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-tw aria-describedby={undefined} className="sharedialog gap-0 sm:max-w-md">
        {warnings ? (
          <form onSubmit={(e) => { e.preventDefault(); void shareDatasets(); }} className="flex flex-col gap-3">
            <DialogHeader><DialogTitle className="text-base">Shared — but some of its custom data is not</DialogTitle></DialogHeader>
            <p className={cn(META, "m-0")}>Some people who can now see “{name}” cannot read custom data it uses, so its views that use it will not run for them:</p>
            <ul className="sharewarn m-0 grid gap-1 pl-4 text-sm">
              {warnings.map((w) => <li key={w.id}><strong>{w.name}</strong> <code>custom:{w.slug}</code> — shared with {sharingLabel({ visibility: w.visibility, groupId: null, groupCanEdit: false, groupName: w.groupName })}
                {w.yours ? "" : " (not yours: ask its owner to share it)"}</li>)}
            </ul>
            {warnings.some((w) => w.yours) && <p className="note m-0">Custom data holds patient-level values: whoever you share it with can read every row.</p>}
            {err && <p className="error m-0">{err}</p>}
            <DialogFooter className="mt-1 items-center">
              <Button type="button" variant="ghost" onClick={onClose}>Leave it</Button>
              {warnings.some((w) => w.yours) && <Button type="submit" disabled={busy}>
                {busy ? "sharing…" : "Share my datasets the same way"}</Button>}
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (!why) void save(); }} className="flex flex-col gap-3">
            <DialogHeader><DialogTitle className="text-base">Share {kind} “{name}”</DialogTitle></DialogHeader>
            <fieldset className="m-0 grid gap-1.5 border-0 p-0">
              <legend className={cn(META, "mb-1.5 p-0")}>Who can see it</legend>
              <RadioGroup value={visibility} className="gap-1.5" aria-label="who can see it"
                onValueChange={(v) => { setVisibility(v as Visibility); if (v === "private") setCanEdit(false); }}>
                <label className={OPTION} htmlFor="share-private"><RadioGroupItem id="share-private" value="private" /> Only you</label>
                <label className={OPTION} htmlFor="share-group"><RadioGroupItem id="share-group" value="group" /> A group</label>
                <label className={OPTION} htmlFor="share-public"><RadioGroupItem id="share-public" value="public" /> Everyone who signs in to this deployment</label>
              </RadioGroup>
            </fieldset>
            <fieldset className="m-0 grid gap-1.5 border-0 p-0 disabled:opacity-55" disabled={visibility === "private"}>
              <legend className={cn(META, "mb-1.5 p-0")}>Who can change it</legend>
              <label className={OPTION}><Checkbox checked={canEdit} onCheckedChange={(c) => setCanEdit(c === true)} disabled={visibility === "private"} />
                Members of the group can edit it too{visibility === "private" ? " (share it first)" : ""}</label>
            </fieldset>
            {needsGroup && <div className="sharegroup">{groupPicker}</div>}
            <p className={cn(META, "m-0")}>
              {visibility === "private" ? "Only you can see and change it."
                : (visibility === "group" ? "Members of " + (group ? "“" + group.name + "”" : "the group") : "Everyone signed in") + " can see it; " +
                  (canEdit ? "members of " + (group ? "“" + group.name + "”" : "the group") + " can also change it. " : "only you can change it. ") +
                  "Only you can delete it or change who it is shared with."}
            </p>
            {kind === "custom dataset" && visibility !== "private" &&
              <p className="note m-0">This holds patient-level values: everyone you share it with can read every row.</p>}
            {err && <p className="error m-0">{err}</p>}
            <DialogFooter className="mt-1 items-center">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy || !!why} title={why ?? undefined}>{busy ? "saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
