"use client";
// A tool call in the transcript: its name and state, opening to its arguments and result (from
// Vercel's AI Elements).
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { CheckCircleIcon, ChevronDownIcon, CircleIcon, ClockIcon, WrenchIcon, XCircleIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/app/_ui/collapsible";
import { cn } from "@/lib/cn";

export type ToolPart = ToolUIPart | DynamicToolUIPart;
type State = ToolPart["state"];

const LABEL: Record<State, string> = {
  "approval-requested": "Awaiting approval", "approval-responded": "Responded",
  "input-streaming": "Pending", "input-available": "Running",
  "output-available": "Done", "output-denied": "Denied", "output-error": "Rejected"
};
const ICON: Record<State, ReactNode> = {
  "approval-requested": <ClockIcon className="size-3 text-mark" />, "approval-responded": <CheckCircleIcon className="size-3" />,
  "input-streaming": <CircleIcon className="size-3" />, "input-available": <ClockIcon className="size-3 animate-pulse" />,
  "output-available": <CheckCircleIcon className="size-3 text-ok" />, "output-denied": <XCircleIcon className="size-3 text-destructive" />,
  "output-error": <XCircleIcon className="size-3 text-destructive" />
};

export const Tool = ({ className, ...props }: ComponentProps<typeof Collapsible>) => (
  <Collapsible className={cn("group/tool w-full rounded-md border", className)} {...props} />
);

export const ToolHeader = ({ name, state, className }: { name: string; state: State; className?: string }) => (
  <CollapsibleTrigger className={cn("flex w-full items-center justify-between gap-2.5 px-2.5 py-1.5 text-left", className)}>
    <span className="flex min-w-0 items-center gap-1.5">
      <WrenchIcon className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate font-mono text-xs">{name}</span>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-muted px-1.5 text-xs text-muted-foreground" data-state-label={state}>
        {ICON[state]}{LABEL[state]}
      </span>
    </span>
    <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/tool:rotate-180" />
  </CollapsibleTrigger>
);

export const ToolContent = ({ className, ...props }: ComponentProps<typeof CollapsibleContent>) => (
  <CollapsibleContent className={cn("space-y-2.5 border-t px-2.5 py-2.5", className)} {...props} />
);

const asText = (x: unknown) => typeof x === "string" ? x : JSON.stringify(x, null, 2);

const Block = ({ title, text, error }: { title: string; text: string; error?: boolean }) => (
  <div className="space-y-1">
    <div className="text-xs font-medium text-muted-foreground">{title}</div>
    <pre className={cn("max-h-64 overflow-auto rounded-sm p-1.5 font-mono text-xs whitespace-pre-wrap break-words",
      error ? "bg-destructive-soft text-destructive" : "bg-muted")}>{text}</pre>
  </div>
);

export const ToolInput = ({ input }: { input: unknown }) =>
  input === undefined ? null : <Block title="Arguments" text={asText(input)} />;

export const ToolOutput = ({ output, errorText }: { output: unknown; errorText?: string }) =>
  errorText ? <Block title="Rejected" text={errorText} error /> : output === undefined ? null : <Block title="Result" text={asText(output)} />;
