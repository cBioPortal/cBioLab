"use client";
// A saved cohort's row in the saved-work manager: a tick to analyse it with others, its name and
// what it is (size, when saved, who it is shared with or whose it is), its definition, note and
// splits, and its menu — for the reader's own: analyse, rename, add or edit the note, change the
// filters in Explore, split, duplicate, delete; for one shared with them: analyse, save a copy.
// Splits are proposed by the server from the data, as on the analysis page (POST /api/partition),
// and stored on the cohort, so every analysis it is added to has them.
import { useId, useState } from "react";
import { BarChart3, ChevronDown, Copy, Filter, Pencil, Split, StickyNote, Trash2, X } from "lucide-react";
import CohortPills, { type OnCustomData } from "../lab/pills";
import { SplitForm, type SplitSpec } from "../lab/partitions.tsx";
import { useStudyAttrs } from "../lab/use-catalogs.ts";
import { Button } from "../_ui/button";
import { Checkbox } from "../_ui/checkbox";
import { GearMenu, MenuItem, MenuSeparator } from "../_ui/gear-menu.tsx";
import type { CohortDef } from "../../lib/types.ts";

/** why Explore cannot show this cohort's definition, or null when it can */
export function exploreCannotEdit(def: CohortDef): string | null {
  if (def.extends) return "it extends “" + def.extends + "”, which Explore cannot show — edit it in an analysis's JSON";
  if (def.a) return "it is a timeline event pattern, which Explore cannot show — edit it in an analysis's JSON";
  return null;
}

const studiesOf = (def: CohortDef) => def.studies?.length ? def.studies : def.study ? [def.study] : [];

function SavedSplitForm({ name, def, onSplit, onDone }: {
  name: string; def: CohortDef; onSplit: (spec: SplitSpec) => Promise<void>; onDone: () => void;
}) {
  const { trackAttrs } = useStudyAttrs(studiesOf(def));
  return <SplitForm cohort={name} attrs={trackAttrs.attrs} onSplit={(_, spec) => onSplit(spec)} onDone={onDone} />;
}

/** what the reader may do to a cohort of their own */
export type OwnCohortActions = {
  onRename: () => void; onNote: () => void; onEditFilters: () => void; onSplit: (spec: SplitSpec) => Promise<void>;
  onDuplicate: () => Promise<void>; onDelete: () => void;
};

function SavedCohortMenu({ id, name, def, onAnalyze, own, onCopy }: {
  id: string; name: string; def: CohortDef; onAnalyze: () => void;
  /** the reader's own cohort; else one shared with them, which they may copy */
  own?: OwnCohortActions; onCopy?: () => Promise<void>;
}) {
  const [splitting, setSplitting] = useState(false);
  const cannot = exploreCannotEdit(def);
  return (
    <GearMenu menuId={"saved-cohort:" + id} className="savedcohortgear mt-0.5" label={<>Actions<ChevronDown /></>} title={"act on “" + name + "”"}
      ariaLabel={"act on “" + name + "”"} wide={splitting} onOpenChange={(o) => { if (!o) setSplitting(false); }}>
      {(close) => splitting && own
        ? <SavedSplitForm name={name} def={def} onSplit={own.onSplit} onDone={() => { close(); setSplitting(false); }} />
        : <>
          <MenuItem data-tip="start an analysis of this cohort alone (replaces the analysis open in the lab)"
            onClick={() => { close(); onAnalyze(); }}><BarChart3 />analyze</MenuItem>
          {onCopy && <MenuItem data-tip="save a copy to your own cohorts, to rename, edit or split"
            onClick={async () => { close(); await onCopy(); }}><Copy />save a copy</MenuItem>}
          {own && <>
          <MenuSeparator />
          <MenuItem onClick={() => { close(); own.onRename(); }}><Pencil />rename…</MenuItem>
          <MenuItem data-tip="what this cohort is, or why it is defined this way — shown under it, and in every analysis it joins"
            onClick={() => { close(); own.onNote(); }}><StickyNote />{def.notes ? "edit note…" : "add note…"}</MenuItem>
          <MenuItem disabled={!!cannot} data-tip={cannot ? "can't edit its filters here: " + cannot : "change its studies and filters in Explore, then save them over it"}
            onClick={() => { close(); own.onEditFilters(); }}><Filter />edit filters in Explore…</MenuItem>
          <MenuItem data-tip="divide this cohort into arms that never overlap and add up to it"
            onClick={() => setSplitting(true)}><Split />{def.splits && Object.keys(def.splits).length ? "split another way…" : "split into arms…"}</MenuItem>
          <MenuItem data-tip="save a copy under a new name" onClick={async () => { close(); await own.onDuplicate(); }}><Copy />duplicate</MenuItem>
          <MenuSeparator />
          <MenuItem className="text-destructive hover:text-destructive" onClick={() => { close(); own.onDelete(); }}><Trash2 />delete…</MenuItem>
          </>}
        </>}
    </GearMenu>
  );
}

/** One saved cohort, the reader's own or shared with them. */
export function SavedCohortRow({ id, name, def, picked, onPick, meta, onAnalyze, own, onCopy, onRemoveSplit, onCustomData }: {
  id: string; name: string; def: CohortDef; picked: boolean; onPick: () => void;
  /** what it is, after its name: size, when saved, its sharing */
  meta: React.ReactNode;
  onAnalyze: () => void; own?: OwnCohortActions; onCopy?: () => Promise<void>;
  onRemoveSplit?: (split: string) => void; onCustomData?: OnCustomData;
}) {
  const box = useId();
  return (
    <div className="listrow flex items-start gap-2.5">
      <Checkbox id={box} className="cohortpick mt-2" checked={picked} onCheckedChange={onPick} aria-label={"tick “" + name + "” to analyse"} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <label htmlFor={box} className="pick"><strong>{name}</strong></label>
          <span className="text-sm text-muted-foreground">{meta}</span>
        </div>
        <CohortPills def={def} onCustomData={onCustomData} />
        {def.notes && <p className="m-0 text-md text-muted-foreground">{def.notes}</p>}
        <SavedSplits def={def} onRemove={onRemoveSplit} />
      </div>
      <SavedCohortMenu id={id} name={name} def={def} onAnalyze={onAnalyze} own={own} onCopy={onCopy} />
    </div>
  );
}

/** the splits a saved cohort holds: each one's arms, and a way to remove it */
function SavedSplits({ def, onRemove }: { def: CohortDef; onRemove?: (split: string) => void }) {
  const splits = Object.entries(def.splits || {});
  if (!splits.length) return null;
  return <div className="flex flex-col gap-0.5">
    {splits.map(([split, d]) => {
      const nested = d.arms.some((a) => a.splits && Object.keys(a.splits).length) || !!(d.otherSplits && Object.keys(d.otherSplits).length);
      return (
        <div key={split} className="flex items-center gap-1.5 text-sm">
          <Split className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">split “{split}”:</span>
          <span>{[...d.arms.map((a) => a.name), d.other || "Other"].join(" · ")}</span>
          {nested && <span className="text-muted-foreground">(some arms split further)</span>}
          {onRemove && <Button variant="ghost" size="icon-xs" data-tip={"remove the split “" + split + "”"} aria-label={"remove the split “" + split + "”"}
            onClick={() => onRemove(split)}><X /></Button>}
        </div>
      );
    })}
  </div>;
}
