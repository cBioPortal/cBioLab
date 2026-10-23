// The data sets page reads the warehouse at request time, which under Cache Components must stream
// inside a Suspense boundary; the fallback holds the page's shape while the catalog loads.
import { Suspense } from "react";
import { SiteHeader } from "../_ui/site-header.tsx";

export default function DatasetsLayout({ children }: { children: React.ReactNode }) {
  return (<>
    <SiteHeader page="data sets — the studies this deployment holds" />
    <Suspense fallback={
      <main className="repro-page ds-page">
        <div className="repro-intro"><h1>Data sets</h1><p className="meta"><span className="spinner" /> loading the studies this deployment holds…</p></div>
        <div className="skeleton-view" style={{ height: 480 }} />
      </main>
    }>{children}</Suspense>
  </>);
}
