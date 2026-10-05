// The portal pages are client components rendered from the URL's search params; under Cache
// Components that request-time read streams inside a Suspense boundary.
import { Suspense } from "react";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <Suspense>{children}</Suspense>;
}
