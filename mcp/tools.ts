// Shared MCP tool registry — consumed by mcp/server.js (standalone) and app/api/[transport]/route.js (Vercel).
import { z } from "zod";
import { chQuery, DB, STUDY, PORTAL } from "../lib/ch.ts";
import { compileCohort, compileLines, catalogSqls, lineCatalogSqls, LINE_TYPE } from "../lib/compiler.ts";
import { buildContract } from "../lib/oncoprint.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";
import sharp from "sharp";
import { ensureFonts } from "../lib/fonts.ts";
import { renderDslMarkdown } from "../lib/dsl-reference.ts";
import { runAnalysis, resolveStudy, studyProfiles } from "../lib/analysis.ts";
import { resolverFor, carriesPatientIds, studyRouting } from "../lib/federation.ts";
import { buildExplore } from "../lib/explore.ts";
import { PRIMARY } from "../lib/ch.ts";
import type { AnalysisDoc, CohortDef, OncoprintSpec } from "../lib/types.ts";
import type { PidsCarrier } from "../lib/oncoprint.ts";

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

function cohortCaveats(args: any): string[] {
  const out: string[] = [];
  if (args.rel && args.rel.type === "NOT_FOLLOWED_BY")
    out.push(CAVEATS.absence + (args.rel.observed ? "applied." : "NOT applied — interpret with caution."));
  const usesFirst = [args.a, args.b].some((s: any) => s && s.occurrence === "FIRST");
  if (usesFirst && !args.priorGuard) out.push(CAVEATS.priorMed);
  const usesLines = [args.a, args.b].some((s: any) => s && s.eventType === LINE_TYPE);
  if (usesLines) out.push(CAVEATS.lines);
  return out;
}

function text(t: string) { return { content: [{ type: "text", text: t }] }; }

