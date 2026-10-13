"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../_ui/select";
import { cn } from "../../lib/cn";

/** a dropdown of fixed options; "" is no choice yet and shows the placeholder */
export function Choice({ value, onChange, options, placeholder, disabled, title, className }: {
  value: string;
  onChange: (v: string) => void;
  options: readonly (readonly [value: string, label: string])[];
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger size="sm" title={title} className={cn("h-8 bg-card text-md", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => <SelectItem key={v} value={v} className="text-md">{label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
