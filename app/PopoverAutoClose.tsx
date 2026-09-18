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
 * It also keeps every menu on screen. The CSS anchors a menu's panel to one
 * edge of its trigger (right:0 by default, so it opens leftward; the .inline
 * variant anchors left:0 to open rightward) — a fixed choice that assumes the
 * trigger sits far enough from that side of the viewport. The oncoprint
 * toolbar's "tracks" and "display" menus sit at the LEFT of their row (the
 * "data" zone, by the toolbar convention), so their right-anchored, ~18rem
 * panel opened as much as 200px past the left edge of the window — entirely
 * off screen, on any window narrow enough that the toolbar itself isn't wide.
 * Flipping the anchor on open when the panel would overflow fixes this for
 * every gearmenu at once, at whatever width the reader's window happens to
 * be, rather than hand-tuning one menu's CSS for one layout.
 *
 * One document-level listener here covers all of them — there is no single
 * React owner to hang a per-instance handler off, since each <details> is a
 * plain DOM element the browser toggles itself, not React state.
 */
export default function PopoverAutoClose() {
  useEffect(() => {
    const openMenus = () => document.querySelectorAll<HTMLDetailsElement>("details.gearmenu[open]");
    const MARGIN = 8; // stay clear of the viewport edge, not flush against it

    const keepOnScreen = (el: HTMLDetailsElement) => {
      const items = el.querySelector<HTMLElement>(":scope > .gearmenu-items");
      if (!items) return;
      // Undo any earlier correction first — the trigger may have moved (a
      // resize, a reflow) since the last time this menu opened, and last
      // time's fix could itself now be the wrong one.
      items.style.removeProperty("left");
      items.style.removeProperty("right");
      const rect = items.getBoundingClientRect();
      if (rect.left < MARGIN) { items.style.left = "0"; items.style.right = "auto"; }
      else if (rect.right > window.innerWidth - MARGIN) { items.style.right = "0"; items.style.left = "auto"; }
    };

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const staysOpen = target?.closest("details.gearmenu[open]") ?? null;
      openMenus().forEach((el) => { if (el !== staysOpen) el.open = false; });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      openMenus().forEach((el) => { el.open = false; });
    };
    // Capture phase: "toggle" on <details> does not bubble in every browser
    // this app needs to support, but a capturing listener on document sees
    // every event dispatched anywhere in the page regardless.
    const onToggle = (e: Event) => {
      const el = e.target as HTMLDetailsElement;
      if (!(el instanceof HTMLDetailsElement) || !el.classList.contains("gearmenu") || !el.open) return;
      keepOnScreen(el);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("toggle", onToggle, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("toggle", onToggle, true);
    };
  }, []);

  return null;
}
