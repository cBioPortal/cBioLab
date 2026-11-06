// The portal pages are client components rendered from the URL's search params; under Cache
// Components that request-time read streams inside a Suspense boundary. The query cache is the
// app's (app/layout.tsx), so the study list is fetched once whichever page asks for it; the public environment
// (app/_env/public-env.tsx) carries the deployment's Results settings. A stored link (?s=) is opened before
// the page renders (app/_links/link-gate.tsx).
import { Suspense } from "react";
import { PublicEnv } from "../_env/public-env.tsx";
import { LinkGate } from "../_links/link-gate.tsx";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <Suspense><PublicEnv><LinkGate>{children}</LinkGate></PublicEnv></Suspense>;
}
