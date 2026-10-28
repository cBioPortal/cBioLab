// An error message, with the way back from it when there is one: "Undo last change" sits inside
// the alert, at its right, so the fix is read together with what went wrong.
import type { ReactNode } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "./button";
import { TB } from "./toolbar.ts";
import { cn } from "@/lib/cn";

export function ErrorAlert({ children, onUndo }: { children: ReactNode; onUndo?: () => void }) {
  return (
    <div className={cn("error", onUndo && "flex items-center gap-4")} role="alert">
      {onUndo ? <span className="min-w-0 flex-1">{children}</span> : children}
      {onUndo && (
        <Button variant="outline" className={cn(TB, "undo-error shrink-0 whitespace-nowrap")} onClick={onUndo}
          data-tip="put the analysis back as it was before the last change (Ctrl/⌘-Z)"><Undo2 />Undo last change</Button>
      )}
    </div>
  );
}
