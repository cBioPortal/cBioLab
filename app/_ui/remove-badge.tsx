"use client";
// A value in a list that a click removes: a gene in a view's gene list, an item of a list parameter.
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "./badge";

export function RemoveBadge({ label, className, children, ...props }:
  Omit<React.ComponentProps<"button">, "type"> & { label: string }) {
  return (
    <Badge asChild variant="outline">
      <button type="button" aria-label={"remove " + label} {...props}
        className={cn("h-6 cursor-pointer bg-card px-2 text-sm font-normal text-foreground hover:border-destructive/60 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-foreground", className)}>
        {children ?? label}<X className="text-muted-foreground" />
      </button>
    </Badge>
  );
}
