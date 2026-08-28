// MCP Apps (SEP-1865) oncoprint: an interactive oncoprint rendered inside the
// chat client. Additive side-module — it reuses the existing contract engine
// (lib/oncoprint.js) untouched and registers one ui:// resource plus one tool.
//
// Tool -> { content: text summary (for the model),
//           structuredContent: { contract, args } (for the iframe only) }.
// The iframe (mcp/apps/oncoprint-html.js) renders the contract on a canvas and
// re-calls this tool through the host bridge to change the sort.
import { z } from "zod";
import { buildContract, PIDS_SQL } from "../../lib/oncoprint.js";
import { compileCohortDef, describeCohortDef } from "../../lib/cohort2.js";
import { resolveStudy, studyProfiles } from "../../lib/analysis.js";
import { chQuery } from "../../lib/ch.js";
import { ONCOPRINT_APP_HTML } from "./oncoprint-html.js";

export const ONCOPRINT_APP_URI = "ui://cohort-lab/oncoprint";
const MIME = "text/html;profile=mcp-app";
const MAX_APP_COLUMNS = 4000; // keep structuredContent payloads modest

async function oncokbPin() {
  try {
    const r = await chQuery(
      "SELECT oncokb_version FROM oncokb_annotation.variant_annotation GROUP BY oncokb_version ORDER BY max(resolved_at) DESC LIMIT 1");
    return r.data[0]?.oncokb_version || null;
  } catch { return null; }
}

// Display-resolution downsampling for the iframe payload. Full-cohort numbers
// (track frequencies, group patient counts, nColumns) are computed BEFORE this
// and kept; only the cell arrays are bucketed. Aggregation per track kind:
// gene/derivedEvent -> OR of altered (NOT_PROFILED only if the whole bucket is),
// numeric clinical -> mean, categorical clinical -> mode.
export function downsampleContract(contract, maxCols = MAX_APP_COLUMNS) {
  const n = contract.columns.length;
  if (n <= maxCols) return { ...contract, bucketed: false };
  const groups = [];
  const bucketSizes = [];
  const ranges = []; // [i0, i1) per bucket, in original column space
  let cursor = 0;
  for (const g of contract.groups) {
    const nb = Math.max(1, Math.round(maxCols * g.count / n));
    groups.push({ name: g.name, start: cursor, count: nb, patients: g.count });
    for (let b = 0; b < nb; b++) {
      const i0 = g.start + Math.floor(b * g.count / nb);
      const i1 = g.start + Math.max(Math.floor(b * g.count / nb) + 1, Math.floor((b + 1) * g.count / nb));
      ranges.push([i0, i1]);
      bucketSizes.push(i1 - i0);
    }
    cursor += nb;
  }
  const tracks = contract.tracks.map(t => {
    const cells = new Array(ranges.length);
    for (let bi = 0; bi < ranges.length; bi++) {
      const [i0, i1] = ranges[bi];
      if (t.numeric) {
        let sum = 0, nn = 0;
        for (let i = i0; i < i1; i++) if (t.cells[i] !== -1) { sum += t.cells[i]; nn++; }
        cells[bi] = nn ? Math.round(sum / nn) : -1;
      } else if (t.kind === "clinical") {
        const counts = new Map();
        for (let i = i0; i < i1; i++) if (t.cells[i] !== -1) counts.set(t.cells[i], (counts.get(t.cells[i]) || 0) + 1);
        let best = -1, bn = 0;
        for (const [c, k] of counts) if (k > bn) { best = c; bn = k; }
        cells[bi] = best;
      } else {
        let code = -1, saw = false;
        for (let i = i0; i < i1; i++) {
          const c = t.cells[i];
          if (c === -1) continue;
          saw = true;
          code = (code === -1 ? 0 : code) | (c > 0 ? c : 0);
        }
        cells[bi] = saw ? code : -1;
      }
    }
    return { ...t, cells };
  });
  return { ...contract, groups, tracks, columns: [], bucketSizes, bucketed: true };
}

