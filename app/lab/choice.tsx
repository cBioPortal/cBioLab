"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../_ui/select";
import { cn } from "../../lib/cn";

/** stands in for "" among the options: a select item cannot have an empty value */
const NONE = "\u0000none";

/**
 * A dropdown of fixed options. An option whose value is "" is a choice like any other ("auto",
 * "(any)"); with no such option, "" is no choice yet and shows the placeholder.
 */
export function Choice({ value, onChange, options, placeholder, pending, disabled, title, size = "sm", className }: {
  value: string;
  onChange: (v: string) => void;
  options: readonly (readonly [value: string, label: string])[];
  placeholder?: string;
  /** shown, disabled, while the options are still being fetched */
  pending?: string;
  disabled?: boolean;
  title?: string;
  /** "ctl" fits a view toolbar's control height */
  size?: "sm" | "ctl";
  className?: string;
}) {
  const hasNone = options.some(([v]) => v === "");
  const known = value === "" || options.some(([v]) => v === value);
  return (
    <Select value={value === "" && hasNone ? NONE : value} onValueChange={(v) => onChange(v === NONE ? "" : v)} disabled={disabled}>
      <SelectTrigger size="sm" title={title}
        className={cn("bg-card text-md", size === "ctl" ? "h-ctl gap-1 px-2 data-[size=sm]:h-ctl [&_svg:not([class*='size-'])]:size-3.5" : "h-8", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {!known && <SelectItem value={value} className="text-md">{value}</SelectItem>}
        {options.map(([v, label]) => <SelectItem key={v || NONE} value={v || NONE} className="text-md">{label}</SelectItem>)}
        {pending && <SelectItem value={"\u0000pending"} disabled className="text-md">{pending}</SelectItem>}
      </SelectContent>
    </Select>
  );
}
