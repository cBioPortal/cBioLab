// /datasets — every study the configured instances hold, with how many samples carry each kind of
// data: cBioPortal's Data Sets page, built from the same warehouse tables every view queries.
import { cacheLife } from "next/cache";
import { connection } from "next/server";
import { allDatasets, type DatasetRow } from "../../lib/datasets.ts";
import { pack, throughCache, dataVersion } from "../../lib/next-cache.ts";
import { DatasetsTable } from "./DatasetsTable.tsx";
import { PageTools } from "../_agent/PageTools.tsx";

export const metadata = { title: "Data sets — cbio-lab" };

async function datasetsEntry(_version: string): Promise<string> {
  "use cache: remote";
  cacheLife("days");
  const r = await allDatasets();
  // a catalog missing an instance is served, not kept for a day
  if (r.unreachable.length) throw new Error("an instance did not answer");
  return pack(r);
}

export default async function DatasetsPage() {
  await connection();
  const { rows, unreachable } = await throughCache<{ rows: DatasetRow[]; unreachable: string[] }>(
    async () => datasetsEntry(await dataVersion()), allDatasets);
  const sum = (k: keyof DatasetRow) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  return (
    <main className="repro-page ds-page">
      <div className="repro-nav">
        <a href="/lab">← back to the app</a>
        <a href="/reproductions">paper reproductions</a>
        <a href="/rationale">rationale</a>
      </div>
      <PageTools kind="datasets" spec={rows} />
      <div className="repro-intro">
        <h1>Data sets</h1>
        <p className="lede">
          Every study this deployment can query, and how many of its samples carry each kind of data. The
          counts are the warehouse's own, so they are what every view in the app works from. Click a study to
          explore it; a study's download links to the public cBioPortal datahub, where its files come from.
        </p>
        <div className="repro-tiles">
          <div className="repro-tile"><span className="n">{rows.length.toLocaleString()}</span><span className="l">studies</span></div>
          <div className="repro-tile"><span className="n">{sum("patients").toLocaleString()}</span><span className="l">patients</span></div>
          <div className="repro-tile"><span className="n">{sum("samples").toLocaleString()}</span><span className="l">samples</span></div>
          <div className="repro-tile"><span className="n">{rows.filter((r) => r.timeline).length.toLocaleString()}</span><span className="l">with a timeline</span></div>
        </div>
        <p className="meta" style={{ marginTop: "var(--s3)" }}>
          Patients and samples are summed across studies, and a patient in two studies counts twice.
          {unreachable.length > 0 && <> Not shown: {unreachable.join(", ")} did not answer, so its studies are missing from this list.</>}
        </p>
      </div>
      <DatasetsTable rows={rows} />
    </main>
  );
}
