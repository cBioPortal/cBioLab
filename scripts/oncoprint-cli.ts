#!/usr/bin/env node
// Oncoprint from the command line. Three sources, five outputs, one contract in between.
//
//   node scripts/oncoprint-cli.ts --events events.tsv [--clinical c.tsv] [--coverage cov.tsv]
//        [--genes TP53,KRAS] [--group-by CANCER_TYPE] [--sort=CANCER_TYPE,-AGE] --out fig.svg
//   node --env-file=.env.local scripts/oncoprint-cli.ts --spec spec.json --out fig.png
//   node scripts/oncoprint-cli.ts --contract fig.opb1 --out cells.tsv
//
// --out decides the format by extension: .svg .png .opb1 .json .tsv
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { assembleContract } from "../lib/oncoprint-assemble.ts";
import { localInput, parseTsv } from "../lib/oncoprint-local.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";
import { contractToTsv } from "../lib/oncoprint-tabular.ts";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";
import { bucketCodes, bucketEdges } from "../lib/oncoprint-lod.ts";
import type { Contract } from "../lib/types.ts";

const { values: a } = parseArgs({ options: {
  spec: { type: "string" }, events: { type: "string" }, clinical: { type: "string" }, coverage: { type: "string" },
  contract: { type: "string" }, genes: { type: "string" }, "group-by": { type: "string" }, sort: { type: "string" },
  patients: { type: "string" }, study: { type: "string" },
  out: { type: "string" }, width: { type: "string", default: "1200" }, lod: { type: "string" }, quiet: { type: "boolean", default: false }, help: { type: "boolean", default: false }
} });

if (a.help || (!a.spec && !a.events && !a.contract)) {
  process.stdout.write(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 10).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n");
  process.exit(a.help ? 0 : 2);
}

const t0 = Date.now();
let contract: Contract;
if (a.contract) {
  const buf = readFileSync(a.contract);
  if (a.contract.endsWith(".opb1")) {
    const u = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    contract = { ...u, columns: u.columns(), tracks: u.tracks.map((t) => ({ ...t, cells: Array.from(t.cells) })) } as unknown as Contract;
  } else contract = JSON.parse(buf.toString("utf8"));
} else if (a.spec) {
  // the engine needs ClickHouse credentials: run with node --env-file=.env.local
  const { buildContract } = await import("../lib/oncoprint.ts");
  contract = await buildContract(JSON.parse(readFileSync(a.spec, "utf8")));
} else {
  contract = assembleContract(localInput({
    events: parseTsv(readFileSync(a.events!, "utf8")),
    clinical: a.clinical ? parseTsv(readFileSync(a.clinical, "utf8")) : undefined,
    coverage: a.coverage ? parseTsv(readFileSync(a.coverage, "utf8")) : undefined,
    genes: a.genes ? a.genes.split(",").map((g) => g.trim()).filter(Boolean) : undefined,
    groupBy: a["group-by"], sort: a.sort, study: a.study,
    patients: a.patients ? readFileSync(a.patients, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : undefined
  }));
}

// --lod N: print the level-of-detail bucket codes per group and track (what a renderer draws at N pixels)
if (a.lod) {
  const buckets = Number(a.lod);
  const lod = contract.groups.map((g) => ({ name: g.name, edges: bucketEdges(g.count, buckets),
    tracks: Object.fromEntries(contract.tracks.map((t) => [t.label, bucketCodes(t, t.cells, g.start, g.count, buckets)])) }));
  process.stdout.write(JSON.stringify(lod) + "\n");
  process.exit(0);
}

const out = a.out;
if (out) {
  const width = Number(a.width) || 1200;
  if (out.endsWith(".svg")) writeFileSync(out, contractToSvg(contract, width));
  else if (out.endsWith(".png")) {
    const sharp = (await import("sharp")).default;
    await sharp(Buffer.from(contractToSvg(contract, width)), { density: 144 }).png().toFile(out);
  } else if (out.endsWith(".opb1")) writeFileSync(out, packContract(contract));
  else if (out.endsWith(".json")) writeFileSync(out, JSON.stringify(contract));
  else if (out.endsWith(".tsv")) writeFileSync(out, contractToTsv(contract));
  else { process.stderr.write("--out: unknown extension (svg, png, opb1, json, tsv)\n"); process.exit(2); }
}

if (!a.quiet) {
  const w = (s: string) => process.stdout.write(s + "\n");
  w("oncoprint: " + contract.columns.length.toLocaleString("en-US") + " columns · " + contract.tracks.length + " tracks · " +
    contract.groups.map((g) => g.name + " (" + g.count + ")").join(", ") + " · sort " + contract.conventions.sort.join(", ") + " · " + (Date.now() - t0) + " ms" + (out ? " → " + out : ""));
  for (const t of contract.tracks) if (t.kind === "gene")
    w("  " + t.label.padEnd(10) + String(t.freqPct == null ? "N/P" : t.freqPct + "%").padStart(7) + " any  " + String(t.driverPct == null ? "N/P" : t.driverPct + "%").padStart(7) + " driver  " + t.profiled + " profiled");
}
