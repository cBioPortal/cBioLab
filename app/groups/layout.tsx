// The Groups page is a client component using the lab's query cache; it streams inside a
// Suspense boundary like the other request-time pages.
import { Suspense } from "react";
import { LabProviders } from "../lab/providers.tsx";

export const metadata = { title: "Groups — cbio-lab" };

export default function GroupsLayout({ children }: { children: React.ReactNode }) {
  return <LabProviders><Suspense>{children}</Suspense></LabProviders>;
}
