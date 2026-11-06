"use client";
// The React side of stored links (link-state.ts): a page's parameters, and the stored link its
// address bar names, re-read whenever the URL changes. Held parameters change the address's
// `long=<mark>` with them, so a change to them is a change to the URL here too.
import { createContext, useContext, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import type { LinkParams } from "../../lib/links.ts";
import { knownLink, linkIdOf, linkParams } from "./link-state.ts";

/** linkParams(), for a component: re-read whenever the address bar's parameters change. */
export function useLinkParams(): URLSearchParams {
  const q = useSearchParams();
  const key = q.toString();
  return useMemo(() => linkParams("?" + key), [key]);
}

/** The stored link the address bar names and its parameters, once known; re-read when the URL changes. */
export function useAddressLink(): { id: string; params: LinkParams } | null {
  const key = useSearchParams().toString();
  return useMemo(() => {
    const id = linkIdOf("?" + key);
    const params = id ? knownLink(id) : undefined;
    return id && params ? { id, params } : null;
  }, [key]);
}

/** Set by LinkGate: this page keeps its state in its URL, so the header offers Copy link. */
export const LinkedPage = createContext(false);
export const useLinkedPage = (): boolean => useContext(LinkedPage);
