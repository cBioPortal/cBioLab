// /datasets — every study the configured instances hold, with how many samples carry each kind of
// data: cBioPortal's Data Sets page, built from the same warehouse tables every view queries.
import { connection } from "next/server";
import { allDatasets, type DatasetRow } from "../../lib/datasets.ts";
import { withoutFailedQueries } from "../../lib/ch.ts";
import { pack, throughCache, cacheVersion, resultEntry } from "../../lib/next-cache.ts";
import { DatasetsTable } from "./DatasetsTable.tsx";
import { PageTools } from "../_agent/PageTools.tsx";

export const metadata = { title: "Data sets — cbio-lab" };

async function datasetsEntry(_version: string): Promise<string> {
  "use cache: remote";
  resultEntry();
  const r = await withoutFailedQueries(() => allDatasets());
  // a catalog missing an instance is served, not kept for a day
  if (r.unreachable.length) throw new Error("an instance did not answer");
  return pack(r);
}

export default async function DatasetsPage() {
  await connection();
  const { rows, unreachable, viaFederation = [] } = await throughCache<{ rows: DatasetRow[]; unreachable: string[]; viaFederation?: string[] }>(
    async () => datasetsEntry(await cacheVersion()), allDatasets);
  const sum = (k: keyof DatasetRow) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  return (
    <main className="repro-page ds-page">
      <PageTools kind="datasets" spec={rows} />
      <div className="repro-intro">
        <h1>Datasets</h1>
        <p className="lede">
          The table below lists the number of available samples per cancer study and data type, from the
          warehouse every view in the app works from — {rows.length.toLocaleString()} studies, {sum("samples").toLocaleString()} samples.
          A study&apos;s name opens it in Explore; its download links to the public cBioPortal datahub, where its files come from.
          {unreachable.length > 0 && <> Not shown: {unreachable.join(", ")} did not answer, so its studies are missing from this list.</>}
          {viaFederation.length > 0 && <> Not shown: the studies of {viaFederation.join(", ")}, reached through federation, which serves no per-sample catalog — they are in Explore&apos;s study list.</>}
        </p>
      </div>
      <DatasetsTable rows={rows} />
    </main>
  );
}
