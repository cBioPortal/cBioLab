"use client";
// The header disclosure every page uses to say which AI tools it exposes — how the
// researcher's assistant in the browser (the Claude sidebar) finds them by reading the page,
// and how a person sees what their assistant can do here. The tools themselves are
// registered by lib/webmcp.ts.

export function AgentToolsMenu({ page, tools, webmcp, intro }: {
  page: string; tools: readonly (readonly [string, string])[]; webmcp: boolean | null; intro: string;
}) {
  return (
    <details className="agent-menu" id="ai-tools">
      <summary title="Tools this page exposes to your AI assistant">AI tools</summary>
      <div className="agent-pop">
        <p>{intro}</p>
        <p className="agent-how">
          This site never calls a model itself. An assistant that supports <strong>WebMCP</strong> finds the tools through{" "}
          <code>document.modelContext</code>; one that can run JavaScript here calls <code>window.cohortLab.*</code>{" "}
          (<code>window.cohortLab.help()</code> lists them). {webmcp === null ? "" : webmcp ? "WebMCP: registered in this browser." : "WebMCP is not available in this browser."}
        </p>
        <table>
          <thead><tr><th>WebMCP tool ({page})</th><th>window.cohortLab</th></tr></thead>
          <tbody>{tools.map(([a, b]) => <tr key={a}><td><code>{a}</code></td><td><code>{b}</code></td></tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
