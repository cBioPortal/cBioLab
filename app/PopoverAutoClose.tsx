"use client";
import { useEffect } from "react";

/**
 * Every dropdown built as a native <details class="gearmenu"> — there are
 * eight of them, across the analysis page and the oncoprint figure, and more
 * likely to come — closes on an outside click or Escape, the same as every
 * <dialog> in this app already does natively. <details> has no such behavior
 * on its own: only clicking its own <summary> again toggles it, so without
 * this a reader has to hunt down the exact trigger to dismiss a menu instead
 * of just clicking away or pressing Escape.
 *
 * One document-level listener here covers all of them — there is no single
 * React owner to hang a per-instance handler off, since each <details> is a
 * plain DOM element the browser toggles itself, not React state.
 */
export default function PopoverAutoClose() {
  useEffect(() => {
    const openMenus = () => document.querySelectorAll<HTMLDetailsElement>("details.gearmenu[open]");

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const staysOpen = target?.closest("details.gearmenu[open]") ?? null;
      openMenus().forEach((el) => { if (el !== staysOpen) el.open = false; });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      openMenus().forEach((el) => { el.open = false; });
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
