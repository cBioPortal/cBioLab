"use client";
// One manager for everything the reader keeps: saved cohorts and analyses, uploads, groups and gene
// lists, a tab each. The dialog (opened from any page, saved-context.tsx) and the /saved page show
// the same manager; only where its tab lives differs (the dialog's state, the page's URL).
import { Bookmark } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "../_ui/tabs";
import { Button } from "../_ui/button";
import { LINE_TABS, PAGE_TAB } from "../_ui/toolbar.ts";
import { Waiting } from "../_oncoprint/OncoprintCard.tsx";
import { useCustomDataState } from "../lab/custom-data-panel.tsx";
import { requestLogin } from "../lab/custom-data-client.ts";
import { SAVED_TABS, type SavedTab } from "./saved-tabs.ts";
import { CohortsPanel, AnalysesPanel } from "./library-panels.tsx";
import { DataPanel } from "./data-panel.tsx";
import { GroupsPanel } from "./groups-panel.tsx";
import { GenesPanel } from "./genes-panel.tsx";

/** what each tab keeps, said where it asks the reader to sign in */
const NEEDS_SIGN_IN: Partial<Record<SavedTab, string>> = {
  cohorts: "Saved cohorts are your own", analyses: "Saved analyses are your own",
  data: "Uploads are stored on the server as yours", groups: "Groups are made of people who have signed in",
};

export function SavedManager({ tab, onTab, note }: { tab: SavedTab; onTab: (t: SavedTab) => void; note?: string | null }) {
  const login = useCustomDataState();
  const gate = NEEDS_SIGN_IN[tab];
  return (
    <div data-tw className="savedmanager grid gap-4">
      <Tabs value={tab} onValueChange={(v) => onTab(v as SavedTab)}>
        <TabsList variant="line" aria-label="saved work" className={LINE_TABS}>
          {SAVED_TABS.map(([t, label]) => <TabsTrigger key={t} value={t} className={PAGE_TAB}>{label}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {note && <p className="cd-added m-0">{note}</p>}
      {gate && !login.loaded ? <div className="card m-0"><Waiting what="your sign-in" /></div>
        : gate && !login.unlocked ? <div className="card m-0"><p className="m-0 text-md">{gate}.{" "}
            {login.enabled ? <><Button size="sm" onClick={requestLogin}>Sign in</Button> to see and manage them.</>
              : "This deployment has no sign-in, so nothing can be saved on it."}</p></div>
        : tab === "cohorts" ? <CohortsPanel />
        : tab === "analyses" ? <AnalysesPanel />
        : tab === "data" ? <DataPanel />
        : tab === "groups" ? <GroupsPanel me={login.user!.id} />
        : <GenesPanel />}
    </div>
  );
}

/** The manager as a dialog, open while `tab` is set. */
export function SavedDialog({ tab, note, onTab, onClose }: { tab: SavedTab | null; note: string | null; onTab: (t: SavedTab) => void; onClose: () => void }) {
  return (
    <Dialog open={!!tab} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}
        className="saveddialog flex h-[90vh] w-[94vw] max-w-[94vw] flex-col gap-3 overflow-auto p-6 sm:max-w-[94vw]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><Bookmark className="size-4" />Your saved work
            <a className="mr-8 ml-auto text-sm font-normal text-link" href={"/saved?tab=" + (tab ?? "cohorts")} target="_blank" rel="noreferrer"
              data-tip="this manager as a page of its own, in a new tab">open as a page</a></DialogTitle>
        </DialogHeader>
        {tab && <SavedManager tab={tab} onTab={onTab} note={note} />}
      </DialogContent>
    </Dialog>
  );
}
