"use client";
// The app's query cache (app/lab/use-analysis.ts), one per browser tab, around every page (app/layout.tsx).
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { makeQueryClient } from "./use-analysis.ts";

export function LabProviders({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
