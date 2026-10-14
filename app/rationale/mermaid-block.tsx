"use client";
// Renders one Mermaid diagram source into SVG, client-side. Kept as its own
// tiny client component so the rationale page itself stays a server component
// (it just reads and parses the markdown file — no reason to ship that to the
// browser) and mermaid's ~500KB only loads on this one route, not the bundle
// every page pays for.
import { useEffect, useRef, useState } from "react";

export default function MermaidBlock({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "strict" });
        const id = "mmd-" + Math.random().toString(36).slice(2);
        const { svg } = await mermaid.render(id, source);
        if (!dead && ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        if (!dead) setError(String((e as Error)?.message || e));
      }
    })();
    return () => { dead = true; };
  }, [source]);

  if (error) return <pre className="mermaid-fallback">{source}</pre>;
  return <div className="mermaid-diagram" ref={ref} />;
}
