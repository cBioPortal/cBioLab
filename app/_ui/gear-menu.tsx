"use client";
// A view or cohort header's menu: a small button that opens a popover of actions or settings.
// Whether it is open is kept in a store the page owns, keyed by `menuId`, so a menu stays open
// when an edit replaces its card (and with it the card's key) and the menu remounts.
import { useEffect, useState } from "react";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Separator } from "./separator";
import { cn } from "../../lib/cn";

const CLOSE = "gearmenu-close";

/** close the menu `menuId` wherever it is mounted now — after an edit that remounted its card, too */
export function closeGearMenu(menuId: string, menuStore?: Map<string, boolean>) {
  menuStore?.set(menuId, false);
  window.dispatchEvent(new CustomEvent<string>(CLOSE, { detail: menuId }));
}

export function GearMenu({ menuId, menuStore, label, title, ariaLabel, className, contentClassName, wide, onOpenChange, children }: {
  menuId: string;
  /** where the open state outlives a remount; without one the menu opens closed */
  menuStore?: Map<string, boolean>;
  /** what the button shows */
  label: React.ReactNode;
  title: string;
  ariaLabel?: string;
  /** on the button; tests find a menu by it */
  className?: string;
  contentClassName?: string;
  /** room for a form rather than a list */
  wide?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** the menu's contents; a function is given `close` */
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
}) {
  const [open, setOpenState] = useState(() => !!menuStore?.get(menuId));
  const setOpen = (o: boolean) => { menuStore?.set(menuId, o); setOpenState(o); onOpenChange?.(o); };
  useEffect(() => {
    const onClose = (e: Event) => { if ((e as CustomEvent<string>).detail === menuId) { setOpenState(false); onOpenChange?.(false); } };
    window.addEventListener(CLOSE, onClose);
    return () => window.removeEventListener(CLOSE, onClose);
  }, [menuId, onOpenChange]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" title={title} aria-label={ariaLabel} data-menu-id={menuId}
          className={cn("h-ctl gap-1 px-2 text-md font-normal shadow-none data-[state=open]:border-primary data-[state=open]:bg-accent data-[state=open]:text-accent-foreground", className)}>
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={8}
        className={cn("gearmenu-items flex w-auto max-w-sm min-w-44 flex-col gap-0.5 p-1.5 text-md", wide && "max-w-[31rem] min-w-[23rem]", contentClassName)}>
        {typeof children === "function" ? children(() => closeGearMenu(menuId, menuStore)) : children}
      </PopoverContent>
    </Popover>
  );
}

/** an action in a GearMenu */
export function MenuItem({ className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button variant="ghost" size="sm" className={cn("h-auto min-h-7 justify-start px-2 py-1 text-md font-normal whitespace-normal text-left", className)} {...props} />;
}

export function MenuSeparator() {
  return <Separator className="my-1" />;
}
