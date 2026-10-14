"use client";
// The model's summarized thinking: open while it streams, closed once the answer starts (from
// Vercel's AI Elements).
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/app/_ui/collapsible";
import { cn } from "@/lib/cn";

export function Reasoning({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);
  const started = useRef<number | null>(streaming ? Date.now() : null);
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (streaming) {
      started.current ??= Date.now();
      setOpen(true);
    } else if (started.current !== null) {
      setSeconds(Math.max(1, Math.round((Date.now() - started.current) / 1000)));
      started.current = null;
      const t = setTimeout(() => setOpen(false), 800);
      return () => clearTimeout(t);
    }
  }, [streaming]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/reason">
      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <BrainIcon className="size-3" />
        <span className={cn(streaming && "animate-pulse")}>
          {streaming ? "Thinking…" : seconds ? `Thought for ${seconds} s` : "Thought"}
        </span>
        <ChevronDownIcon className="size-3 transition-transform group-data-[state=open]/reason:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 border-l-2 pl-2.5 text-xs text-muted-foreground">
        <Streamdown>{text}</Streamdown>
      </CollapsibleContent>
    </Collapsible>
  );
}