export function registerTools(server: any): void {

  // ---- federation endpoint -------------------------------------------------
  // What a peer instance exposes to another Cohort Lab: AGGREGATES ONLY.
  // Counts computed inside this instance's database; no patient id is ever
  // returned, which is what makes document-level federation safe to point at
  // data that cannot be shared row-wise.
  server.registerTool(
    "federated_aggregates",
    {
      description:
        "Federation endpoint for another Cohort Lab instance. Evaluates a cohort definition against a study THIS instance holds and returns aggregates only — cohort size, per-gene (profiled, altered, driver) counts, (months, event, n) survival triples, and per-gene-pair 2x2 tables. Never returns patient identifiers. Used by a coordinating instance to include this site's patients in compare and survival views without patient-level data leaving.",
      inputSchema: {
        study: z.string().max(120).describe("Study id held by this instance"),
        cohort: z.record(z.string(), z.any()).describe("Cohort definition (v2 DSL; see describe_dsl)"),
        genes: z.array(z.string()).max(20).nullish().describe("Genes for per-gene counts"),
        survival: z.boolean().nullish().describe("Also return (months, event, n) survival triples"),
        endpoint: z.string().max(40).nullish()
          .describe("Survival endpoint prefix for `survival` — OS, PFS, DFS, DSS… reads <X>_MONTHS/<X>_STATUS (default OS)"),
        anchor: z.object({
          eventType: z.string().max(120),
          key: z.string().max(120).nullish(), value: z.string().max(200).nullish(),
          occurrence: z.enum(["FIRST", "LAST"]).nullish()
        }).nullish().describe("Re-anchor survival to a timeline event. Returns (entry, months, event, n) — entry is the delayed-entry time, without which anchoring manufactures immortal time."),
        survivalEndpoints: z.boolean().nullish()
          .describe("Return the survival endpoints THIS study declares, so a caller can offer only what exists"),
        pairs: z.array(z.tuple([z.string(), z.string()])).max(66).nullish()
          .describe("Gene pairs for co-occurrence: returns each pair's 2x2 (both/onlyA/onlyB/neither) among patients profiled for BOTH genes"),
        attributes: z.array(z.string()).max(20).nullish()
          .describe("Clinical attributes to describe: value counts for categorical, (n, sum, sum of squares, min, max) for numeric. Never individual values."),
        momentGenes: z.array(z.string()).max(12).nullish()
          .describe("With `profileType`, genes for per-gene (n, sum, sum of squares) on that profile — enough to define a z-score reference distribution without disclosing any value"),
        variantGenes: z.array(z.string()).max(12).nullish()
          .describe("Genes for per-protein-change (lollipop) counts: how many patients carry each variant, plus per-gene totals"),
        minCount: z.number().int().min(1).max(1000).nullish()
          .describe("Suppression floor applied by THIS instance before returning variant counts; variants carried by fewer patients are withheld"),
        profileType: z.string().max(120).nullish()
          .describe("With `pairs`, a continuous molecular profile (e.g. an mRNA z-score profile): returns the six sums (n, Sx, Sy, Sxy, Sxx, Syy) per pair, which are sufficient for a correlation and carry no individual value")
      }
    },
    async ({ study, cohort, genes, survival, pairs, attributes, profileType, variantGenes, minCount, momentGenes, endpoint, survivalEndpoints, anchor }: { study: string; cohort: any; genes?: string[] | null; survival?: boolean | null; pairs?: [string, string][] | null; attributes?: string[] | null; profileType?: string | null; variantGenes?: string[] | null; minCount?: number | null; momentGenes?: string[] | null; endpoint?: string | null; survivalEndpoints?: boolean | null; anchor?: any }) => {
      try {
        const s = await resolveStudy(study);
        const { profiles, gaProfiles } = await studyProfiles(s);
        const pin = process.env.ONCOKB_PIN || null;
        const res = await resolverFor(s, { oncokbPin: pin, profiles, gaProfiles });
        const [count, geneCounts, survivalCounts, pairCounts, attributeStats, pairMoments, variantCounts, profileMoments, endpointList] = await Promise.all([
          res.count(cohort),
          genes && genes.length ? res.geneCounts(cohort, genes) : Promise.resolve([]),
          survival ? res.survivalCounts(cohort, endpoint || "OS", anchor || null) : Promise.resolve([]),
          pairs && pairs.length ? res.pairCounts(cohort, pairs) : Promise.resolve([]),
          attributes && attributes.length ? res.attributeStats(cohort, attributes) : Promise.resolve([]),
          pairs && pairs.length && profileType ? res.pairMoments(cohort, pairs, profileType) : Promise.resolve([]),
          variantGenes && variantGenes.length
            ? res.variantCounts(cohort, variantGenes, minCount || 1)
            : Promise.resolve({ variants: [], totals: [], minCount: minCount || 1 }),
          momentGenes && momentGenes.length && profileType
            ? res.profileMoments(cohort, momentGenes, profileType) : Promise.resolve([]),
          survivalEndpoints ? res.survivalEndpoints() : Promise.resolve([] as string[])
        ]);
        // SQL text carries no patient data, and an id-carrying definition was already
        // refused, so disclosing what we ran restores end-to-end provenance for the
        // caller. A deployment that treats its schema as sensitive sets
        // FEDERATION_HIDE_SQL=1 and the caller degrades gracefully.
        const hideSql = process.env.FEDERATION_HIDE_SQL === "1";
        const cohortSql = hideSql ? null : res.cohortSql(cohort);
        const payload = { study: s, instance: res.instance.label, count, geneCounts, survivalCounts, pairCounts, attributeStats, pairMoments, variantCounts, profileMoments, survivalEndpoints: endpointList, cohortSql, queries: hideSql ? null : res.queries, oncokbPin: pin };
        return {
          content: [{ type: "text" as const, text: `aggregates for ${s}: ${count.toLocaleString()} patients` +
            (geneCounts.length ? `, ${geneCounts.length} gene counts` : "") +
            (survivalCounts.length ? `, ${survivalCounts.length} survival strata` : "") +
            (pairCounts.length ? `, ${pairCounts.length} gene-pair tables` : "") +
            (attributeStats.length ? `, ${attributeStats.length} clinical attributes` : "") + " (no patient identifiers returned)" }],
          structuredContent: payload
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: "REJECTED: " + String((e as Error)?.message || e) }], isError: true };
      }
    });

  // Faceting counterpart to federated_aggregates: everything the Explore page
  // needs, as aggregates. Same guarantee — attribute names, value counts, gene
  // and event counts; never a patient identifier.
  server.registerTool(
    "federated_facets",
    {
      description:
        "Federation endpoint for another Cohort Lab instance: the faceted catalog for a study THIS instance holds — clinical attributes with value counts (or numeric min/median/max), timeline event types, most-altered genes, case lists, molecular profiles, and the study's patient count — optionally conditioned on a draft cohort. Aggregates only; never returns patient identifiers. Lets a coordinating instance browse and filter this site's data without querying its database.",
      inputSchema: {
        study: z.string().max(120).describe("Study id held by this instance"),
        draft: z.record(z.string(), z.any()).nullish().describe("Optional draft cohort definition (v2 DSL) to condition every count on"),
        geneSearch: z.string().max(40).nullish().describe("Restrict the gene tables to symbols containing this substring")
      }
    },
    async ({ study, draft, geneSearch }: { study: string; draft?: any; geneSearch?: string | null }) => {
      try {
        const s = await resolveStudy(study);
        if (carriesPatientIds(draft))
          throw new Error("draft contains an explicit patient list; identifiers are not accepted across instances");
        const { profiles, gaProfiles } = await studyProfiles(s);
        const conn = (await studyRouting()).get(s) || PRIMARY;
        const facets = await buildExplore({
          study: s, draft: draft || null, oncokbPin: process.env.ONCOKB_PIN || null,
          geneSearch: geneSearch || undefined, profiles, gaProfiles, conn
        });
        return {
          content: [{ type: "text" as const, text: `facets for ${s}: ${facets.clinical.length} clinical attributes, ` +
            `${facets.genes.length} genes, ${facets.events.length} event types (aggregates only)` }],
          structuredContent: facets as unknown as Record<string, unknown>
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: "REJECTED: " + String((e as Error)?.message || e) }], isError: true };
      }
    });

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
    async ({ document }: { document: AnalysisDoc }) => {
      let r;
      try { r = await runAnalysis(document); }
      catch (e) { return text("REJECTED: " + String((e as Error)?.message || e) + "\nCall describe_dsl for the grammar and runnable examples."); }
      const base = process.env.APP_BASE_URL || "https://cohort-lab.vercel.app";
      const docB64 = Buffer.from(JSON.stringify(document)).toString("base64url");
      const content: any[] = [];
      const out: string[] = [];
      // Small shared formatters. The engine attaches caveats and the author
      // attaches notes; BOTH have to reach the model, or it writes about
      // figures whose methodology and intent it cannot see.
      const pFmt = (x: number) =>
        x === 0 ? "<1e-300" : x < 1e-4 ? x.toExponential(1) : x.toFixed(4);
      const caveatOf = (v: { caveat?: string }) =>
        v.caveat ? "\n  CAVEAT (tell the user): " + v.caveat : "";
      // the AUTHOR's note is `annotationNote`; `note` is the engine's own.
      const noteOf = (v: { annotationNote?: string; note?: string }) =>
        (v.annotationNote ? "\n  NOTE (the author's, tell the user): " + v.annotationNote : "") +
        (v.note ? "\n  " + v.note : "");
      out.push(`Analysis over ${r.involvedStudies.join(" + ")} — OncoKB pin ${r.oncokbPin || "none"} — ${r.stats.ms}ms.`);
      // The document's own title and notes are the author's framing of the whole
      // workspace. They were stored and rendered in the app but never reached a
      // model over MCP, so a caller could not read back what it had written.
      const d = document as { title?: string; notes?: string; params?: Record<string, unknown> };
      if (d.title) out.push(`Title: ${d.title}`);
      if (d.notes) out.push(`Notes (the author's): ${d.notes}`);
      if (r.params && Object.keys(r.params).length)
        out.push("Parameters resolved: " + Object.entries(r.params)
          .map(([k, v]) => `$${k} = ${JSON.stringify(v)}`).join("; ") +
          (r.unusedParams?.length ? `  (declared but never referenced: ${r.unusedParams.map((x) => "$" + x).join(", ")})` : ""));
      out.push("Cohorts:\n" + Object.entries(r.cohorts)
        .map(([n, c]) => `- ${n}: ${c.count.toLocaleString()} patients — ${c.text}`).join("\n"));
      let images = 0;
      for (const v of r.views) {
        if (v.error) { out.push(`View ${v.kind}: ERROR — ${v.error}`); continue; }
        if (v.kind === "compare") {
          const rows = v.rows!.slice(0, 20).map((row) =>
            `  ${row.gene}: ` + row.cells.map((c) => `${c.cohort} ${c.driverPct}%/${c.anyPct}%`).join(" | ") +
            (row.pAny != null ? `  p=${row.pAny < 1e-4 ? row.pAny.toExponential(1) : row.pAny.toFixed(4)}` : ""));
          out.push(`Compare (driver%/any%, panel-aware denominators; annotation ${v.annotation}):\n` + rows.join("\n") +
            noteOf(v));
        } else if (v.kind === "survival") {
          out.push("Survival (KM, overall survival):\n" + v.curves!.map((c) =>
            `  ${c.cohort}: median ${c.median ? c.median.toFixed(1) + "mo" : "not reached"} (n=${c.n}, ${c.events} events${c.missing ? ", " + c.missing + " missing OS" : ""})`).join("\n") +
            "\nCAVEAT (tell the user): " + v.caveat);
        } else if (v.kind === "cooccurrence") {
          out.push("Co-occurrence (2x2 per pair, among patients profiled for BOTH genes):\n" +
            (v.pairs || []).slice(0, 20).map((x) =>
              `  ${x.a}/${x.b}: both ${x.both.toLocaleString()}, ${x.a} only ${x.onlyA.toLocaleString()}, ` +
              `${x.b} only ${x.onlyB.toLocaleString()}, neither ${x.neither.toLocaleString()} (of ${x.profiled.toLocaleString()} profiled)` +
              (x.log2Odds != null ? `  log2OR=${x.log2Odds.toFixed(2)} ${x.log2Odds > 0 ? "(co-occur)" : "(mutually exclusive)"}` : "") +
              `  p=${pFmt(x.p)} q=${pFmt(x.q)}` +
              (x.pStratified != null ? `  stratified p=${pFmt(x.pStratified)}` : "")).join("\n") +
            caveatOf(v) + noteOf(v));
        } else if (v.kind === "clinical") {
          out.push("Clinical comparison across cohorts:\n" +
            (v.clinical || []).slice(0, 20).map((row) => {
              const cells = row.cells.map((c) => row.kind === "num"
                ? `${c.cohort} mean ${c.mean != null ? c.mean.toFixed(2) : "—"}` +
                  (c.sd != null ? ` sd ${c.sd.toFixed(2)}` : "") + ` (n=${c.n.toLocaleString()})`
                : `${c.cohort} ` + (c.top && c.top.length
                    ? c.top.slice(0, 3).map((t) => `${t.v} ${c.n ? Math.round(1000 * t.n / c.n) / 10 : 0}%`).join(", ")
                    : "—")).join(" | ");
              return `  ${row.attribute} [${row.per}, ${row.kind}]: ${cells}` +
                (row.p != null ? `  ${row.test || "test"} p=${pFmt(row.p)} q=${pFmt(row.q!)}` : "") +
                (row.skipped ? `  SKIPPED: ${row.skipped}` : "");
            }).join("\n") + caveatOf(v) + noteOf(v));
        } else if (v.kind === "coexpression") {
          out.push("Co-expression (Pearson r, computed from six per-site sums so the pooled value is exact):\n" +
            (v.coexpression || []).slice(0, 20).map((x) =>
              `  ${x.a}/${x.b}: r=${x.r != null ? x.r.toFixed(3) : "—"} (n=${x.n.toLocaleString()}) p=${pFmt(x.p)} q=${pFmt(x.q)}` +
              (x.rMeta != null ? `  meta-r=${x.rMeta.toFixed(3)} across ${x.sites} sites` : "")).join("\n") +
            caveatOf(v) + noteOf(v));
        } else if (v.kind === "hotspots") {
          out.push("Recurrent protein changes (share of patients mutated in THAT gene):\n" +
            (v.hotspots || []).map((g) =>
              `  ${g.gene}: ${g.mutated.toLocaleString()} mutated — ` +
              (g.variants.slice(0, 6).map((x) => `${x.variant} ${x.n.toLocaleString()} (${x.pct}%)`).join(", ") || "no change above the floor") +
              (g.withheld ? `  [+${g.withheld.toLocaleString()} distinct changes below the suppression floor]` : "")).join("\n") +
            caveatOf(v) + noteOf(v));
        } else if (v.kind === "course") {
          const axis = v.courseAxis;
          out.push(`Clinical course (${axis ? axis.binMonths + "-month bins, " + axis.from + " to +" + axis.to + "mo" : "binned"} ` +
            `relative to the anchor; DENOMINATOR IS THE PATIENTS STILL OBSERVABLE IN EACH BIN, not the cohort):\n` +
            (v.course || []).map((s2) => {
              const pts = s2.points.filter((q) => q.pct != null && q.atRisk > 0);
              const at = (t: number) => { const q = pts.find((z) => z.t === t); return q ? `${q.pct}% (n=${q.atRisk.toLocaleString()})` : "—"; };
              return `  ${s2.cohort} / ${s2.eventType} [${s2.isInterval ? "a state patients are IN" : "an event that HAPPENED"}]: ` +
                `0mo ${at(0)}, 12mo ${at(12)}, 24mo ${at(24)}, 60mo ${at(60)}`;
            }).join("\n") + caveatOf(v) + noteOf(v));
        } else if (v.kind === "sequence") {
          const sq2 = v.sequence;
          out.push(`Treatment sequence (lines of therapy by ${sq2 ? sq2.labelKey : "?"}, ` +
            `${sq2 ? sq2.lineGap : 90}-day line gap):\n` +
            (sq2?.panels || []).map((pn) => {
              const first = pn.nodes.filter((n) => n.column === 1 && n.kind === "regimen")
                .sort((a, b) => b.n - a.n).slice(0, 5)
                .map((n) => `${n.label} ${n.n.toLocaleString()}`).join(", ");
              const stopped = pn.nodes.filter((n) => n.kind === "stopped").reduce((t, n) => t + n.n, 0);
              const cens = pn.censored;
              return `  ${pn.cohort}: ${pn.started.toLocaleString()} with a first line — ${first}\n` +
                `    of all paths, ${stopped.toLocaleString()} were WATCHED and began no further line; ` +
                `${cens.toLocaleString()} (${pn.started ? Math.round(100 * cens / pn.started) : 0}%) end because the RECORD stops — nothing can be concluded about those`;
            }).join("\n") + caveatOf(v) + noteOf(v));
        } else if (v.kind === "oncoprint" && v.svg && images < 2) {
          images++;
          ensureFonts();
          const png = await sharp(Buffer.from(v.svg), { density: 144 }).png().toBuffer();
          content.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
          out.push(`Oncoprint: ${v.nColumns!.toLocaleString()} patients — ` +
            v.genes!.map((g) => `${g.gene} ${g.driverPct}%/${g.anyPct}%`).join(", ") +
            ` — annotation ${v.annotation}.` + noteOf(v));
        } else {
          // A view kind with no branch above used to append nothing at all: the
          // numbers were computed and the model was simply never told. Saying so
          // is worse than a proper description but far better than silence.
          out.push(`View "${v.kind}" ran but this tool has no text rendering for it yet — ` +
            `open the interactive editor link below to see it.`);
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
      const values: Record<string, Record<string, string[]>> = {};
      vRes.data.forEach((r) => { (values[r.t] = values[r.t] || {}); (values[r.t][r.k] = values[r.t][r.k] || []).push(r.v); });
      const lc = lineCatalogSqls(DB, STUDY);
      const combos = (await chQuery(lc.combos)).data.map((r) => r.combo);
      const lines: string[] = [];
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
    async (args: any) => {
      const q = { db: DB, study: STUDY, a: args.a, b: args.b, rel: args.rel, priorGuard: !!args.priorGuard, lineGap: args.lineGap, patientsLimit: 10 };
      const { countSql, patientsSql, histSql, histBucket } = compileCohort(q);
      const c = await chQuery(countSql);
      const matched = Number(c.data[0].matched), denom = Number(c.data[0].denom);
      const pts = (await chQuery(patientsSql)).data.map((r) => r.pid);
      const out: string[] = [];
      out.push(`Cohort: ${matched.toLocaleString()} patients (of ${denom.toLocaleString()} with the anchor event, ${denom ? (100 * matched / denom).toFixed(1) : 0}%).`);
      if (histSql) {
        const h = await chQuery(histSql);
        if (h.data.length) {
          out.push(`Days from A to first subsequent B (bucket=${histBucket}d): ` +
            h.data.map((r) => `${r.bucket}–${Number(r.bucket) + histBucket - 1}d:${r.n}`).join("  "));
        }
      }
      out.push("Sample patients: " + pts.slice(0, 6).map((p) => `${PORTAL}/patient?studyId=${STUDY}&caseId=${p}`).join("  "));
      const cv = cohortCaveats(args);
      if (cv.length) out.push("CAVEATS (tell the user): " + cv.join(" | "));
      out.push(`Query ran in ${c._ms}ms scanning ${Number(c.statistics?.rows_read).toLocaleString()} rows.`);
      return text(out.join("\n\n"));
    });

  server.tool(
    "derive_treatment_lines",
    "Derive lines of therapy for the study by interval-merging systemic-therapy events (Chemo/Immuno/Targeted/Hormone/Biologic/Investigational) per patient, starting a new line after a treatment-free gap. Returns the lines-per-patient distribution and the top line-1 to line-2 regimen transitions.",
    {
      gap: z.number().min(1).max(3650).default(90).describe("Treatment-free gap in days that starts a new line"),
      guard: z.boolean().default(false).describe("Restrict to 'No prior medications' patients so line numbers are absolute")
    },
    async ({ gap, guard }: { gap: number; guard: boolean }) => {
      const { histSql, transSql } = compileLines(DB, STUDY, gap, guard);
      const h = await chQuery(histSql);
      const t = await chQuery(transSql);
      const out: string[] = [];
      out.push(`Lines per patient (gap=${gap}d${guard ? ", 'No prior medications' only" : ""}): ` +
        h.data.map((r) => `${Number(r.bucket) >= 8 ? "8+" : r.bucket}:${Number(r.n).toLocaleString()}`).join("  "));
      out.push("Top 1L→2L transitions: " + t.data.map((r) => `${r.line1}→${r.line2}:${r.n}`).join("  "));
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
    async ({ genes, cohort, groups, derivedEventTracks, clinical, heatmap, sort, patientList }: any) => {
      const spec: OncoprintSpec = {
        genes,
        clinical: clinical || [],
        ...(heatmap && heatmap.length ? { heatmap } : {}),
        ...(sort && sort.length ? { sort } : {}),
        derivedEvents: derivedEventTracks || [],
        cohort: patientList && patientList.length ? { dsl: { patients: patientList } } : (cohort ? { dsl: cohort } : null),
        layout: groups && groups.length ? { groupBy: { kind: "cohorts" as const, groups } } : null,
        conventions: { lineGap: 90 }
      };
      ensureFonts();
      const contract = await buildContract(spec);
      const svg = contractToSvg(contract, 1200);
      const png = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
      const stats = contract.tracks.filter((t) => t.kind === "gene")
        .map((t) => `${t.label}: ${t.driverPct}% driver / ${t.freqPct}% any (${t.driverAltered}/${t.altered}/${t.profiled} driver/altered/profiled)`).join("  ");
      const base = process.env.APP_BASE_URL || "https://cohort-lab.vercel.app";
      const specB64 = Buffer.from(JSON.stringify(spec)).toString("base64url");
      const provUrl = base + "/provenance?spec=" + specB64;
      const summary =
        `Oncoprint: ${contract.stats.nColumns.toLocaleString()} patients` +
        (contract.groups.length > 1 ? ` in groups ${contract.groups.map((g) => `${g.name}(${g.count})`).join(", ")}` : "") +
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

