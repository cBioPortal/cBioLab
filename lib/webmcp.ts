// WebMCP for every page of the site: a page hands its tools to exposeTools(), which
// registers them with document.modelContext (navigator.modelContext before Chromium 150)
// when the browser offers it, and publishes the same functions as window.cohortLab for an
// agent that can run page JavaScript but does not discover WebMCP tools itself — the Claude
// sidebar in Chrome today. These tools are the only way any assistant reads and edits what the
// page shows — including the site's own chat sidebar (app/_agent/ChatSidebar.tsx), which calls
// them through window.cohortLab like any other.

export type Json = Record<string, unknown>;
export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Json;
  run: (args: any) => Promise<unknown>;
}

const asText = (x: unknown) => typeof x === "string" ? x : JSON.stringify(x, null, 2);

/** What each page of the site is for — the map an assistant navigates by. */
export const SITE_PAGES = [
  { path: "/lab", what: "the analysis app: Explore studies and build a cohort from facets, saved cohorts and analyses, and the Analysis document (cohorts + views) with every result; the gallery of examples" },
  { path: "/campaign", what: "hypothesis campaigns: start one for a research question, then register hypotheses, lock and run them on held-out patients" },
  { path: "/datasets", what: "every study this deployment holds, with sample counts per data type; each opens in Explore" },
  { path: "/reproductions", what: "published papers reproduced against the live data, each an analysis that opens in /lab" },
  { path: "/oncoprint-lab", what: "an oncoprint drawn from a spec (?spec=<base64url>), with presets" },
  { path: "/rationale", what: "why the project is built this way, and what is built versus planned" }
];

/** The two tools every page carries, so an assistant can move around the site on its own. */
export function siteTools(): AgentTool[] {
  return [
    { name: "site_pages", description: "The pages of this site and what each is for. Each page exposes its own tools; opening another page replaces this page's tools with that page's.",
      inputSchema: { type: "object", properties: {} },
      run: async () => SITE_PAGES },
    { name: "site_open", description: "Open another page of this site by path (e.g. \"/campaign\" or a \"/lab?doc=…\" link). The browser navigates; continue with the new page's tools once it has loaded.",
      inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } },
      run: async ({ path }) => {
        const p = String(path || "");
        if (!p.startsWith("/") || p.startsWith("//")) throw new Error("a path on this site, starting with a single \"/\"");
        setTimeout(() => location.assign(p), 300);
        return `Opening ${p}. When it has loaded, call window.cohortLab.help() (or list its WebMCP tools) to see what it offers.`;
      } }
  ];
}

/**
 * Expose a page's tools, plus the site-wide site_pages/site_open, as WebMCP (when the browser
 * offers it) and as window.cohortLab — `api` adds named shortcuts next to the generic
 * `call(name, args)`. Returns how they were exposed and a cleanup for unmount.
 */
export function exposeTools(page: string, pageTools: AgentTool[], api: Record<string, unknown>): { webmcp: boolean; cleanup: () => void } {
  const w = window as any;
  const tools = [...pageTools, ...siteTools().filter((t) => !pageTools.some((x) => x.name === t.name))];
  const global = {
    pages: () => SITE_PAGES,
    open: (path: string) => tools.find((t) => t.name === "site_open")!.run({ path }),
    ...api,
    page,
    help: () => `cbio-lab, ${page} page. Tools (also registered with WebMCP where the browser supports it):\n` +
      tools.map((t) => `- ${t.name}: ${t.description}`).join("\n") +
      `\nCall any of them as window.cohortLab.call(name, args); each returns a promise.`,
    tools: tools.map((t) => ({ name: t.name, description: t.description, input: t.inputSchema })),
    call: (name: string, args: Json = {}) => {
      const t = tools.find((x) => x.name === name);
      if (!t) throw new Error(`no tool ${name}; have ${tools.map((x) => x.name).join(", ")}`);
      return t.run(args);
    }
  };
  w.cohortLab = global;
  const mc = (document as any).modelContext ?? (navigator as any).modelContext;
  const registered: string[] = [];
  // Newer Chromium removes a registration by aborting the signal it was made with, and reports a
  // failed registration as a rejected promise; older builds use unregisterTool and throw. Both are
  // handled, so a remount never leaves an unhandled "Duplicate tool name" rejection behind.
  const unregister = new AbortController();
  if (mc && typeof mc.registerTool === "function") {
    for (const t of tools) {
      try {
        const done = mc.registerTool({
          name: t.name, description: t.description, inputSchema: t.inputSchema,
          execute: async (args: any) => {
            try { return { content: [{ type: "text", text: asText(await t.run(args || {})) }] }; }
            catch (e) { return { content: [{ type: "text", text: "REJECTED: " + String((e as Error)?.message || e) }], isError: true }; }
          }
        }, { signal: unregister.signal });
        if (done && typeof done.then === "function") done.then(undefined, () => { /* already registered — the existing registration serves */ });
        registered.push(t.name);
      } catch { /* already registered (a remount) — the existing registration serves */ }
    }
  }
  return {
    webmcp: !!mc && typeof mc.registerTool === "function",
    cleanup: () => {
      unregister.abort();
      if (typeof mc?.unregisterTool === "function") {
        for (const n of registered) {
          try {
            const done = mc.unregisterTool(n);
            if (done && typeof done.then === "function") done.then(undefined, () => { /* gone already */ });
          } catch { /* gone already */ }
        }
      }
      if (w.cohortLab === global) delete w.cohortLab;
    }
  };
}

