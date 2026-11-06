// The analysis page is a client component rendered from the URL's search params. Reading them
// is request-time work, so under Cache Components it streams inside a Suspense boundary (it is
// part of the same response; nothing is fetched separately) — as do the public environment
// variables the page reads (app/_env/public-env.tsx). A stored link (?s=) is opened before the
// page renders (app/_links/link-gate.tsx).
import { Suspense } from "react";
import { PublicEnv } from "../_env/public-env.tsx";
import { LinkGate } from "../_links/link-gate.tsx";

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return <Suspense><PublicEnv><LinkGate>{children}</LinkGate></PublicEnv></Suspense>;
}
