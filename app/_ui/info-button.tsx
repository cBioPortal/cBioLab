"use client";
// The app's info icon: lucide's Info (the project's icon library, components.json), filled — a
// solid circle with an "i", as cBioPortal's fa-info-circle. It is a button (a tip opens on hover and
// on keyboard focus) sized in em, so it scales with the text it sits in; put it beside that text in
// a flex row with `items-center` (InfoLine) rather than nudging it. Colours are theme tokens: the
// circle is the fill, --ink, and the "i" the stroke, --card — near-black and white in the light
// theme, inverted in the dark one, so it keeps its contrast against the card either way.
import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/cn";

export function InfoButton({ className, ...props }: React.ComponentProps<"button"> & { "aria-label": string }) {
  return (
    <button type="button"
      className={cn("inline-flex size-[1.15em] shrink-0 cursor-help items-center justify-center rounded-full border-0 bg-transparent p-0 text-[var(--ink)]",
        "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", className)}
      {...props}>
      <Info className="size-[1.15em]" fill="currentColor" stroke="var(--card)" aria-hidden="true" />
    </button>
  );
}

/** a line of text with an InfoButton after it, centred on the text whatever the font size */
export function InfoLine({ className, children, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("inline-flex flex-wrap items-center gap-x-[0.35em]", className)} {...props}>{children}</span>;
}
