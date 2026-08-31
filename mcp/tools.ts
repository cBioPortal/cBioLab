// Shared MCP tool registry — consumed by mcp/server.js (standalone) and app/api/[transport]/route.js (Vercel).
import { z } from "zod";
import { chQuery, DB, STUDY, PORTAL } from "../lib/ch.ts";
import { compileCohort, compileLines, catalogSqls, lineCatalogSqls, LINE_TYPE } from "../lib/compiler.ts";
import { buildContract } from "../lib/oncoprint.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";
import sharp from "sharp";
import { ensureFonts } from "../lib/fonts.ts";
import { renderDslMarkdown } from "../lib/dsl-reference.ts";
import { runAnalysis } from "../lib/analysis.ts";
import { registerOncoprintApp } from "./apps/oncoprint-app.ts";

// ---------- shared zod fragments (mirrors docs/cohort-query.schema.json) ----------
const zSelector = z.object({
  eventType: z.string().max(200).describe("Event type from describe_study, or 'Treatment line (derived)'"),
  attrs: z.array(z.object({ key: z.string().max(200), value: z.string().max(500) })).max(3).optional()
    .describe("String-equality attribute filters, ANDed. Line events support LINE_NO and COMPOSITION."),
  numeric: z.object({ key: z.string().max(200), op: z.enum([">", ">=", "<", "<=", "="]), value: z.number() })
    .nullish().describe("Numeric predicate on an attribute value (non-numeric values never match)"),
  occurrence: z.enum(["ANY", "FIRST", "LAST"]).optional()
    .describe("Pin to one event per patient BEFORE the relation is evaluated"),
  minDurationDays: z.number().min(0).nullish().describe("Only events lasting >= N days (needs a stop date)")
});
const zRel = z.object({
  type: z.enum(["NONE", "BEFORE", "DURING", "NOT_FOLLOWED_BY"]),
  minDays: z.number().min(0).optional().describe("BEFORE: exclusive lower bound after A.start (default 0)"),
  maxDays: z.number().min(0).optional().describe("BEFORE: inclusive upper bound after A.start (required for BEFORE)"),
  withinDays: z.number().min(1).optional().describe("NOT_FOLLOWED_BY: absence window (required)"),
  observed: z.boolean().optional().describe("NOT_FOLLOWED_BY: require follow-up past the window. STRONGLY recommended (default it to true) — without it, 'no event' conflates with 'lost to follow-up'.")
});
const zCohortDsl = {
  a: zSelector.describe("Anchor event selector (A)"),
  b: zSelector.nullish().describe("Second event selector (B); omit when rel.type is NONE"),
  rel: zRel,
  priorGuard: z.boolean().optional()
    .describe("Restrict to patients NLP-flagged 'No prior medications'. Set true whenever the question depends on 'first' (first line, treatment-naive), because ~20% of treated patients had prior treatment elsewhere and ~20% are undetermined."),
  lineGap: z.number().min(1).max(3650).optional()
    .describe("Treatment-free gap (days) that starts a new derived treatment line (default 90)")
};

const CAVEATS = {
  absence: "Absence query: 'no event recorded' is not proof it didn't happen. The observability guard (observed:true) was " ,
  priorMed: "In this study ~20% of treated patients carry the 'Prior medications to MSK' flag and ~20% have no determination; without priorGuard, 'first X' means first observed at MSK, not necessarily first ever.",
  lines: "Treatment lines are DERIVED from event sequence by interval-merging systemic therapy with a gap rule; 'line 1' means first line observed in this study unless priorGuard is set."
};

function cohortCaveats(args) {
  const out = [];
  if (args.rel && args.rel.type === "NOT_FOLLOWED_BY")
    out.push(CAVEATS.absence + (args.rel.observed ? "applied." : "NOT applied — interpret with caution."));
  const usesFirst = [args.a, args.b].some(s => s && s.occurrence === "FIRST");
  if (usesFirst && !args.priorGuard) out.push(CAVEATS.priorMed);
  const usesLines = [args.a, args.b].some(s => s && s.eventType === LINE_TYPE);
  if (usesLines) out.push(CAVEATS.lines);
  return out;
}

