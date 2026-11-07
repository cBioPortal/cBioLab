"use client";
// The app's info icon: a solid circle with an "i", as cBioPortal's fa-info-circle. It is a button
// (a tip opens on hover and on keyboard focus) sized in em, so it scales with the text it sits in;
// put it in a flex row with `items-center` beside that text (InfoLine does) rather than nudging it.
// Colours are theme tokens: the circle --ink, the "i" --card — near-black and white in the light
// theme, and inverted in the dark one, so it keeps its contrast against the card either way.
import * as React from "react";
import { cn } from "@/lib/cn";

export function InfoButton({ className, ...props }: React.ComponentProps<"button"> & { "aria-label": string }) {
  return (
    <button type="button"
      className={cn("inline-flex size-[1em] shrink-0 cursor-help items-center justify-center rounded-full border-0 bg-transparent p-0 text-[var(--ink)]",
        "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", className)}
      {...props}>
      <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true">
        <circle cx="8" cy="8" r="8" fill="currentColor" />
        <circle cx="8" cy="4.6" r="1.25" fill="var(--card)" />
        <rect x="6.9" y="6.9" width="2.2" height="5.6" rx="0.6" fill="var(--card)" />
      </svg>
    </button>
  );
}

/** a line of text with an InfoButton after it, centred on the text whatever the font size */
export function InfoLine({ className, children, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("inline-flex flex-wrap items-center gap-x-[0.35em]", className)} {...props}>{children}</span>;
}
