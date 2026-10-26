// The portal pages are client components rendered from the URL's search params; under Cache
// Components that request-time read streams inside a Suspense boundary. The query cache is the
// app's (app/layout.tsx), so the study list is fetched once whichever page asks for it; the public environment
// (app/_env/public-env.tsx) carries the deployment's Results settings.
import { Suspense } from "react";
import { PublicEnv } from "../_env/public-env.tsx";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <Suspense><PublicEnv>{children}</PublicEnv></Suspense>;
}
