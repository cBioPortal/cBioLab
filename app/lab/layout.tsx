// The analysis page is a client component rendered from the URL's search params. Reading them
// is request-time work, so under Cache Components it streams inside a Suspense boundary (it is
// part of the same response; nothing is fetched separately).
import { Suspense } from "react";
import { LabProviders } from "./providers.tsx";

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return <LabProviders><Suspense>{children}</Suspense></LabProviders>;
}