function text(t) { return { content: [{ type: "text", text: t }] }; }

export function registerTools(server) {
  registerOncoprintApp(server); // MCP Apps (SEP-1865) interactive oncoprint — additive side-module

  server.tool(
    "describe_dsl",
    "The complete, generated reference for the Cohort Lab DSL: the Analysis document (cohorts + views), every clause kind (OQL, clinical, timeline events, case lists, continuous genomic data, ...), cross-study federation semantics, the OncoprintSpec, and runnable examples. Read this before composing documents by hand; it is generated from the same source as the docs and the in-app chat grammar, and its examples are CI-executed against the live compiler.",
    {},
    async () => ({ content: [{ type: "text", text: renderDslMarkdown() }] })
  );


  server.tool(
    "run_analysis",
    "Execute a full Analysis document — the v2 DSL: named cohorts built from OQL genomic status, clinical attributes, timeline events, case lists, and continuous genomic data (optionally federated across studies), plus views: compare (alteration frequencies with Fisher p), survival (Kaplan-Meier), and oncoprint (returned as a PNG). Call describe_dsl first for the grammar and runnable examples. Returns per-cohort counts with plain-language readbacks, view results, caveats you MUST surface to the user, and a link that opens this exact document in the interactive editor.",
    {
      document: z.object({}).passthrough()
        .describe("The Analysis document: {study, cohorts: {name: def, ...}, views: [...]}. Grammar and examples: describe_dsl.")
    },
    async ({ document }) => {
      let r;
      try { r = await runAnalysis(document); }
      catch (e) { return text("REJECTED: " + String(e.message || e) + "\nCall describe_dsl for the grammar and runnable examples."); }
      const base = process.env.APP_BASE_URL || "https://cohort-lab.vercel.app";
      const docB64 = Buffer.from(JSON.stringify(document)).toString("base64url");
      const content = [];
      const out = [];
      out.push(`Analysis over ${r.involvedStudies.join(" + ")} — OncoKB pin ${r.oncokbPin || "none"} — ${r.stats.ms}ms.`);
      out.push("Cohorts:\n" + Object.entries(r.cohorts)
        .map(([n, c]) => `- ${n}: ${c.count.toLocaleString()} patients — ${c.text}`).join("\n"));
      let images = 0;
      for (const v of r.views) {
        if (v.error) { out.push(`View ${v.kind}: ERROR — ${v.error}`); continue; }
        if (v.kind === "compare") {
          const rows = v.rows.slice(0, 20).map(row =>
            `  ${row.gene}: ` + row.cells.map(c => `${c.cohort} ${c.driverPct}%/${c.anyPct}%`).join(" | ") +
            (row.pAny != null ? `  p=${row.pAny < 1e-4 ? row.pAny.toExponential(1) : row.pAny.toFixed(4)}` : ""));
          out.push(`Compare (driver%/any%, panel-aware denominators; annotation ${v.annotation}):\n` + rows.join("\n") +
            (v.note ? "\nNOTE: " + v.note : ""));
        } else if (v.kind === "survival") {
          out.push("Survival (KM, overall survival):\n" + v.curves.map(c =>
            `  ${c.cohort}: median ${c.median ? c.median.toFixed(1) + "mo" : "not reached"} (n=${c.n}, ${c.events} events${c.missing ? ", " + c.missing + " missing OS" : ""})`).join("\n") +
            "\nCAVEAT (tell the user): " + v.caveat);
        } else if (v.kind === "oncoprint" && v.svg && images < 2) {
          images++;
          ensureFonts();
          const png = await sharp(Buffer.from(v.svg), { density: 144 }).png().toBuffer();
          content.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
          out.push(`Oncoprint: ${v.nColumns.toLocaleString()} patients — ` +
            v.genes.map(g => `${g.gene} ${g.driverPct}%/${g.anyPct}%`).join(", ") +
            ` — annotation ${v.annotation}.` + (v.note ? "\nNOTE (tell the user): " + v.note : ""));
        }
      }
      out.push(`Interactive editor (share with the user — opens this exact document, live): ${base}/analysis?doc=${docB64}` +
        `\nThat page also shows the generated SQL for every cohort (full provenance).`);
      content.push({ type: "text", text: out.join("\n\n") });
      return { content };
    });

  server.tool(
    "describe_study",
    "Get the study's queryable vocabulary: timeline event types with patient counts, their attribute keys and common values, the synthetic 'Treatment line (derived)' event type, and study-level caveats. Call this once before composing cohort queries.",
    {},
    async () => {
      const sqls = catalogSqls(DB, STUDY);
      const [tRes, vRes] = [await chQuery(sqls.types), await chQuery(sqls.values)];
      const values = {};
      vRes.data.forEach(r => { (values[r.t] = values[r.t] || {}); (values[r.t][r.k] = values[r.t][r.k] || []).push(r.v); });
      const lc = lineCatalogSqls(DB, STUDY);
      const combos = (await chQuery(lc.combos)).data.map(r => r.combo);
      const lines = [];
      lines.push(`Study: ${STUDY} (unit of counting: patient). Portal: ${PORTAL}/study/summary?id=${STUDY}`);
      lines.push("\nEvent types (patients | events):");
      for (const t of tRes.data) {
        lines.push(`- ${t.t}: ${Number(t.n_pat).toLocaleString()} pts | ${Number(t.n_ev).toLocaleString()} events`);
        const keys = values[t.t] || {};
        for (const k of Object.keys(keys).slice(0, 8))
          lines.push(`    ${k}: ${keys[k].slice(0, 10).join(", ")}${keys[k].length > 10 ? ", …" : ""}`);
      }
      lines.push(`- ${LINE_TYPE}: derived at query time (gap rule, default 90d). Attributes: LINE_NO (1..n), COMPOSITION (${combos.slice(0, 8).join(", ")}, …)`);
      lines.push("\nCaveats: " + CAVEATS.priorMed + " Dates are per-patient day offsets; only intervals/orderings are meaningful.");
      return text(lines.join("\n"));
    });

  server.tool(
    "query_cohort",
    "Define a patient cohort by temporal relationships between clinical timeline events and count it. Semantics: a patient is in the cohort if there EXISTS a pair of event occurrences satisfying the relation. Returns counts, a plain-language readback (echo it to the user to confirm intent), a days-from-A-to-B histogram for BEFORE queries, sample patient portal links, and caveats you MUST surface to the user.",
    zCohortDsl,
    async (args) => {
      const q = { db: DB, study: STUDY, a: args.a, b: args.b, rel: args.rel, priorGuard: !!args.priorGuard, lineGap: args.lineGap, patientsLimit: 10 };
      const { countSql, patientsSql, histSql, histBucket } = compileCohort(q);
      const c = await chQuery(countSql);
      const matched = Number(c.data[0].matched), denom = Number(c.data[0].denom);
      const pts = (await chQuery(patientsSql)).data.map(r => r.pid);
      const out = [];
      out.push(`Cohort: ${matched.toLocaleString()} patients (of ${denom.toLocaleString()} with the anchor event, ${denom ? (100 * matched / denom).toFixed(1) : 0}%).`);
      if (histSql) {
        const h = await chQuery(histSql);
        if (h.data.length) {
          out.push(`Days from A to first subsequent B (bucket=${histBucket}d): ` +
            h.data.map(r => `${r.bucket}–${Number(r.bucket) + histBucket - 1}d:${r.n}`).join("  "));
        }
      }
      out.push("Sample patients: " + pts.slice(0, 6).map(p => `${PORTAL}/patient?studyId=${STUDY}&caseId=${p}`).join("  "));
      const cv = cohortCaveats(args);
      if (cv.length) out.push("CAVEATS (tell the user): " + cv.join(" | "));
      out.push(`Query ran in ${c._ms}ms scanning ${Number(c.statistics.rows_read).toLocaleString()} rows.`);
      return text(out.join("\n\n"));
    });

  server.tool(
    "derive_treatment_lines",
    "Derive lines of therapy for the study by interval-merging systemic-therapy events (Chemo/Immuno/Targeted/Hormone/Biologic/Investigational) per patient, starting a new line after a treatment-free gap. Returns the lines-per-patient distribution and the top line-1 to line-2 regimen transitions.",
    {
      gap: z.number().min(1).max(3650).default(90).describe("Treatment-free gap in days that starts a new line"),
      guard: z.boolean().default(false).describe("Restrict to 'No prior medications' patients so line numbers are absolute")
    },
    async ({ gap, guard }) => {
      const { histSql, transSql } = compileLines(DB, STUDY, gap, guard);
      const h = await chQuery(histSql);
      const t = await chQuery(transSql);
      const out = [];
      out.push(`Lines per patient (gap=${gap}d${guard ? ", 'No prior medications' only" : ""}): ` +
        h.data.map(r => `${r.bucket >= 8 ? "8+" : r.bucket}:${Number(r.n).toLocaleString()}`).join("  "));
      out.push("Top 1L→2L transitions: " + t.data.map(r => `${r.line1}→${r.line2}:${r.n}`).join("  "));
      out.push("CAVEAT (tell the user): " + CAVEATS.lines + (guard ? "" : " " + CAVEATS.priorMed));
      return text(out.join("\n\n"));
    });

  server.tool(
    "render_oncoprint",
    "Render an oncoprint image for gene alterations across a cohort (or across column groups defined by two cohorts). Columns are patients, staircase-sorted; cells show mutations by class, high-level CNA (amp/deep-deletion only), and structural variants; striped cells mean the gene was NOT on that patient's sequencing panel (distinct from unaltered); per-track frequencies use panel-aware denominators. Returns a PNG plus the track statistics.",
    {
      genes: z.array(z.string()).min(1).max(12).describe("Gene symbols for tracks, e.g. ['TP53','KRAS','MSH3']"),
      cohort: z.object(zCohortDsl).nullish().describe("Cohort for the columns; omit for all patients (ignored when groups given)"),
      groups: z.array(z.object({ name: z.string().max(60), dsl: z.object(zCohortDsl) })).max(4).nullish()
        .describe("Optional column groups, each its own cohort DSL — e.g. progressors vs non-progressors side by side"),
      patientList: z.array(z.string().max(64)).max(10000).nullish()
        .describe("Explicit patient IDs (e.g. imported from a portal custom case list) to use as the cohort — overrides `cohort`; ids not in the study are dropped"),
      derivedEventTracks: z.array(z.object({ label: z.string().max(60), expression: z.object(zCohortDsl) })).max(3).nullish()
        .describe("Optional phenotype tracks from cohort-DSL expressions, e.g. 'Reached 2L'"),
      sort: z.array(z.string()).max(4).nullish()
        .describe("Column sort: ordered track keys — 'genomic' (default staircase), a clinical track label (must also be in clinical), or '-label' for descending; missing values sort last"),
      clinical: z.array(z.string()).max(8).nullish().describe("Clinical attribute tracks, e.g. ['OS_STATUS','CURRENT_AGE_DEID']; sample-level attributes fall back to a sample value per patient; numeric attributes render as continuous heat tracks; unknown names render a labeled '(no data)' track"),
      heatmap: z.array(z.object({ profileType: z.string().max(120), genes: z.array(z.string()).max(12).nullish() })).max(4).nullish()
        .describe("Continuous molecular-profile heatmap tracks (portal-style), e.g. [{profileType:'mrna_median_Zscores'}] — one row per gene (defaults to the gene tracks), patient value = mean across samples; z-score profiles use a fixed diverging +-3 blue-white-red ramp; unknown profiles error listing what the study has; profileType 'VAF' is a synthetic profile rendering mutation variant-allele fraction from loaded alt/ref counts")
    },
    async ({ genes, cohort, groups, derivedEventTracks, clinical, heatmap, sort, patientList }) => {
      const spec = {
        genes,
        clinical: clinical || [],
        ...(heatmap && heatmap.length ? { heatmap } : {}),
        ...(sort && sort.length ? { sort } : {}),
        derivedEvents: derivedEventTracks || [],
        cohort: patientList && patientList.length ? { dsl: { patients: patientList } } : (cohort ? { dsl: cohort } : null),
        layout: groups && groups.length ? { groupBy: { kind: "cohorts", groups } } : null,
        conventions: { lineGap: 90 }
      };
      ensureFonts();
      const contract = await buildContract(spec);
      const svg = contractToSvg(contract, 1200);
      const png = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
      const stats = contract.tracks.filter(t => t.kind === "gene")
        .map(t => `${t.label}: ${t.driverPct}% driver / ${t.freqPct}% any (${t.driverAltered}/${t.altered}/${t.profiled} driver/altered/profiled)`).join("  ");
      const base = process.env.APP_BASE_URL || "https://cohort-lab.vercel.app";
      const specB64 = Buffer.from(JSON.stringify(spec)).toString("base64url");
      const provUrl = base + "/provenance?spec=" + specB64;
      const summary =
        `Oncoprint: ${contract.stats.nColumns.toLocaleString()} patients` +
        (contract.groups.length > 1 ? ` in groups ${contract.groups.map(g => `${g.name}(${g.count})`).join(", ")}` : "") +
        `.\nGene frequencies (panel-aware denominators): ${stats}` +
        `\nConventions: CNA ±2 only; striped = not profiled (not the same as unaltered); solid = putative driver, faded = VUS.` +
        (String(contract.conventions.annotation).startsWith("MOCK")
          ? `\nANNOTATION SOURCE (tell the user): ${contract.conventions.annotation} — driver/VUS calls are a mock placeholder; treat driver percentages as illustrative only.`
          : `\nAnnotations: ${contract.conventions.annotation} — driver/VUS classification is version-pinned; the same spec re-renders identically against this release.`) +
        `\nProvenance (share this with the user): ${provUrl}\n` +
        `That page re-renders this exact oncoprint and shows the DSL spec and every generated SQL query.` +
        `\nInteractive editor (share this too — it opens THIS oncoprint with live controls): ${base}/oncoprint?spec=${specB64}` +
        `\nModifications the user can ask for right here in chat: add or remove gene tracks (up to 12); ` +
        `add clinical attribute tracks, up to 8 (e.g. OS_STATUS, GENDER, SMOKING_PREDICTIONS_3_CLASSES; numeric ones like CURRENT_AGE_DEID render as heat); ` +
        `add derived-event phenotype tracks from any cohort expression (e.g. "reached 3rd line", "had surgery"); ` +
        `regroup columns by different cohorts (up to 4 side-by-side); change the treatment-line gap rule (lineGap); ` +
        `restrict any group to treatment-naive patients (priorGuard); sort columns by a clinical track ('sort':['CANCER_TYPE'] or '-CURRENT_AGE_DEID' for descending); add molecular heatmap tracks where the study has continuous profiles (e.g. heatmap:[{profileType:'mrna_median_Zscores'}]) and sort by them. Offer 1-2 of these as next steps when relevant.`;
      return {
        content: [
          { type: "image", data: png.toString("base64"), mimeType: "image/png" },
          { type: "text", text: summary }
        ]
      };
    });

}

