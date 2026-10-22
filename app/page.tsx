// The homepage: cBioPortal's, choose studies and then explore or query them (app/_home). It reads
// its state from the URL, which under Cache Components streams inside a Suspense boundary; the
// lab's query cache serves its study list, and the public environment its Results settings.
import { Suspense } from "react";
import { LabProviders } from "./lab/providers.tsx";
import { PublicEnv } from "./_env/public-env.tsx";
import { HomePage } from "./_home/HomePage.tsx";

export default function RootPage() {
  return <LabProviders><Suspense><PublicEnv><HomePage /></PublicEnv></Suspense></LabProviders>;
}
