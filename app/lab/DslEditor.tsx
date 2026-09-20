"use client";
// A JSON textbox with typeahead for this app's cohort DSL and, inside "q"
// strings, OQL — the suggestion logic itself lives in lib/dsl-completions.ts
// as a pure function, so this component is just CodeMirror plumbing: turn
// its CompletionContext into (text, cursor, context) and back.
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { autocompletion, type CompletionContext, type CompletionResult as CmCompletionResult } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { suggestAt, type DslContext } from "../../lib/dsl-completions.ts";

function makeSource(ctx: DslContext) {
  return (context: CompletionContext): CmCompletionResult | null => {
    const text = context.state.doc.toString();
    const r = suggestAt(text, context.pos, ctx);
    if (!r) return null;
    if (!r.options.length) return null;
    return {
      from: r.from,
      options: r.options.map((o) => ({
        label: o.label,
        apply: o.apply ?? o.label,
        detail: o.detail,
        type: o.type
      }))
    };
  };
}

// Small, fixed height by default: this replaces a <textarea>, not a full IDE
// pane, and the surrounding cards size around it the same way they did before.
//
// Colors are CSS custom properties, not literals — CodeMirror's theme()
// accepts any valid CSS value, so pointing at this app's own tokens (defined
// once in globals.css, flipped by the page's light/dark state) means this
// editor follows the surrounding page automatically instead of carrying a
// second, unsynchronized light/dark switch of its own.
const baseTheme = EditorView.theme({
  "&": { fontSize: "0.8rem", backgroundColor: "var(--code-bg)", color: "var(--ink)" },
  ".cm-content": { fontFamily: "'IBM Plex Mono', monospace", padding: "0.4rem 0", caretColor: "var(--ink)" },
  ".cm-gutters": { display: "none" },
  ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--accent-soft) !important" },
  ".cm-tooltip": { backgroundColor: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--accent-soft)", color: "var(--accent-ink)" },
  ".cm-completionDetail": { color: "var(--muted)", fontStyle: "normal" }
});

export default function DslEditor({
  value, onChange, genes, attributes, minHeight = "10rem", disabled
}: {
  value: string;
  onChange: (v: string) => void;
  genes?: string[];
  attributes?: string[];
  minHeight?: string;
  disabled?: boolean;
}) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      editable={!disabled}
      theme="none"
      basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
      extensions={[
        json(),
        autocompletion({ override: [makeSource({ genes, attributes })] }),
        baseTheme,
        EditorView.lineWrapping
      ]}
      style={{ border: "1px solid var(--line)", borderRadius: "var(--r-sm)", minHeight }}
      minHeight={minHeight}
    />
  );
}
