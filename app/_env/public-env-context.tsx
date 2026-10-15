"use client";
// The public environment variables (lib/public-env.ts) as the page's server render wrote them.
import { createContext, useContext } from "react";

const PublicEnvContext = createContext<Record<string, string>>({});

export function PublicEnvProvider({ env, children }: { env: Record<string, string>; children: React.ReactNode }) {
  return <PublicEnvContext value={env}>{children}</PublicEnvContext>;
}

/** The public environment variables that are set, by name; a name not listed in PUBLIC_ENV is never here. */
export function usePublicEnv(): Record<string, string> {
  return useContext(PublicEnvContext);
}
