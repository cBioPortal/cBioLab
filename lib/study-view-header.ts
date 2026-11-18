// The Explore page's study header, as cBioPortal's study view writes it: the title, the
// description's first line with its PubMed link, and what ⊕ opens. The rules, case by case:
// docs/legacy-spec/parity/study-header-cases.md (SH). Browser-safe; text only.

/** a study as the header reads it */
export interface StudyAbout { id: string; name: string; description: string; pmid: string | null }

/** a run of description text, or a link */
export type DescPart = { text: string } | { text: string; href: string };

export interface StudyHeaderText {
  title: string;
  first: DescPart[];
  /** the PubMed link after the first line, or null */
  pubmed: string | null;
  /** what ⊕ opens: the description's other lines (one study), the studies (several), or null for no toggle */
  more: { lines: DescPart[] } | { studies: { id: string; name: string }[] } | null;
}

/** the header of the selected studies (at least one) */
export function studyHeaderText(studies: StudyAbout[]): StudyHeaderText {
  if (studies.length !== 1) return {
    title: "Combined Study",
    first: [{ text: "This combined study contains samples from " + studies.length + " studies" }],
    pubmed: null,
    more: { studies: studies.map((s) => ({ id: s.id, name: s.name })) },
  };
  const s = studies[0];
  // the portal's own cut (SH4–SH6): the raw description split at its line breaks before it is read as HTML
  const lines = s.description.split(/\n/g);
  const pmid = (s.pmid || "").trim();
  return {
    title: s.name,
    first: descriptionParts(s.description.split(/\n+/g)[0]),
    pubmed: pmid ? "https://www.ncbi.nlm.nih.gov/pubmed/" + pmid : null,
    more: lines.length > 1 ? { lines: descriptionParts(lines.slice(1).join("\n")) } : null,
  };
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", deg: "°", times: "×", plusmn: "±", micro: "µ", middot: "·",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", kappa: "κ",
};
/** named (the common ones) and numeric entities decoded; any other left as written */
function decode(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, (e, k: string) => {
    if (k[0] !== "#") return NAMED[k] ?? e;
    const n = k[1] === "x" || k[1] === "X" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : e;
  });
}

/** text with its markup dropped: script and style with their contents, comments, and real tags (a bare "<" stays); line-breaking tags become a space */
const plain = (html: string) => decode(html
  .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<(?:br|\/?p|\/?div|\/?li)\b[^>]*>/gi, " ")
  .replace(/<\/?[a-zA-Z][^<>]*>/g, ""));

/** a description's HTML as text and http(s) links: every other tag dropped, entities decoded */
export function descriptionParts(html: string): DescPart[] {
  const parts: DescPart[] = [];
  const push = (text: string, href?: string) => {
    if (!text && !href) return;
    if (href) parts.push({ text, href });
    else if (parts.length && !("href" in parts[parts.length - 1])) parts[parts.length - 1] = { text: parts[parts.length - 1].text + text };
    else parts.push({ text });
  };
  const link = /<a\s(?:[^>]*?\s)?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let at = 0;
  for (const m of html.matchAll(link)) {
    push(plain(html.slice(at, m.index)));
    const href = decode(m[1] ?? m[2] ?? "").trim(), text = plain(m[3]).replace(/\s+/g, " ");
    if (/^https?:\/\//i.test(href)) push(text || href, href); else push(text);
    at = m.index + m[0].length;
  }
  push(plain(html.slice(at)));
  return parts;
}
