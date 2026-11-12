// /import/updates — try changing a study the ways a live portal does: example updates (new samples,
// a new profile, clinical data, mutations, expression values) applied to the study as it is or to a
// review copy, a review's comparison, approval and undo, and the study's partitions and query
// times as it changes. Local mode only, on a database in the new schema.
import { Suspense } from "react";
import { connection } from "next/server";
import { SiteHeader } from "../../_ui/site-header.tsx";
import { PublicEnv } from "../../_env/public-env.tsx";
import { importEnabled } from "@cbiolab/importer/ch-write";
import { UpdatesClient } from "./updates-client.tsx";

export const metadata = { title: "Study updates — cbio-lab" };

export default function UpdatesPage() {
  return (
    <Suspense fallback={<main className="repro-page import-page"><div className="repro-intro"><h1>Study updates</h1><p className="meta"><span className="spinner" /> loading…</p></div></main>}>
      <UpdatesBody />
    </Suspense>
  );
}

async function UpdatesBody() {
  await connection();
  const local = importEnabled();
  return (
    <PublicEnv>
      <SiteHeader page="study updates — try live changes and reviews" current="import" />
      <main className="repro-page import-page">
        <div className="repro-intro">
          <h1>Study updates</h1>
          {local ? (
            <p className="lede">
              Change a study the way a live portal does, and see what each change costs. An update applied to the study is
              visible to the next query; one applied to a review copy is seen only there until the review is approved. Every
              update here is generated, so you can try new samples, profiles, clinical data and alterations on any imported
              study, then remove it with <a href="/import">Import data</a> and import it again.
            </p>
          ) : (
            <p className="lede">This instance reads a shared warehouse, so its studies are not changed here. Run cBioLab locally with <code>npm run local</code>.</p>
          )}
        </div>
        {local && <UpdatesClient />}
      </main>
    </PublicEnv>
  );
}
