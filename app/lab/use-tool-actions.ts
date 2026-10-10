"use client";
// What the researcher's AI assistant does to the document (app/lab/agent-tools.ts), always checked
// by the engine first: validate an edited document, propose the arms for splitting a cohort,
// commit a document the engine has already answered (its answer seeds the page's queries, so
// nothing is asked twice), and save the analysis under a name.
import type { AnalysisDoc, AnalysisResult, PartitionDef } from "../../lib/types.ts";
import { upgradeDocument } from "../../lib/doc-version.ts";
import { seedAnalysis } from "./use-analysis.ts";
import { api } from "./api.ts";

import type { DocStore } from "./doc-store.ts";
import type { QueryClient } from "@tanstack/query-core";

/** What useToolActions needs from the analysis page. */
export interface ToolActionsPage {
  doc: AnalysisDoc;
  docs: DocStore;
  goTab: (t: "explore" | "cohorts" | "analysis" | "examples") => void;
  persistSpaces: (name: string, doc: AnalysisDoc) => Promise<void>;
  queryClient: QueryClient;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setStudy: React.Dispatch<React.SetStateAction<string>>;
  setValidating: React.Dispatch<React.SetStateAction<boolean>>;
  study: string;
}

export function useToolActions(page: ToolActionsPage) {
  const { doc, docs, goTab, persistSpaces, queryClient, setError, setStudy, setValidating, study } = page;

  // ---- AI tools ----------------------------------------------------------
  // The page's analysis as WebMCP tools and window.cohortLab (app/lab/agent-tools.ts), for the
  // researcher's assistant in the browser. The bridge is rebuilt every render, so a tool always
  // sees the current document; edits are validated by the engine before they reach the page.
  const validateDoc = async (d: AnalysisDoc): Promise<AnalysisResult> => {
    setValidating(true);
    try {
      const res = await api.analysis({ study: d.study || study, ...d }, { query: "?oncoprint=spec" });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      return j as AnalysisResult;
    } finally {
      // released whatever happens next: an edit the tool then rejects never reaches commitDoc
      setValidating(false);
    }
  };
  /** the server's proposed arms for "split this cohort by X" — see proposePartition in lib/analysis.ts */
  const proposePartition = async (req: { doc: AnalysisDoc; cohort: string; attribute?: string; gene?: string; oql?: string[]; name?: string; maxArms?: number; minCount?: number }) => {
    const res = await api.partition({ ...req, doc: { study: req.doc.study || study, ...req.doc } });
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    return j as { name: string; def: PartitionDef; note?: string };
  };
  const commitDoc = (d0: AnalysisDoc, r: AnalysisResult) => {
    const d = upgradeDocument(d0).doc;
    // the engine has already answered this document: the page's queries find that answer
    // instead of asking again, and an unchanged view keeps its id, so its card is not remounted
    seedAnalysis(queryClient, d, d.study || study, r);
    docs.commit(d);
    if (d.study && d.study !== study) setStudy(d.study);
    setError(null);
    goTab("analysis");
  };
  const saveAs = async (name: string) => {
    const d = { ...doc, title: name };
    docs.set(d);
    await persistSpaces(name, d);
  };

  return { validateDoc, proposePartition, commitDoc, saveAs };
}
