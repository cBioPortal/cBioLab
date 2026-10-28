"use client";
import { Children, isValidElement } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
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
      <SelectTrigger size="sm" data-tip={title} aria-label={title}
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

type Opt = { value: string; label: string; disabled: boolean };

const textOf = (node: React.ReactNode): string =>
  node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(textOf).join("")
    : isValidElement(node) ? textOf((node.props as { children?: React.ReactNode }).children) : String(node);

/** the <option>s among `children`, however they are nested in fragments and arrays */
function optionsOf(children: React.ReactNode): Opt[] {
  return Children.toArray(children).flatMap((c): Opt[] => {
    if (!isValidElement(c)) return [];
    const props = c.props as { value?: string | number; children?: React.ReactNode; disabled?: boolean };
    if (c.type === "option") return [{ value: props.value != null ? String(props.value) : textOf(props.children), label: textOf(props.children), disabled: !!props.disabled }];
    return optionsOf(props.children);
  });
}

/** A view toolbar's dropdown written as <option> children, the way a native select is. */
export function OptionSelect({ value, onValueChange, children, disabled, title, ariaLabel, className, style }: {
  value: string | number;
  onValueChange: (v: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const options = optionsOf(children);
  const v = String(value);
  const hasNone = options.some((o) => o.value === "");
  return (
    <Select value={v === "" && hasNone ? NONE : v} onValueChange={(x) => onValueChange(x === NONE ? "" : x)} disabled={disabled}>
      <SelectTrigger size="sm" data-tip={title} aria-label={ariaLabel} style={style}
        className={cn("h-ctl gap-1 bg-card px-2 text-md data-[size=sm]:h-ctl [&_svg:not([class*='size-'])]:size-3.5", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o, i) => <SelectItem key={i} value={o.value || (o.disabled ? "\u0000disabled" + i : NONE)} disabled={o.disabled} className="text-md">{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