const ARGS = {
  study: z.string().max(120).nullish().describe("Study id (see get_catalog / the studies list); defaults to msk_chord_2024"),
  genes: z.array(z.string()).min(1).max(12).describe("Gene symbols for the gene tracks"),
  cohorts: z.record(z.any()).nullish()
    .describe("Optional named cohorts as v2 cohortDefs (describe_dsl) — each becomes a column group; omit for all study patients"),
  clinical: z.array(z.string()).max(8).nullish().describe("Clinical attribute tracks; numeric attributes render as heat"),
  heatmap: z.array(z.object({ profileType: z.string().max(120), genes: z.array(z.string()).max(12).nullish() })).max(4).nullish()
    .describe("Continuous molecular-profile heatmap tracks, e.g. [{profileType:'mrna_median_Zscores'}] — one row per gene (defaults to the gene tracks); z-score profiles render on a fixed diverging +-3 ramp; unknown profiles error listing what the study has; profileType 'VAF' is a synthetic profile rendering mutation variant-allele fraction from loaded alt/ref counts"),
  sort: z.array(z.string()).max(4).nullish()
    .describe("Column sort keys: 'genomic' (default staircase), a clinical track label, or '-label' descending")
};

export function registerOncoprintApp(server) {
  server.resource(
    "oncoprint_view",
    ONCOPRINT_APP_URI,
    { mimeType: MIME, description: "Interactive oncoprint view (MCP App) for render_oncoprint_app results" },
    async () => ({
      contents: [{
        uri: ONCOPRINT_APP_URI,
        mimeType: MIME,
        text: ONCOPRINT_APP_HTML,
        _meta: { ui: { prefersBorder: true } } // no network needed: default (fully closed) CSP
      }]
    })
  );

  server.registerTool(
    "render_oncoprint_app",
    {
      description:
        "Render an INTERACTIVE oncoprint as an embedded app view (MCP Apps hosts show a live canvas with hover tooltips, per-track column re-sorting, and click-through to the portal; other hosts get the text summary). Columns are patients (optionally grouped by named v2-DSL cohorts), cells are mutations/CNA/SV with OncoKB driver annotation, clinical tracks render categorically or as numeric heat. Single-study. For a static PNG use render_oncoprint; for full documents with compare/survival views use run_analysis.",
      inputSchema: ARGS,
      _meta: { ui: { resourceUri: ONCOPRINT_APP_URI, visibility: ["model", "app"] } }
    },
    async (args) => {
      try {
        const study = await resolveStudy(args.study);
        const { profiles, gaProfiles } = await studyProfiles(study);
        const pin = process.env.ONCOKB_PIN || await oncokbPin();
        const names = Object.keys(args.cohorts || {}).slice(0, 4);
        const layout = names.length
          ? { groupBy: { kind: "cohorts", groups: names.map(n => ({
              name: n,
              dsl: { [PIDS_SQL]: compileCohortDef(args.cohorts[n], { oncokbPin: pin, profiles, gaProfiles, study }) }
            })) } }
          : null;
        const contract = await buildContract({
          study, genes: args.genes, clinical: args.clinical || [], sort: args.sort, heatmap: args.heatmap || [],
          derivedEvents: [], cohort: null, layout, conventions: { lineGap: 90 }
        });
        const appContract = downsampleContract(contract);
        const geneStats = contract.tracks.filter(t => t.kind === "gene")
          .map(t => `${t.label} ${t.driverPct}%/${t.freqPct}%`).join(", ");
        const summary =
          `Interactive oncoprint over ${study}: ${contract.stats.nColumns.toLocaleString("en-US")} patients` +
          (names.length ? ` in groups ${contract.groups.map(g => `${g.name}(${g.count.toLocaleString("en-US")})`).join(", ")}` : "") +
          `.\nCohorts: ${names.length ? names.map(n => `${n} = ${describeCohortDef(args.cohorts[n])}`).join("; ") : "all study patients"}.` +
          `\nGene driver%/any% (panel-aware): ${geneStats}. Annotation: ${contract.conventions.annotation}.` +
          `\nSort: ${(contract.conventions.sort || []).join(", ")}. The embedded view supports hover, re-sorting, and portal click-through` +
          (appContract.bucketed ? " (columns bucketed to display resolution; statistics are full-cohort)" : "") + ".";
        return {
          content: [{ type: "text", text: summary }],
          structuredContent: { contract: appContract, args }
        };
      } catch (e) {
        return { content: [{ type: "text", text: "REJECTED: " + String(e.message || e) + "\nCall describe_dsl for cohortDef grammar." }], isError: true };
      }
    }
  );
}
