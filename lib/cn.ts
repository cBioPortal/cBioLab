// Class names for Tailwind markup: clsx's conditional joining, then tailwind-merge so a later
// class overrides an earlier one of the same kind (a caller's `px-2` beats a component's `px-3`).
// tailwind-merge is told this app's own theme names, or it would not know `text-md` is a size
// (it would read it as a colour and let `text-md text-primary` drop one of them).
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const merge = extendTailwindMerge({
  extend: { theme: { text: ["md"], radius: ["pill"], spacing: ["ctl"] } },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
