"use client";
// /singlecell — a data owner reviews how a Cell Explorer dataset becomes custom data for a cBioPortal
// study: who is who (the donor and sample columns matched to the study's ids), which cell labels and
// scores are summarised, over which cells, with what minimums — previewed, checked against the
// study's own cell counts where it has them, and taken away as a config, TSVs or saved custom data.
//
// The page drafts and edits a SingleCellConfig (lib/singlecell/summary.ts); the CLI
// (scripts/gen-singlecell-summary.ts) builds the same config to the same numbers.
import { useEffect, useMemo, useState } from "react";
import { useSingleCell } from "./use-singlecell.ts";
import { StartPanel, WhoIsWho, ColumnsStep, CellsStep, MinimumsStep, PreviewStep, UseStep } from "./sections.tsx";
import { api } from "../lab/api.ts";
import LoginButton from "../lab/login-button.tsx";

export default function SingleCellPage() {
  const sc = useSingleCell();
  const [studies, setStudies] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    api.studies().then((r) => r.json()).then((j) => setStudies((j.studies || []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })))).catch(() => setStudies([]));
  }, []);
  const studyName = useMemo(() => new Map(studies.map((s) => [s.id, s.name])), [studies]);

  return (
    <main className="repro-page" data-tw>
      <div className="repro-nav flex items-center gap-4">
        <a href="/lab">← back to the app</a>
        <a href="/datasets">data sets</a>
        <span className="flex-1" />
        <LoginButton />
      </div>
      <div className="repro-intro">
        <h1>Single-cell data into a study</h1>
        <p className="lede">
          A dataset on <a href="https://cell-explorer.cbioportal.org" target="_blank" rel="noreferrer">Cell Explorer</a> labels
          every cell. This page turns those labels into numbers per patient and per sample — the share of each cell type, the
          mean of each score — that the lab reads like any clinical attribute. Nothing here decides the science for you: it
          shows what each choice does, with the evidence beside it, so the person who knows the data can make it.
        </p>
      </div>

      <StartPanel sc={sc} studies={studies} />

      {sc.error && <p className="error mt-4" role="alert">{sc.error}</p>}
      {sc.busy && <p className="note mt-4"><span className="spinner" /> {sc.busy}…</p>}

      {sc.cfg && <>
        <WhoIsWho sc={sc} studyName={studyName.get(sc.cfg.study) || sc.cfg.study} />
        <ColumnsStep sc={sc} />
        <CellsStep sc={sc} />
        <MinimumsStep sc={sc} />
        <PreviewStep sc={sc} />
        <UseStep sc={sc} />
      </>}
    </main>
  );
}
