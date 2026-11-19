"use client";
// A popover shown while its trigger or the popover itself is hovered. With `pinned` the trigger is a
// button: clicking it (or Enter / Space) keeps the popover open, focus moving into it so a keyboard
// reaches its controls, until the button is pressed again, Escape is pressed or the page is clicked
// elsewhere. Without, the trigger is any content (a link, say), and focusing it shows the popover as
// hovering does.
import { useRef, useState } from "react";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "./popover";

/** how long the pointer may take to cross from the trigger to the popover before it closes */
const LEAVE_MS = 120;

export function HoverPopover({ trigger, children, pinned: pinnable, side, align = "start", className }: {
  trigger: React.ReactNode;
  /** the popover's content, or a function given `close` for content that closes it (a link opening a window) */
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  /** the trigger as a button that pins the popover open, with its name and tip */
  pinned?: { label: string; tip?: string; className?: string };
  side?: "top" | "right" | "bottom" | "left"; align?: "start" | "center" | "end"; className?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // whether the popover being closed was pinned: focus then goes back to the button, as after any menu
  const wasPinned = useRef(false);
  const enter = () => { if (timer.current) clearTimeout(timer.current); setHovered(true); };
  const leave = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setHovered(false), LEAVE_MS); };
  const close = () => { if (timer.current) clearTimeout(timer.current); setPinned(false); setHovered(false); };
  const open = hovered || pinned;
  return (
    <Popover open={open} onOpenChange={(o) => { if (!o) close(); }}>
      {pinnable
        ? <PopoverTrigger asChild>
          <button type="button" className={pinnable.className} aria-label={pinnable.label} data-tip={pinnable.tip} aria-pressed={pinned}
            onMouseEnter={enter} onMouseLeave={leave} onClick={(e) => { e.preventDefault(); if (pinned) close(); else { wasPinned.current = true; setPinned(true); } }}>{trigger}</button>
        </PopoverTrigger>
        : <PopoverAnchor asChild>
          <span className="inline-flex items-center" onMouseEnter={enter} onMouseLeave={leave} onFocus={enter} onBlur={leave}>{trigger}</span>
        </PopoverAnchor>}
      <PopoverContent side={side} align={align} className={className} onMouseEnter={enter} onMouseLeave={leave}
        onOpenAutoFocus={(e) => { if (!pinned) e.preventDefault(); }} onCloseAutoFocus={(e) => { if (!wasPinned.current) e.preventDefault(); wasPinned.current = false; }}>
        {typeof children === "function" ? children(close) : children}
      </PopoverContent>
    </Popover>
  );
}
