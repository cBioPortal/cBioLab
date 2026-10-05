"use client";
// AI tools for the site's smaller pages, and the header menu that lists them. Each page passes
// what it already rendered (a spec) or nothing; the tools read and navigate, since these pages
// are stateless — their link is their content — and editing happens in /lab.
import { useEffect, useState } from "react";
import { exposeTools, type AgentTool } from "../../lib/webmcp.ts";
import { REPRODUCTIONS } from "../../lib/reproductions.ts";
import { encodeSpec } from "../../lib/lab-links.ts";
import { AgentToolsMenu } from "./AgentToolsMenu.tsx";

type Kind = "reproductions" | "provenance" | "oncoprint-lab" | "rationale" | "datasets";

const pageText = (max = 30000) => {
  const t = (document.querySelector("main") || document.body).innerText;
  return t.length <= max ? t : t.slice(0, max) + `\n… [${(t.length - max).toLocaleString()} more characters]`;
};

function toolsFor(kind: Kind, spec: unknown): { tools: AgentTool[]; rows: [string, string][]; api: Record<string, unknown>; intro: string } {
  if (kind === "reproductions") {
    const find = (slug: string) => {
      const r = REPRODUCTIONS.find((x) => x.slug === slug) || REPRODUCTIONS.find((x) => x.title.toLowerCase().includes(String(slug).toLowerCase()));
      if (!r) throw new Error(`no reproduction "${slug}"; have ${REPRODUCTIONS.map((x) => x.slug).join(", ")}`);
      return r;
    };
    const tools: AgentTool[] = [
      { name: "reproductions_list", description: "The published papers reproduced here: slug, title, citation, studies, verdict, summary, and each claim against the live result.",
        inputSchema: { type: "object", properties: {} },
        run: async () => REPRODUCTIONS.map(({ doc, ...r }) => r) },
      { name: "reproduction_get_document", description: "The runnable Analysis document behind one reproduction, by slug.",
        inputSchema: { type: "object", required: ["slug"], properties: { slug: { type: "string" } } },
        run: async ({ slug }) => find(slug).doc },
      { name: "reproduction_open", description: "Open one reproduction in the analysis app (/lab), where it runs live and can be read and edited with the analysis tools.",
        inputSchema: { type: "object", required: ["slug"], properties: { slug: { type: "string" } } },
        run: async ({ slug }) => {
          const r = find(slug);
          setTimeout(() => location.assign("/lab?doc=" + encodeSpec(r.doc)), 300);
          return `Opening "${r.title}" in /lab. Once it loads, use analysis_get_results there.`;
        } }
    ];
    return { tools, intro: "Your AI assistant can list these reproductions, read their documents, and open one in the analysis app.",
      rows: [["reproductions_list", "list()"], ["reproduction_get_document", "getDocument(slug)"], ["reproduction_open", "openInLab(slug)"]],
      api: { list: () => tools[0].run({}), getDocument: (slug: string) => tools[1].run({ slug }), openInLab: (slug: string) => tools[2].run({ slug }) } };
  }
  if (kind === "datasets") {
    type Row = { id: string; name: string; cancerType: string; [k: string]: unknown };
    const rows = (spec as Row[]) || [];
    const tools: AgentTool[] = [
      { name: "datasets_list", description: "The studies this deployment holds, with sample counts per data type (mutation, cna, sv, segments, mrna, protein, timeline patients, treatments, methylation, FACETS, generic assays). Optional `query` filters by name, id or cancer type; optional `has` keeps studies with every named data type.",
        inputSchema: { type: "object", properties: { query: { type: "string" },
          has: { type: "array", items: { type: "string", enum: ["mutation", "cna", "sv", "segments", "mrna", "protein", "timeline", "treatments", "methylation", "ascn", "genericAssays"] } } } },
        run: async ({ query, has }) => {
          const needle = String(query || "").toLowerCase();
          const need: string[] = Array.isArray(has) ? has : [];
          return rows.filter((r) => (!needle || [r.name, r.id, r.cancerType].some((x) => String(x).toLowerCase().includes(needle))) &&
            need.every((k) => { const v = r[k]; return Array.isArray(v) ? v.length > 0 : Boolean(v); }));
        } },
      { name: "dataset_explore", description: "Open one study in Explore (/lab), where its facets can be read and filtered with the Explore tools.",
        inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        run: async ({ id }) => {
          const r = rows.find((x) => x.id === id);
          if (!r) throw new Error(`no study "${id}" here`);
          setTimeout(() => location.assign("/lab?tab=explore&study=" + encodeURIComponent(r.id)), 300);
          return `Opening ${r.name} in Explore.`;
        } }
    ];
    return { tools, intro: "Your AI assistant can search these studies by what data they carry, and open one in Explore.",
      rows: [["datasets_list", "list(query, has)"], ["dataset_explore", "explore(id)"]],
      api: { list: (query?: string, has?: string[]) => tools[0].run({ query, has }), explore: (id: string) => tools[1].run({ id }) } };
  }
  if (kind === "provenance" || kind === "oncoprint-lab") {
    const tools: AgentTool[] = [
      { name: "oncoprint_get_spec", description: "The OncoprintSpec this page draws: studies, genes, clinical tracks, grouping.",
        inputSchema: { type: "object", properties: {} },
        run: async () => spec ?? "this page has no spec" },
      { name: "page_get_text", description: kind === "provenance"
          ? "The page as text: the spec, the cohort definitions and every SQL query they compiled to."
          : "The page as text: presets, the figure's header and legend.",
        inputSchema: { type: "object", properties: {} },
        run: async () => pageText() },
      { name: "oncoprint_open_spec", description: "Draw a different oncoprint: opens the oncoprint lab with this spec (the link is the figure).",
        inputSchema: { type: "object", required: ["spec"], properties: { spec: { type: "object" } } },
        run: async ({ spec: s }) => { setTimeout(() => location.assign("/oncoprint-lab?spec=" + encodeSpec(s)), 300); return "Opening the oncoprint lab with that spec."; } }
    ];
    return { tools, intro: kind === "provenance"
        ? "Your AI assistant can read this oncoprint's spec and every query behind it, or open it in the oncoprint lab."
        : "Your AI assistant can read this oncoprint's spec, and draw another by opening a new one.",
      rows: [["oncoprint_get_spec", "getSpec()"], ["page_get_text", "getText()"], ["oncoprint_open_spec", "openSpec(spec)"]],
      api: { getSpec: () => tools[0].run({}), getText: () => tools[1].run({}), openSpec: (s: unknown) => tools[2].run({ spec: s }) } };
  }
  const tools: AgentTool[] = [
    { name: "page_get_text", description: "This page as text: the project's rationale — why it is built this way, and what is built versus planned.",
      inputSchema: { type: "object", properties: {} },
      run: async () => pageText(60000) }
  ];
  return { tools, intro: "Your AI assistant can read this page.", rows: [["page_get_text", "getText()"]], api: { getText: () => tools[0].run({}) } };
}

export function PageTools({ kind, spec }: { kind: Kind; spec?: unknown }) {
  const [webmcp, setWebmcp] = useState<boolean | null>(null);
  const t = toolsFor(kind, spec);
  useEffect(() => {
    const x = toolsFor(kind, spec);
    const h = exposeTools(kind, x.tools, x.api);
    setWebmcp(h.webmcp);
    return h.cleanup;
  }, [kind, spec]);
  return <AgentToolsMenu page={kind} tools={t.rows} webmcp={webmcp} intro={t.intro} />;
}
