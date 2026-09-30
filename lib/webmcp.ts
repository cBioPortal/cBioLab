// WebMCP for every page of the site: a page hands its tools to exposeTools(), which
// registers them with document.modelContext (navigator.modelContext before Chromium 150)
// when the browser offers it, and publishes the same functions as window.cohortLab for an
// agent that can run page JavaScript but does not discover WebMCP tools itself — the Claude
// sidebar in Chrome today. The site never calls a model; the researcher's own assistant is
// the model, and these tools are how it reads and edits what the page shows.

export type Json = Record<string, unknown>;
export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Json;
  run: (args: any) => Promise<unknown>;
}

const asText = (x: unknown) => typeof x === "string" ? x : JSON.stringify(x, null, 2);

/**
 * Expose tools as WebMCP (when the browser offers it) and as window.cohortLab — `api` adds
 * named shortcuts next to the generic `call(name, args)`. Returns how they were exposed and a
 * cleanup for unmount.
 */
export function exposeTools(page: string, tools: AgentTool[], api: Record<string, unknown>): { webmcp: boolean; cleanup: () => void } {
  const w = window as any;
  const global = {
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
  if (mc && typeof mc.registerTool === "function") {
    for (const t of tools) {
      try {
        mc.registerTool({
          name: t.name, description: t.description, inputSchema: t.inputSchema,
          execute: async (args: any) => {
            try { return { content: [{ type: "text", text: asText(await t.run(args || {})) }] }; }
            catch (e) { return { content: [{ type: "text", text: "REJECTED: " + String((e as Error)?.message || e) }], isError: true }; }
          }
        });
        registered.push(t.name);
      } catch { /* already registered (a remount) — the existing registration serves */ }
    }
  }
  return {
    webmcp: !!mc && typeof mc.registerTool === "function",
    cleanup: () => {
      for (const n of registered) try { mc.unregisterTool(n); } catch { /* gone already */ }
      if (w.cohortLab === global) delete w.cohortLab;
    }
  };
}

