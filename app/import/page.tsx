// /import — bring a study into this instance: drop a study folder or its files, name a folder on
// this computer, or fetch a public study from datahub. Local mode only (`npm run local`); a
// deployment reading a shared warehouse says so and offers nothing to click.
import { Suspense } from "react";
import { connection } from "next/server";
import { SiteHeader } from "../_ui/site-header.tsx";
import { PublicEnv } from "../_env/public-env.tsx";
import { importEnabled } from "../../lib/importer/ch-write.ts";
import { ImportClient } from "./import-client.tsx";

export const metadata = { title: "Import data — cbio-lab" };

export default function ImportPage() {
  return (
    <Suspense fallback={<main className="repro-page import-page"><div className="repro-intro"><h1>Import data</h1><p className="meta"><span className="spinner" /> loading…</p></div></main>}>
      <ImportBody />
    </Suspense>
  );
}

/** Whether this instance imports is read per request, from the environment the launcher set. */
async function ImportBody() {
  await connection();
  const local = importEnabled();
  return (
    <PublicEnv>
      <SiteHeader page="import data — your own studies, on this computer" current="import" />
      <main className="repro-page import-page">
        <div className="repro-intro">
          <h1>Import data</h1>
          {local ? (
            <p className="lede">
              Bring a study into this cBioLab: drop a study folder (or its files) in cBioPortal&apos;s format, name a folder on this
              computer, or fetch any public study from datahub by its id. The files are read here and stored in this
              computer&apos;s own database; nothing leaves it. A study imported again replaces the earlier import.
            </p>
          ) : (
            <p className="lede">
              This instance reads a shared warehouse, so it does not import data. To work with your own files, run cBioLab
              locally with <code>npm run local</code>: it starts a private database on your computer and opens this page there.
            </p>
          )}
        </div>
        {local && <ImportClient />}
      </main>
    </PublicEnv>
  );
}
