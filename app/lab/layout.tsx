// The analysis page is a client component rendered from the URL's search params. Reading them
// is request-time work, so under Cache Components it streams inside a Suspense boundary (it is
// part of the same response; nothing is fetched separately) — as do the public environment
// variables the page reads (app/_env/public-env.tsx).
import { Suspense } from "react";
import { LabProviders } from "./providers.tsx";
import { PublicEnv } from "../_env/public-env.tsx";

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return <LabProviders><Suspense><PublicEnv>{children}</PublicEnv></Suspense></LabProviders>;
}
