// Campaign pages are client components reading their id from the URL, which is request-time
// work under Cache Components, so they stream inside a Suspense boundary.
import { Suspense } from "react";

export const metadata = { title: "Hypothesis campaigns — cbio-lab" };

export default function CampaignLayout({ children }: { children: React.ReactNode }) {
  return <Suspense>{children}</Suspense>;
}
