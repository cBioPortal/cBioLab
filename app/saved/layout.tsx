// The saved-work manager as a page reads its tab from the URL: request-time work, so under Cache
// Components it streams inside a Suspense boundary like the other request-time pages.
import { Suspense } from "react";

export const metadata = { title: "Your saved work — cbio-lab" };

export default function SavedLayout({ children }: { children: React.ReactNode }) {
  return <Suspense>{children}</Suspense>;
}
