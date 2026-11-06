"use client";
// The patient page's "Summarize" button: puts the summary prompt (lib/summarize-prompt.ts) to the
// chat sidebar. Shown only where the sidebar is on and the reader may use it. It starts a new
// conversation, and says so — and that the patient's data goes to the model provider — in its tooltip.
import { SparklesIcon } from "lucide-react";
import { Button } from "../_ui/button";
import { TB } from "../_ui/toolbar.ts";
import { askAssistant, useAssistant } from "../_agent/ask.ts";
import { patientSummaryPrompt, type PatientRef } from "../../lib/summarize-prompt.ts";

export function SummarizeButton({ of }: { of: PatientRef }) {
  const a = useAssistant();
  if (!a?.available) return null;
  return (
    <Button type="button" variant="outline" size="sm" className={TB}
      data-tip={"Ask the assistant (" + (a.model ?? "the model") + ") for a short recap of this " + of.kind + ". Starts a new conversation, and sends what the page shows about the " + of.kind + " to the model provider."}
      onClick={() => askAssistant(patientSummaryPrompt(of))}><SparklesIcon />Summarize</Button>
  );
}
